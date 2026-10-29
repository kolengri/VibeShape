import { beforeAll, describe, expect, it } from "bun:test"
import type { PrintOptimizationReconstructionInput } from "@vibeshape/protocol"
import { measureArea, measureVolume, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { getWasmHeapBytes } from "./memory-profile"
import { copyOcctAssemblySource } from "./occt-assembly-pose"
import { inspectOcctBody } from "./occt-body-validation"
import { adoptOcctShape, castOcctShape } from "./occt-cast"
import { importOcctStep } from "./occt-exchange"
import { meshOcctShape } from "./occt-mesh"
import { reconstructOcctPrintOptimization } from "./occt-print-optimization"
import { createOcctBox, createOcctCylinder, cutOcctShapes } from "./occt-shapes"

let occt: OpenCascadeInstance
const controlledPackage = process.env.VIBESHAPE_TEST_OCCT_PACKAGE
const id = (value: number) => `0195b5ac-b220-7a2c-8c33-${String(value).padStart(12, "0")}`
beforeAll(async () => {
  const initialize = controlledPackage
    ? (await import(`${controlledPackage}/src/replicad_single.js`)).default
    : initializeOpenCascade
  occt = await Reflect.apply(initialize, undefined, [
    {
      locateFile: () =>
        controlledPackage
          ? `${controlledPackage}/src/replicad_single.wasm`
          : new URL(
              "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
              import.meta.url,
            ).pathname,
    },
  ])
  setOC(occt)
}, 60_000)

function cells(
  nx: number,
  ny: number,
  nz: number,
  retain: (x: number, y: number, z: number) => boolean,
) {
  const output: [number, number, number][] = []
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) if (retain(x, y, z)) output.push([x, y, z])
  return output
}
function request(
  overrides: Partial<PrintOptimizationReconstructionInput> = {},
): PrintOptimizationReconstructionInput {
  return {
    source: {
      documentId: id(1),
      featureId: id(2),
      contentHash: "a".repeat(64),
      outputRole: "result",
    },
    preserveFaceIds: [],
    voxelGrid: { originMm: [-6, -6, 0], cellSizeMm: 1, cells: cells(12, 12, 6, (x) => x < 10) },
    sourceToPrintFrame: { originMm: [0, 0, 0], rotation: [0, 0, 0, 1] },
    protectedBoxes: [],
    preserveDepthMm: 1,
    ...overrides,
  }
}
function cylinderFace(shape: Shape3D) {
  const faces = shape.faces
  try {
    const face = faces.find((value) => value.geomType === "CYLINDRE")
    if (!face) throw new Error("The fixture needs one cylindrical face.")
    return face.hashCode
  } finally {
    for (const face of faces) face.delete()
  }
}
function cylinderRadii(shape: Shape3D) {
  const faces = shape.faces
  try {
    return faces
      .filter((face) => face.geomType === "CYLINDRE")
      .map((face) => {
        const adapter = new occt.BRepAdaptor_Surface_2(face.wrapped, true)
        try {
          const cylinder = adapter.Cylinder()
          try {
            return cylinder.Radius()
          } finally {
            cylinder.delete()
          }
        } finally {
          adapter.delete()
        }
      })
  } finally {
    for (const face of faces) face.delete()
  }
}

function planeAreas(shape: Shape3D) {
  const faces = shape.faces,
    areas = new Map<string, number>()
  try {
    for (const face of faces) {
      const normal = face.normalAt()
      try {
        const center = face.center
        try {
          const direction = normal.toTuple(),
            point = center.toTuple()
          const sign = (direction.find((value) => Math.abs(value) > 1e-8) ?? 1) < 0 ? -1 : 1
          const offset = direction.reduce((sum, value, axis) => sum + value * (point[axis] ?? 0), 0)
          const plane = [...direction, offset]
            .map((value) => Math.round(value * sign * 1e5) / 1e5)
            .join(":")
          areas.set(plane, (areas.get(plane) ?? 0) + measureArea(face))
        } finally {
          center.delete()
        }
      } finally {
        normal.delete()
      }
    }
    return areas
  } finally {
    for (const face of faces) face.delete()
  }
}

