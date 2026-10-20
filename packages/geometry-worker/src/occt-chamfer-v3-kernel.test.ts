import { beforeAll, expect, it } from "bun:test"
import { draw, measureShapeVolumeProperties, type Shape3D, setOC } from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { chamferOcctShapeV3 } from "./occt-chamfer-v3"
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
      expect(measureShapeVolumeProperties(built).volume).toBeCloseTo(2380, 6)
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
      expect(measureShapeVolumeProperties(complete).volume).toBeCloseTo(2380, 6)
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
      expect(measureShapeVolumeProperties(reversed).volume).toBeCloseTo(2380, 6)
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
    expect(measureShapeVolumeProperties(source).volume).toBeCloseTo(2400, 8)
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
        expect(measureShapeVolumeProperties(shape).volume).toBeCloseTo(2400 - 20 * other, 6)
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
    expect(measureShapeVolumeProperties(source).volume).toBeCloseTo(2400, 8)
  } finally {
    for (const edge of edges) edge.delete()
    for (const face of faces) face.delete()
    source.delete()
  }
})
