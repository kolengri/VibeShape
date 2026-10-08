import { beforeAll, describe, expect, it } from "bun:test"
import { type Face, makeBox, makeCylinder, measureVolume, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { vi } from "../../../tests/unit/support/bun-test"
import { inspectOcctBody } from "./occt-body-validation"
import * as casting from "./occt-cast"
import { terminateExtrusionAtFace } from "./occt-extrusion-end"
import { createOcctSphere, fuseOcctShapes, intersectOcctShapes } from "./occt-shapes"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  occt = await Reflect.apply(initializeOpenCascade, undefined, [
    {
      wasmBinary: new Uint8Array(
        readFileSync(
          new URL(
            "../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
            import.meta.url,
          ),
        ),
      ),
    },
  ])
  setOC(occt)
})

function withCurvedFace<T>(
  target: Shape3D,
  action: (face: Face) => T,
  geometryClass: Face["geomType"] = "SPHERE",
) {
  const faces = target.faces
  try {
    const support = faces.find((face) => face.geomType === geometryClass)
    if (!support) throw new Error("Missing fixture curved surface.")
    return action(support)
  } finally {
    for (const face of faces) face.delete()
  }
}

describe("exact curved extrusion endpoint proof", () => {
  it("terminates on the selected finite cylindrical side while retaining both borrowed bodies", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = makeCylinder(4, 8, [-4, 0, 8], [1, 0, 0])
    const volumes = [measureVolume(tool), measureVolume(target)]
    try {
      withCurvedFace(
        target,
        (support) => {
          const result = terminateExtrusionAtFace(
            occt,
            tool,
            target,
            support,
            [0, 0, 0],
            [0, 0, 20],
            [0, 0, 1],
          )
          try {
            const metrics = inspectOcctBody(occt, result)
            expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
            expect(metrics.volume).toBeGreaterThan(16)
            expect(metrics.volume).toBeLessThan(18)
          } finally {
            result.delete()
          }
        },
        "CYLINDRE",
      )
      expect(measureVolume(tool)).toBeCloseTo(volumes[0] ?? 0, 8)
      expect(measureVolume(target)).toBeCloseTo(volumes[1] ?? 0, 8)
    } finally {
      target.delete()
      tool.delete()
    }
  })

  it("rejects a finite cylindrical patch that covers only half the new cap", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = makeCylinder(4, 8, [-4, 0, 8], [1, 0, 0])
    const halfSpace = makeBox([0, -5, 0], [5, 5, 20])
    const patch = intersectOcctShapes(occt, target, halfSpace)
    try {
      withCurvedFace(
        patch,
        (support) => {
          expect(() =>
            terminateExtrusionAtFace(occt, tool, target, support, [0, 0, 0], [0, 0, 20], [0, 0, 1]),
          ).toThrow("The selected finite end face must cover every new extrusion cap.")
        },
        "CYLINDRE",
      )
    } finally {
      patch.delete()
      halfSpace.delete()
      target.delete()
      tool.delete()
    }
  })

  it("retains only the complete start-side component bounded by the finite spherical face", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = createOcctSphere(occt, 4, [0, 0, 8])
    const originalTool = measureVolume(tool)
    const originalTarget = measureVolume(target)
    try {
      withCurvedFace(target, (support) => {
        const result = terminateExtrusionAtFace(
          occt,
          tool,
          target,
          support,
          [0, 0, 0],
          [0, 0, 20],
          [0, 0, 1],
        )
        const faces = result.faces
        try {
          const metrics = inspectOcctBody(occt, result)
          expect(metrics).toMatchObject({ valid: true, solidCount: 1 })
          expect(metrics.volume).toBeGreaterThan(16)
          expect(metrics.volume).toBeLessThan(18)
          expect(faces.filter((face) => face.geomType === "SPHERE")).toHaveLength(1)
          const overlap = intersectOcctShapes(occt, result, target)
          try {
            expect(measureVolume(overlap)).toBeCloseTo(0, 8)
          } finally {
            overlap.delete()
          }
        } finally {
          for (const face of faces) face.delete()
          result.delete()
        }
      })
      expect(measureVolume(tool)).toBeCloseTo(originalTool, 8)
      expect(measureVolume(target)).toBeCloseTo(originalTarget, 8)
    } finally {
      target.delete()
      tool.delete()
    }
  })

  it.each([
    { name: "partial footprint", radius: 0.5, origin: [0, 0, 8] as const },
    { name: "unreachable face", radius: 4, origin: [0, 0, -8] as const },
    { name: "removed start cap", radius: 4, origin: [0, 0, 0] as const },
  ])("rejects $name without changing either borrowed source", ({ radius, origin }) => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = createOcctSphere(occt, radius, origin)
    const volumes = [measureVolume(tool), measureVolume(target)]
    try {
      withCurvedFace(target, (support) => {
        expect(() =>
          terminateExtrusionAtFace(occt, tool, target, support, [0, 0, 0], [0, 0, 20], [0, 0, 1]),
        ).toThrow(/complete|reachable/)
      })
      expect(measureVolume(tool)).toBeCloseTo(volumes[0] ?? 0, 8)
      expect(measureVolume(target)).toBeCloseTo(volumes[1] ?? 0, 8)
    } finally {
      target.delete()
      tool.delete()
    }
  })

  it("rejects new cap area on an adjacent face of the same endpoint body", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const sphere = createOcctSphere(occt, 4, [0, 0, 8])
    const extension = makeBox([-4, -4, 3], [0, 4, 14])
    const target = fuseOcctShapes(occt, sphere, extension)
    try {
      withCurvedFace(target, (support) => {
        expect(() =>
          terminateExtrusionAtFace(occt, tool, target, support, [0, 0, 0], [0, 0, 20], [0, 0, 1]),
        ).toThrow("The selected finite end face must cover every new extrusion cap.")
      })
    } finally {
      target.delete()
      extension.delete()
      sphere.delete()
      tool.delete()
    }
  })

  it("does not silently extend a finite spherical patch to its complete underlying surface", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = createOcctSphere(occt, 4, [0, 0, 8])
    const halfSpace = makeBox([0, -5, 0], [5, 5, 20])
    const patch = intersectOcctShapes(occt, target, halfSpace)
    try {
      withCurvedFace(patch, (support) => {
        expect(() =>
          terminateExtrusionAtFace(occt, tool, target, support, [0, 0, 0], [0, 0, 20], [0, 0, 1]),
        ).toThrow("The selected finite end face must cover every new extrusion cap.")
      })
    } finally {
      patch.delete()
      halfSpace.delete()
      target.delete()
      tool.delete()
    }
  })

  it("releases every prism face when the first native history lookup throws", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = createOcctSphere(occt, 4, [0, 0, 8])
    const volumes = [measureVolume(tool), measureVolume(target)]
    const borrowedDeletes = [vi.spyOn(tool, "delete"), vi.spyOn(target, "delete")]
    const faces = tool.faces
    const faceDeletes = faces.map((face) => vi.spyOn(face, "delete"))
    const facesSpy = vi.spyOn(tool, "faces", "get").mockReturnValue(faces)
    const failure = new Error("Injected first prism history failure")
    const historySpy = vi
      .spyOn(occt.BRepAlgoAPI_Cut_1.prototype, "Modified")
      .mockImplementation(() => {
        throw failure
      })
    try {
      withCurvedFace(target, (support) => {
        const supportDelete = vi.spyOn(support, "delete")
        expect(() =>
          terminateExtrusionAtFace(occt, tool, target, support, [0, 0, 0], [0, 0, 20], [0, 0, 1]),
        ).toThrow(failure)
        expect(supportDelete).not.toHaveBeenCalled()
      })
      expect(faces).toHaveLength(6)
      expect(facesSpy).toHaveBeenCalledTimes(1)
      expect(historySpy).toHaveBeenCalledTimes(1)
      for (const deleted of faceDeletes) expect(deleted).toHaveBeenCalledTimes(1)
      for (const deleted of borrowedDeletes) expect(deleted).not.toHaveBeenCalled()
      expect(measureVolume(tool)).toBeCloseTo(volumes[0] ?? 0, 8)
      expect(measureVolume(target)).toBeCloseTo(volumes[1] ?? 0, 8)
    } finally {
      historySpy.mockRestore()
      facesSpy.mockRestore()
      for (const [index, face] of faces.entries())
        if (faceDeletes[index]?.mock.calls.length === 0) face.delete()
      target.delete()
      tool.delete()
    }
  })

  it("releases every adopted result when native curved-face coverage throws", () => {
    const tool = makeBox([-1, -1, 0], [1, 1, 20])
    const target = createOcctSphere(occt, 4, [0, 0, 8])
    const volumes = [measureVolume(tool), measureVolume(target)]
    const borrowedDeletes = [vi.spyOn(tool, "delete"), vi.spyOn(target, "delete")]
    const adoptedDeletes: ReturnType<typeof vi.spyOn>[] = []
    const adopt = casting.adoptOcctShape
    const castSpy = vi.spyOn(casting, "adoptOcctShape").mockImplementation((shape, cast) => {
      const result = adopt(shape, cast)
      adoptedDeletes.push(vi.spyOn(result, "delete"))
      return result
    })
    const failure = new Error("Injected curved Common failure")
    const failingOcct = new Proxy(occt, {
      get(target, key) {
        if (key === "BRepAlgoAPI_Common_1")
          return class {
            constructor() {
              throw failure
            }
          }
        return Reflect.get(target, key)
      },
    })
    try {
      withCurvedFace(target, (support) => {
        const supportDelete = vi.spyOn(support, "delete")
        expect(() =>
          terminateExtrusionAtFace(
            failingOcct,
            tool,
            target,
            support,
            [0, 0, 0],
            [0, 0, 20],
            [0, 0, 1],
          ),
        ).toThrow(failure)
        expect(supportDelete).not.toHaveBeenCalled()
      })
      expect(adoptedDeletes.length).toBeGreaterThanOrEqual(2)
      for (const deleted of adoptedDeletes) expect(deleted).toHaveBeenCalledTimes(1)
      for (const deleted of borrowedDeletes) expect(deleted).not.toHaveBeenCalled()
      expect(measureVolume(tool)).toBeCloseTo(volumes[0] ?? 0, 8)
      expect(measureVolume(target)).toBeCloseTo(volumes[1] ?? 0, 8)
    } finally {
      castSpy.mockRestore()
      target.delete()
      tool.delete()
    }
  })
})
