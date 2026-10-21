import { beforeAll, expect, it } from "bun:test"
import { draw, makeCylinder, measureShapeVolumeProperties, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { chamferOcctShapeV3 } from "./occt-chamfer-v3"
import { treatSelectedOcctEdges } from "./occt-edge-treatment"
import { captureReplicadTopologySnapshot } from "./topology-signatures"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const path = process.env.VIBESHAPE_CHAMFER_OCCT_DIRECTORY
  const base = path
    ? new URL(`file://${path.replace(/\/$/, "")}/`)
    : new URL("../node_modules/replicad-opencascadejs/src/", import.meta.url)
  const wasmBinary = readFileSync(new URL("replicad_single.wasm", base))
  const initialize = path
    ? (await import(new URL("replicad_single.js", base).href)).default
    : initializeOpenCascade
  occt = await Reflect.apply(initialize, undefined, [{ wasmBinary }])
  setOC(occt)
}, 60000)

function shapeVolume(shape: Shape3D) {
  const properties = measureShapeVolumeProperties(shape)
  try {
    return properties.volume
  } finally {
    properties.delete()
  }
}

function splitEdgeSource(): Shape3D {
  return draw([0, 0])
    .lineTo([10, 0])
    .lineTo([20, 0])
    .lineTo([20, 12])
    .lineTo([0, 12])
    .close()
    .sketchOnPlane("XY")
    .extrude(10)
    .asShape3D()
}

it("bounds legacy chamfer by a short cone/cylinder transition without broadening V3 support", () => {
  const source = draw([32.1, 0])
    .lineTo([37, 0])
    .lineTo([37, 20])
    .lineTo([31.6, 20])
    .lineTo([31.6, 0.5])
    .close()
    .sketchOnPlane("XZ")
    .revolve([0, 0, 1])
    .asShape3D()
  try {
    const before = captureReplicadTopologySnapshot(source)
    const rim = before.candidates.find(
      ({ referenceGeometry: g }) =>
        g?.kind === "circle-edge" &&
        Math.abs(g.radius - 31.6) < 1e-7 &&
        Math.abs(g.center[2] - 0.5) < 1e-7,
    )
    const key = rim ? before.transientShapeKeys.get(rim.candidateId) : undefined
    if (key === undefined) throw new Error("The exact inner cone/cylinder transition is required.")
    expect(rim?.signature.adjacentGeometryClasses).toEqual(["CONE", "CYLINDRE"])
    const originalVolume = shapeVolume(source)
    for (const distance of [0.2, 0.7]) {
      const built = treatSelectedOcctEdges(occt, source, "chamfer", distance, [key])
      const validity = new occt.BRepCheck_Analyzer(built.wrapped, true, false)
      try {
        expect(validity.IsValid_2()).toBe(true)
        expect(shapeVolume(built)).toBeLessThan(originalVolume)
      } finally {
        validity.delete()
        built.delete()
      }
    }
    for (const distance of [0.71, 8])
      expect(() => treatSelectedOcctEdges(occt, source, "chamfer", distance, [key])).toThrow()
    expect(() =>
      chamferOcctShapeV3(
        occt,
        source,
        {
          mode: "equal-distance",
          distance: 0.2,
          measurement: "offset",
          flip: false,
          tangentPropagation: false,
        },
        [{ kind: "edge", edgeKey: key }],
        [],
      ),
    ).toThrow("non-planar adjacent faces is unsupported")
    expect(shapeVolume(source)).toBeCloseTo(originalVolume, 8)
    expect(captureReplicadTopologySnapshot(source).candidates).toEqual(before.candidates)
  } finally {
    source.delete()
  }
})