function endPatchRequest(
  frame: PrintOptimizationReconstructionInput["sourceToPrintFrame"] = {
    originMm: [0, 0, 0],
    rotation: [0, 0, 0, 1],
  },
) {
  return request({
    sourceToPrintFrame: frame,
    voxelGrid: {
      originMm: [0, -8, 0],
      cellSizeMm: 1,
      cells: cells(
        16,
        8,
        8,
        (x, y, z) =>
          !(
            ([1, 2].includes(x) && [3, 4].includes(y) && [3, 4].includes(z)) ||
            (x === 0 && y === 3 && z === 3) ||
            (x === 15 && y === 4 && z === 4)
          ),
      ),
    },
    protectedBoxes: [
      { minMm: [0, -8, 0], maxMm: [2, 0, 8] },
      { minMm: [14, -8, 0], maxMm: [16, 0, 8] },
    ],
  })
}

describe("disposable exact print reconstruction over the pinned OCCT kernel", () => {
  it.each([0, Math.PI / 4])(
    "cuts interior cells inside automatic end patches while preserving exterior interfaces at angle %s",
    (angle) => {
      const box = createOcctBox(occt, [16, 8, 8], false, [8, -4, 0])
      const rotation: [number, number, number, number] = [
        Math.sin(angle / 2),
        0,
        0,
        Math.cos(angle / 2),
      ]
      let source: Shape3D | null = null,
        imported: Shape3D | null = null
      try {
        source = adoptOcctShape(
          copyOcctAssemblySource(occt, {
            shape: box,
            pose: { translation: [20, -10, 3], quaternion: rotation },
          }),
          castOcctShape,
        )
        const originalFaces = planeAreas(source)
        const result = reconstructOcctPrintOptimization(
          occt,
          source,
          endPatchRequest({ originMm: [20, -10, 3], rotation: [-rotation[0], 0, 0, rotation[3]] }),
        )
        expect(result.sourceVolumeMm3).toBeCloseTo(1024, 7)
        expect(result.volumeMm3).toBeCloseTo(1016, 7)
        imported = importOcctStep(occt, result.stepBytes)
        expect(inspectOcctBody(occt, imported)).toEqual({
          valid: true,
          solidCount: 1,
          volume: expect.closeTo(1016, 7),
        })
        const outputFaces = planeAreas(imported)
        for (const [plane, area] of originalFaces)
          expect(outputFaces.get(plane)).toBeCloseTo(area, 7)
        expect(planeAreas(source)).toEqual(originalFaces)
      } finally {
        imported?.delete()
        source?.delete()
        box.delete()
      }
    },
  )

  it.each([0, 0.5e-6, 2e-6])(
    "protects closed patch contact only within the geometric tolerance %s",
    (gap) => {
      const source = createOcctBox(occt, [6, 6, 6], false, [3, 3, 0])
      try {
        const result = reconstructOcctPrintOptimization(
          occt,
          source,
          request({
            voxelGrid: {
              originMm: [0, 0, 0],
              cellSizeMm: 1,
              cells: cells(6, 6, 6, (x, y, z) => !(x === 2 && [0, 2].includes(y) && z === 2)),
            },
            protectedBoxes: [{ minMm: [3 + gap, 0, 2], maxMm: [4, 1, 3] }],
          }),
        )
        expect(result.volumeMm3).toBeCloseTo(gap <= 1e-6 ? 215 : 214, 7)
      } finally {
        source.delete()
      }
    },
  )

  it("tests source-boundary contact on the cell/patch intersection instead of the whole cell", () => {
    const source = createOcctBox(occt, [6, 6, 6], false, [3, 3, 0])
    try {
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({
          voxelGrid: {
            originMm: [0, 0, 0],
            cellSizeMm: 1,
            cells: cells(6, 6, 6, (x, y, z) => !(x === 2 && [0, 2].includes(y) && z === 2)),
          },
          protectedBoxes: [{ minMm: [2, 0.25, 2], maxMm: [3, 0.75, 3] }],
        }),
      )
      expect(result.volumeMm3).toBeCloseTo(214, 7)
    } finally {
      source.delete()
    }
  })

  it("allows transient cut boxes to extend outside a valid source at the modeling-world boundary", () => {
    const source = createOcctBox(occt, [2, 2, 2], false, [99_999, 0, 0])
    try {
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({
          voxelGrid: {
            originMm: [99_998, -1, 0],
            cellSizeMm: 1,
            cells: cells(2, 2, 2, (x) => x === 0),
          },
        }),
      )
      expect(result.volumeMm3).toBeCloseTo(4, 7)
      expect(measureVolume(source)).toBeCloseTo(8, 7)
    } finally {
      source.delete()
    }
  })

  it("fails closed when transient face hashes identify different native faces", () => {
    const source = createOcctCylinder(occt, 4, 4, [0, 0, 0])
    const hash = vi.spyOn(occt.TopoDS_Shape.prototype, "HashCode").mockReturnValue(27)
    try {
      expect(() =>
        reconstructOcctPrintOptimization(occt, source, request({ preserveFaceIds: [27] })),
      ).toThrow("ambiguous")
    } finally {
      hash.mockRestore()
      source.delete()
    }
  })

  it("streams a source envelope above the former fixed cell ceiling without changing resolution", () => {
    const source = createOcctBox(occt, [101, 2, 2])
    try {
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({ voxelGrid: { originMm: [-50.5, -1, 0], cellSizeMm: 0.1, cells: [[0, 0, 0]] } }),
      )
      expect(result.volumeMm3).toBeCloseTo(0.001, 9)
      expect(result.sourceVolumeMm3).toBeCloseTo(404, 7)
    } finally {
      source.delete()
    }
  })

  it("rejects a result unless every selected original native face is still IsSame", () => {
    const source = createOcctCylinder(occt, 4, 4, [0, 0, 0])
    const compare = vi.spyOn(occt.TopoDS_Shape.prototype, "IsSame").mockReturnValue(false)
    try {
      expect(() =>
        reconstructOcctPrintOptimization(
          occt,
          source,
          request({
            preserveFaceIds: [cylinderFace(source)],
            preserveDepthMm: 0.5,
            voxelGrid: {
              originMm: [-4, -4, 0],
              cellSizeMm: 1,
              cells: cells(
                8,
                8,
                4,
                (x, y, z) => !([3, 4].includes(x) && [3, 4].includes(y) && [1, 2].includes(z)),
              ),
            },
          }),
        ),
      ).toThrow("changed a preserved original face")
      expect(compare).toHaveBeenCalled()
    } finally {
      compare.mockRestore()
      source.delete()
    }
  })

  it("preserves the complete original cylindrical hole and source while removing exterior material", () => {
    const box = createOcctBox(occt, [12, 12, 6])
    const hole = createOcctCylinder(occt, 2, 6, [0, 0, 0])
    let source: Shape3D | null = null,
      imported: Shape3D | null = null
    try {
      source = cutOcctShapes(occt, box, hole)
      const selected = cylinderFace(source)
      const originalVolume = measureVolume(source)
      const before = meshOcctShape(occt, source, { tolerance: 0.05, angularTolerance: 0.1 })
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({ preserveFaceIds: [selected] }),
      )
      expect(result.preservedFaceCount).toBe(1)
      expect(result.volumeMm3).toBeCloseTo(originalVolume - 144, 6)
      expect(result.verificationMesh.positions).toBeInstanceOf(Float64Array)
      imported = importOcctStep(occt, result.stepBytes)
      expect(inspectOcctBody(occt, imported)).toEqual({
        valid: true,
        solidCount: 1,
        volume: expect.closeTo(result.volumeMm3, 6),
      })
      expect(cylinderRadii(imported)).toEqual([expect.closeTo(2, 10)])
      expect(cylinderFace(source)).toBe(selected)
      expect(measureVolume(source)).toBe(originalVolume)
      expect(meshOcctShape(occt, source, { tolerance: 0.05, angularTolerance: 0.1 })).toEqual(
        before,
      )
    } finally {
      imported?.delete()
      source?.delete()
      hole.delete()
      box.delete()
    }
  })

  it("retains a curved face skin without freezing its entire bounding volume", () => {
    const source = createOcctCylinder(occt, 4, 4, [0, 0, 0])
    try {
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({
          preserveFaceIds: [cylinderFace(source)],
          preserveDepthMm: 0.5,
          voxelGrid: {
            originMm: [-4, -4, 0],
            cellSizeMm: 1,
            cells: cells(
              8,
              8,
              4,
              (x, y, z) => !([3, 4].includes(x) && [3, 4].includes(y) && [1, 2].includes(z)),
            ),
          },
        }),
      )
      expect(result.preservedFaceCount).toBe(1)
      expect(result.sourceVolumeMm3 - result.volumeMm3).toBeCloseTo(8, 7)
    } finally {
      source.delete()
    }
  })

  it("maps an inclined print lattice back into the original world placement", () => {
    const box = createOcctBox(occt, [12, 12, 6])
    let source: Shape3D | null = null,
      imported: Shape3D | null = null
    const rotation: [number, number, number, number] = [
      Math.sin(Math.PI / 8),
      0,
      0,
      Math.cos(Math.PI / 8),
    ]
    try {
      source = adoptOcctShape(
        copyOcctAssemblySource(occt, {
          shape: box,
          pose: { translation: [20, -10, 3], quaternion: rotation },
        }),
        castOcctShape,
      )
      const result = reconstructOcctPrintOptimization(
        occt,
        source,
        request({
          sourceToPrintFrame: {
            originMm: [20, -10, 3],
            rotation: [-rotation[0], 0, 0, rotation[3]],
          },
        }),
      )
      expect(result.sourceVolumeMm3 - result.volumeMm3).toBeCloseTo(144, 6)
      imported = importOcctStep(occt, result.stepBytes)
      const [min, max] = imported.boundingBox.bounds
      expect(min[0]).toBeCloseTo(14, 6)
      expect(max[0]).toBeCloseTo(24, 6)
      expect(measureVolume(source)).toBeCloseTo(864, 6)
    } finally {
      imported?.delete()
      source?.delete()
      box.delete()
    }
  })

  it("rejects stale faces, disconnected material, no improvement, and unrepresentable lattice coordinates", () => {
    const source = createOcctBox(occt, [12, 12, 6])
    try {
      expect(() =>
        reconstructOcctPrintOptimization(
          occt,
          source,
          request({ preserveFaceIds: [2_147_483_646] }),
        ),
      ).toThrow("stale")
      expect(() =>
        reconstructOcctPrintOptimization(
          occt,
          source,
          request({
            voxelGrid: {
              originMm: [-6, -6, 0],
              cellSizeMm: 1,
              cells: cells(12, 12, 6, (x) => x < 4 || x >= 8),
            },
          }),
        ),
      ).toThrow("without detached")
      expect(() =>
        reconstructOcctPrintOptimization(
          occt,
          source,
          request({
            voxelGrid: {
              originMm: [-6, -6, 0],
              cellSizeMm: 1,
              cells: cells(12, 12, 6, () => true),
            },
          }),
        ),
      ).toThrow("does not remove")
      expect(() =>
        reconstructOcctPrintOptimization(
          occt,
          source,
          request({
            voxelGrid: { originMm: [-6, -6, 0], cellSizeMm: Number.MIN_VALUE, cells: [[0, 0, 0]] },
          }),
        ),
      ).toThrow("cannot be represented safely")
      expect(measureVolume(source)).toBeCloseTo(864, 7)
    } finally {
      source.delete()
    }
  })

  it("keeps load/support boundary patches and releases repeated successful and rejected native lifecycles", () => {
    const source = createOcctBox(occt, [16, 8, 8], false, [8, -4, 0])
    const input = endPatchRequest()
    const statistics = Reflect.get(occt, "VibeShapeAllocatorStats")
    const allocated = () =>
      statistics
        ? Number(Reflect.apply(statistics.AllocatedBytes, statistics, []))
        : getWasmHeapBytes(occt)
    try {
      const first = reconstructOcctPrintOptimization(occt, source, input)
      expect(first.sourceVolumeMm3 - first.volumeMm3).toBeCloseTo(8, 7)
      for (let iteration = 0; iteration < 3; iteration++)
        reconstructOcctPrintOptimization(occt, source, input)
      const before = allocated()
      for (let iteration = 0; iteration < 8; iteration++) {
        const next = reconstructOcctPrintOptimization(occt, source, input)
        expect(next.volumeMm3).toBeCloseTo(first.volumeMm3, 8)
        expect(() =>
          reconstructOcctPrintOptimization(occt, source, {
            ...input,
            preserveFaceIds: [2_147_483_646],
          }),
        ).toThrow("stale")
        const distance = vi
          .spyOn(occt.BRepExtrema_DistShapeShape.prototype, "Perform")
          .mockImplementationOnce(() => {
            throw new Error("Injected native boundary distance failure.")
          })
        try {
          expect(() => reconstructOcctPrintOptimization(occt, source, input)).toThrow(
            "Injected native boundary distance failure",
          )
        } finally {
          distance.mockRestore()
        }
      }
      if (controlledPackage) expect(statistics).toBeDefined()
      expect(allocated() - before).toBeLessThanOrEqual(statistics ? 1_024 : 0)
      expect(measureVolume(source)).toBeCloseTo(1024, 7)
    } finally {
      source.delete()
    }
  }, 60_000)
})
