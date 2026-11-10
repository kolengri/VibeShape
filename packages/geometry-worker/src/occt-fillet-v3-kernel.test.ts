import { beforeAll, expect, it } from "bun:test"
import {
  draw,
  drawRoundedRectangle,
  makeBox,
  makeCylinder,
  measureShapeVolumeProperties,
  type Shape3D,
  setOC,
} from "replicad"
import initializeOpenCascade, { type OpenCascadeInstance } from "replicad-opencascadejs"
import { inspectOcctBody } from "./occt-body-validation"
import { compareFilletEndpoints, filletOcctShapeV3 } from "./occt-fillet-v3"
import { captureReplicadTopologySnapshot } from "./topology-signatures"

let occt: OpenCascadeInstance
beforeAll(async () => {
  const { readFileSync } = await import("node:fs")
  const base = new URL("../node_modules/replicad-opencascadejs/src/", import.meta.url)
  const wasmBinary = readFileSync(new URL("replicad_single.wasm", base))
  occt = await Reflect.apply(initializeOpenCascade, undefined, [{ wasmBinary }])
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

type Point = readonly [number, number, number]
type EdgeFixture = { key: number; start: Point; end: Point; length: number }

/** Exact straight edges with their endpoints ordered by the persisted canonical rule. */
function straightEdges(source: Shape3D): EdgeFixture[] {
  const snapshot = captureReplicadTopologySnapshot(source)
  return snapshot.candidates.flatMap((candidate) => {
    const key = snapshot.transientShapeKeys.get(candidate.candidateId)
    if (
      candidate.kind !== "edge" ||
      candidate.signature.geometryClass !== "LINE" ||
      key === undefined
    )
      return []
    const { min, max } = candidate.signature.bounds
    // Axis-aligned fixtures: the bounding-box corners are the two endpoints.
    const ends = [min, max].map((point) => [point[0], point[1], point[2]] as unknown as Point)
    const [start, end] = ends.sort(compareFilletEndpoints) as [Point, Point]
    return [{ key, start, end, length: candidate.signature.measure }]
  })
}

const near = (value: number, expected: number) => Math.abs(value - expected) < 1e-5

function vertices(shape: Shape3D): Point[] {
  return captureReplicadTopologySnapshot(shape).candidates.flatMap(({ kind, signature }) =>
    kind === "vertex" ? [signature.centroid as unknown as Point] : [],
  )
}

/** The fillet setback at an original corner equals the radius used at that end. */
function setbackAt(shape: Shape3D, point: Point) {
  return Math.min(
    ...vertices(shape)
      .map((vertex) => Math.hypot(...vertex.map((value, axis) => value - (point[axis] ?? 0))))
      .filter((distance) => distance > 1e-6),
  )
}

function boxSource() {
  return makeBox([0, 0, 0], [20, 12, 10])
}

function mirroredSource() {
  return draw([0, 0])
    .lineTo([20, 0])
    .lineTo([20, 12])
    .lineTo([0, 12])
    .close()
    .sketchOnPlane("XY")
    .extrude(10)
    .asShape3D()
    .mirror("YZ", [0, 0, 0])
}

it("removes the analytic constant-radius volume from one box edge without changing the source", () => {
  const source = boxSource()
  try {
    const before = captureReplicadTopologySnapshot(source).candidates
    for (const edge of straightEdges(source)) {
      for (const radius of [1, 2.5]) {
        const built = filletOcctShapeV3(occt, source, radius, [{ kind: "edge", edgeKey: edge.key }])
        try {
          expect(inspectOcctBody(occt, built)).toMatchObject({ valid: true, solidCount: 1 })
          const removed = radius ** 2 * (1 - Math.PI / 4) * edge.length
          expect(shapeVolume(built)).toBeCloseTo(2400 - removed, 6)
        } finally {
          built.delete()
        }
      }
    }
    expect(shapeVolume(source)).toBeCloseTo(2400, 8)
    expect(captureReplicadTopologySnapshot(source).candidates).toEqual(before)
  } finally {
    source.delete()
  }
})

it.each([
  ["box", boxSource],
  ["mirrored extrusion", mirroredSource],
] as const)(
  "applies the canonical endpoint rule to every %s edge, independent of native orientation",
  (_name, create) => {
    const source = create()
    try {
      const edges = straightEdges(source)
      expect(edges).toHaveLength(12)
      for (const edge of edges)
        for (const reverse of [false, true]) {
          const built = filletOcctShapeV3(occt, source, 1, [
            {
              kind: "edge",
              edgeKey: edge.key,
              variableRadius: { startRadius: 1, endRadius: 3, reverse },
            },
          ])
          try {
            expect(inspectOcctBody(occt, built)).toMatchObject({ valid: true, solidCount: 1 })
            expect(setbackAt(built, edge.start)).toBeCloseTo(reverse ? 3 : 1, 6)
            expect(setbackAt(built, edge.end)).toBeCloseTo(reverse ? 1 : 3, 6)
          } finally {
            built.delete()
          }
        }
    } finally {
      source.delete()
    }
  },
)

it("bounds variable-radius removal between the constant start and end cases and rebuilds identically", () => {
  const edgeAt = (source: Shape3D) => {
    const edge = straightEdges(source).find(
      ({ start, end }) => near(start[1], 0) && near(start[2], 10) && near(end[0], 20),
    )
    if (!edge) throw new Error("The top front box edge is required.")
    return edge
  }
  const first = boxSource()
  const reopened = boxSource()
  try {
    const law = { startRadius: 1, endRadius: 3, reverse: false }
    const edge = edgeAt(first)
    const variable = filletOcctShapeV3(occt, first, 2, [
      { kind: "edge", edgeKey: edge.key, variableRadius: law },
    ])
    const rebuilt = filletOcctShapeV3(occt, reopened, 2, [
      { kind: "edge", edgeKey: edgeAt(reopened).key, variableRadius: law },
    ])
    const small = filletOcctShapeV3(occt, first, 1, [{ kind: "edge", edgeKey: edge.key }])
    const large = filletOcctShapeV3(occt, first, 3, [{ kind: "edge", edgeKey: edge.key }])
    try {
      expect(inspectOcctBody(occt, variable)).toMatchObject({ valid: true, solidCount: 1 })
      const volume = shapeVolume(variable)
      expect(volume).toBeLessThan(shapeVolume(small))
      expect(volume).toBeGreaterThan(shapeVolume(large))
      expect(shapeVolume(rebuilt)).toBeCloseTo(volume, 8)
      expect(vertices(rebuilt).sort()).toEqual(vertices(variable).sort())
    } finally {
      for (const shape of [variable, rebuilt, small, large]) shape.delete()
    }
  } finally {
    first.delete()
    reopened.delete()
  }
})

it("fillets every native boundary edge of a face target exactly like those edges", () => {
  const source = boxSource()
  const faces = source.faces
  try {
    const snapshot = captureReplicadTopologySnapshot(source)
    const top = snapshot.candidates.find(
      ({ kind, signature }) => kind === "face" && Math.abs(signature.centroid[2] - 10) < 1e-7,
    )
    const faceKey = top && snapshot.transientShapeKeys.get(top.candidateId)
    if (faceKey === undefined) throw new Error("The exact top face is required.")
    const topEdges = straightEdges(source).filter(
      ({ start, end }) => near(start[2], 10) && near(end[2], 10),
    )
    expect(topEdges).toHaveLength(4)
    const byFace = filletOcctShapeV3(occt, source, 1.5, [{ kind: "face", faceKey }])
    const byEdges = filletOcctShapeV3(
      occt,
      source,
      1.5,
      topEdges.map(({ key }) => ({ kind: "edge" as const, edgeKey: key })),
    )
    try {
      expect(inspectOcctBody(occt, byFace)).toMatchObject({ valid: true, solidCount: 1 })
      expect(shapeVolume(byFace)).toBeLessThan(2400)
      expect(shapeVolume(byFace)).toBeCloseTo(shapeVolume(byEdges), 8)
    } finally {
      byFace.delete()
      byEdges.delete()
    }
    const edge = topEdges[0]
    if (!edge) throw new Error("A top edge is required.")
    expect(() =>
      filletOcctShapeV3(occt, source, 1, [
        { kind: "face", faceKey },
        {
          kind: "edge",
          edgeKey: edge.key,
          variableRadius: { startRadius: 1, endRadius: 2, reverse: false },
        },
      ]),
    ).toThrow("also selected through another target")
  } finally {
    for (const face of faces) face.delete()
    source.delete()
  }
})

it("follows the native tangent contour and rejects variable radius where it is not deterministic", () => {
  const outer = makeBox([-40, -32, 0], [40, 32, 12])
  const opening = drawRoundedRectangle(40, 24, 6).sketchOnPlane("XY").extrude(12).asShape3D()
  const source = outer.cut(opening)
  outer.delete()
  opening.delete()
  const cylinder = makeCylinder(10, 20)
  try {
    const snapshot = captureReplicadTopologySnapshot(source)
    const seed = snapshot.candidates.find(
      ({ kind, signature }) =>
        kind === "edge" &&
        signature.geometryClass === "LINE" &&
        Math.abs(signature.bounds.min[2] - 12) < 1e-6 &&
        Math.abs(signature.bounds.max[2] - 12) < 1e-6 &&
        Math.abs(signature.centroid[0]) < 21 &&
        Math.abs(signature.centroid[1]) < 13,
    )
    const edgeKey = seed && snapshot.transientShapeKeys.get(seed.candidateId)
    if (edgeKey === undefined) throw new Error("A straight rounded-opening rim edge is required.")
    const radius = 3
    const contour = filletOcctShapeV3(occt, source, radius, [{ kind: "edge", edgeKey }])
    try {
      const perimeter = 80 + 12 * Math.PI
      const removed =
        perimeter * radius ** 2 * (1 - Math.PI / 4) + Math.PI * radius ** 3 * (5 / 3 - Math.PI / 2)
      expect(shapeVolume(contour)).toBeCloseTo(shapeVolume(source) - removed, 5)
    } finally {
      contour.delete()
    }
    const law = { startRadius: 1, endRadius: 2, reverse: false }
    expect(() =>
      filletOcctShapeV3(occt, source, radius, [{ kind: "edge", edgeKey, variableRadius: law }]),
    ).toThrow("native tangent contour is that edge alone")
    const rims = captureReplicadTopologySnapshot(cylinder)
    const rim = rims.candidates.find(
      ({ kind, signature }) => kind === "edge" && signature.geometryClass === "CIRCLE",
    )
    const rimKey = rim && rims.transientShapeKeys.get(rim.candidateId)
    if (rimKey === undefined) throw new Error("A closed circular rim is required.")
    expect(() =>
      filletOcctShapeV3(occt, cylinder, 1, [
        { kind: "edge", edgeKey: rimKey, variableRadius: law },
      ]),
    ).toThrow("native tangent contour is that edge alone")
    expect(() => filletOcctShapeV3(occt, source, radius, [{ kind: "edge", edgeKey: -1 }])).toThrow(
      "missing from the exact source",
    )
    expect(() => filletOcctShapeV3(occt, source, 40, [{ kind: "edge", edgeKey }])).toThrow(
      "Reduce the radius",
    )
  } finally {
    source.delete()
    cylinder.delete()
  }
})