it.each(
  [0.25, 1].flatMap((distance) =>
    [false, true].flatMap((inner) => [false, true].map((top) => ({ distance, inner, top }))),
  ),
)(
  "measures circular Offset setbacks and annular volume: $distance, inner=$inner, top=$top",
  ({ distance, inner, top }) => {
    const origin: [number, number, number] = [12, -7, 31]
    const axis: [number, number, number] = [1 / 3, 2 / 3, 2 / 3]
    const outer = makeCylinder(10, 20, origin, axis)
    const bore = makeCylinder(6, 20, origin, axis)
    const source = outer.cut(bore)
    outer.delete()
    bore.delete()
    try {
      const before = captureReplicadTopologySnapshot(source)
      const radius = inner ? 6 : 10
      const height = top ? 20 : 0
      const axialPosition = (center: readonly number[]) =>
        axis.reduce(
          (sum, value, index) => sum + value * ((center[index] ?? 0) - (origin[index] ?? 0)),
          0,
        )
      const rim = before.candidates.find(
        ({ referenceGeometry: g }) =>
          g?.kind === "circle-edge" &&
          Math.abs(g.radius - radius) < 1e-7 &&
          Math.abs(axialPosition(g.center) - height) < 1e-7,
      )
      const key = rim ? before.transientShapeKeys.get(rim.candidateId) : undefined
      if (key === undefined) throw new Error("The exact closed circular annular rim is required.")
      const built = chamferOcctShapeV3(
        occt,
        source,
        {
          mode: "equal-distance",
          distance,
          measurement: "offset",
          flip: false,
          tangentPropagation: false,
        },
        [{ kind: "edge", edgeKey: key }],
        [],
      )
      try {
        const validity = new occt.BRepCheck_Analyzer(built.wrapped, true, false)
        try {
          expect(validity.IsValid_2()).toBe(true)
        } finally {
          validity.delete()
        }
        const removed = Math.PI * (radius * distance ** 2 + ((inner ? 1 : -1) * distance ** 3) / 3)
        expect(shapeVolume(built)).toBeCloseTo(Math.PI * 1280 - removed, 6)
        const after = captureReplicadTopologySnapshot(built)
        const circles: Array<[number, number]> = [
          [radius + (inner ? distance : -distance), height],
          [radius, height + (top ? -distance : distance)],
        ]
        for (const [expectedRadius, expectedHeight] of circles)
          expect(
            after.candidates.some(
              ({ referenceGeometry: g }) =>
                g?.kind === "circle-edge" &&
                Math.abs(g.radius - expectedRadius) < 1e-6 &&
                Math.abs(axialPosition(g.center) - expectedHeight) < 1e-6,
            ),
          ).toBe(true)
        expect(after.candidates.some(({ signature }) => signature.geometryClass === "CONE")).toBe(
          true,
        )
      } finally {
        built.delete()
      }
      expect(shapeVolume(source)).toBeCloseTo(Math.PI * 1280, 6)
      expect(captureReplicadTopologySnapshot(source).candidates).toEqual(before.candidates)
    } finally {
      source.delete()
    }
  },
)

it("uses actual native tangent contours, rejects unrepresentable partial propagation and conflicting directions", () => {
  const source = splitEdgeSource()
  const edges = source.edges,
    faces = source.faces
  try {
    const chain = edges.filter((edge) => {
      const box = edge.boundingBox
      try {
        const [min, max] = box.bounds
        return Math.abs(min[1]) < 1e-6 && Math.abs(max[1]) < 1e-6 && Math.abs(min[2] - 10) < 1e-6
      } finally {
        box.delete()
      }
    })
    expect(chain.length).toBe(2)
    const top = faces.find((face) => {
      const center = face.center
      try {
        return Math.abs(center.toTuple()[2] - 10) < 1e-7
      } finally {
        center.delete()
      }
    })
    const first = chain[0],
      second = chain[1]
    if (!top || !first || !second)
      throw new Error("The source must retain two collinear top edges and their exact planar side.")
    const parameters: Parameters<typeof chamferOcctShapeV3>[2] = {
      mode: "two-distances",
      distance: 1,
      secondDistance: 2,
      measurement: "offset",
      flip: false,
      tangentPropagation: false,
    }
    const selection = { kind: "edge" as const, edgeKey: first.hashCode, sideFaceKey: top.hashCode }
    expect(() => chamferOcctShapeV3(occt, source, parameters, [selection], [])).toThrow(
      "cannot stop within this native tangent contour",
    )
    const built = chamferOcctShapeV3(
      occt,
      source,
      { ...parameters, tangentPropagation: true },
      [selection],
      [],
    )
    try {
      expect(shapeVolume(built)).toBeCloseTo(2380, 6)
    } finally {
      built.delete()
    }
    const complete = chamferOcctShapeV3(
      occt,
      source,
      parameters,
      [selection, { ...selection, edgeKey: second.hashCode }],
      [],
    )
    try {
      expect(shapeVolume(complete)).toBeCloseTo(2380, 6)
    } finally {
      complete.delete()
    }
    expect(() =>
      chamferOcctShapeV3(
        occt,
        source,
        { ...parameters, tangentPropagation: true },
        [selection],
        [second.hashCode],
      ),
    ).toThrow("cannot split a native tangent contour")
    expect(() =>
      chamferOcctShapeV3(
        occt,
        source,
        { ...parameters, tangentPropagation: true },
        [selection],
        [first.hashCode],
      ),
    ).toThrow("cannot split a native tangent contour")
    const reversed = chamferOcctShapeV3(
      occt,
      source,
      { ...parameters, tangentPropagation: true },
      [selection],
      [first.hashCode, second.hashCode],
    )
    try {
      expect(shapeVolume(reversed)).toBeCloseTo(2380, 6)
      expect(
        captureReplicadTopologySnapshot(reversed).candidates.some(
          ({ kind, signature }) =>
            kind === "vertex" &&
            Math.abs(signature.centroid[0]) < 1e-7 &&
            Math.abs(signature.centroid[1] - 2) < 1e-7 &&
            Math.abs(signature.centroid[2] - 10) < 1e-7,
        ),
      ).toBe(true)
    } finally {
      reversed.delete()
    }
    expect(() =>
      chamferOcctShapeV3(
        occt,
        source,
        { ...parameters, tangentPropagation: true },
        [selection, { ...selection, edgeKey: second.hashCode }],
        [second.hashCode],
      ),
    ).toThrow("conflict within one native tangent contour")
    expect(shapeVolume(source)).toBeCloseTo(2400, 8)
  } finally {
    for (const edge of edges) edge.delete()
    for (const face of faces) face.delete()
    source.delete()
  }
})

it("measures native distance-angle setbacks and flipped side on the selected kernel build", () => {
  const source = splitEdgeSource()
  const edges = source.edges,
    faces = source.faces
  try {
    const edge = edges.find((value) => {
      const box = value.boundingBox
      try {
        const [min, max] = box.bounds
        return Math.abs(min[1]) < 1e-6 && Math.abs(max[1]) < 1e-6 && Math.abs(min[2] - 10) < 1e-6
      } finally {
        box.delete()
      }
    })
    const face = faces.find((value) => {
      const center = value.center
      try {
        return Math.abs(center.toTuple()[2] - 10) < 1e-7
      } finally {
        center.delete()
      }
    })
    if (!edge || !face) throw new Error("Exact top edge and face are required.")
    for (const flip of [false, true]) {
      const shape = chamferOcctShapeV3(
        occt,
        source,
        {
          mode: "distance-angle",
          distance: 2,
          angle: Math.PI / 6,
          measurement: "offset",
          flip,
          tangentPropagation: true,
        },
        [{ kind: "edge", edgeKey: edge.hashCode, sideFaceKey: face.hashCode }],
        [],
      )
      try {
        const other = 2 * Math.tan(Math.PI / 6)
        expect(shapeVolume(shape)).toBeCloseTo(2400 - 20 * other, 6)
        const candidates = captureReplicadTopologySnapshot(shape).candidates
        for (const point of [
          [0, flip ? other : 2, 10],
          [0, 0, 10 - (flip ? 2 : other)],
        ])
          expect(
            candidates.some(
              ({ kind, signature }) =>
                kind === "vertex" &&
                point.every(
                  (coordinate, axis) =>
                    Math.abs(coordinate - (signature.centroid[axis] ?? Infinity)) < 1e-6,
                ),
            ),
          ).toBe(true)
      } finally {
        shape.delete()
      }
    }
    expect(shapeVolume(source)).toBeCloseTo(2400, 8)
  } finally {
    for (const edge of edges) edge.delete()
    for (const face of faces) face.delete()
    source.delete()
  }
})
