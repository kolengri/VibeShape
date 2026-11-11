import { describe, expect, it } from "bun:test"
import type { FeatureGeometryRecord } from "@vibeshape/application/feature-rebuild"
import { documentSnapshotSchema, type SketchRecord, sketchRecordSchema } from "@vibeshape/domain"
import { compileSketchSystem, type SolveSketchRecordResult } from "@vibeshape/sketch-solver"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  inspectExternalModelReferenceHealth,
  resolveExternalSketchGeometry,
} from "./external-sketch-references"

type Point = [number, number, number]

const id = (suffix: string) => `0195b5ac-b220-7a2c-8c33-67a36a7f${suffix}`
const featureId = id("5100")
const curveIds = [id("5101"), id("5102")]
const pointIds = Array.from({ length: 7 }, (_, index) =>
  id(`52${index.toString().padStart(2, "0")}`),
)
const signature = {
  kind: "edge" as const,
  geometryClass: "BSPLINE_CURVE",
  measure: 24,
  centroid: [10, 2, 5],
  bounds: { min: [0, 0, 5], max: [20, 4, 5] },
  boundaryCount: 2,
  adjacentGeometryClasses: [],
}

type Anchors = readonly [Point, Point]
const waveAnchors: Anchors = [
  [0, 0, 5],
  [20, 0, 5],
]

function sketch(
  plane: "xy" | "xz" = "xy",
  segments = 2,
  endpointAnchors: Anchors = waveAnchors,
): SketchRecord {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id("5300"),
    label: "Spline reference",
    plane,
    entities: [],
    constraints: [],
    externalReferences: [
      {
        schemaVersion: 0,
        id: id("5301"),
        kind: "model-spline",
        reference: {
          schemaVersion: 0,
          featureId,
          kind: "edge",
          semanticRole: "edge.spline",
          signature,
        },
        endpointAnchors,
        projectedCurveIds: curveIds.slice(0, segments),
        projectedPointIds: pointIds.slice(0, segments * 3 + 1),
      },
    ],
  })
}

function document(target: SketchRecord) {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id("5302"),
    revision: 1,
    name: "Spline model reference",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    sketches: [target],
    features: [
      {
        schemaVersion: 0,
        id: featureId,
        type: {
          moduleId: "org.vibeshape.test",
          moduleVersion: "0.1.0",
          typeId: "org.vibeshape.test.fixture",
          schemaVersion: 1,
        },
        parameters: {},
        dependencies: [],
        references: [],
        suppressed: false,
      },
    ],
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  })
}

function geometry(poles: readonly Point[] | null, candidates = 1) {
  return [
    {
      featureId,
      geometry: {
        topologyCandidates: Array.from({ length: candidates }, (_, index) => ({
          candidateId: `edge:spline-${index}`,
          kind: "edge",
          semanticRole: "edge.spline",
          lineageTokens: [],
          signature,
          ...(poles
            ? { referenceGeometry: { kind: "bezier-chain-edge", poles, maxDeviation: 2e-5 } }
            : {}),
        })),
      },
    },
  ] as unknown as readonly FeatureGeometryRecord[]
}

const wave: Point[] = [
  [0, 0, 5],
  [3, 4, 5],
  [7, 4, 5],
  [10, 0, 5],
  [13, -4, 5],
  [17, -4, 5],
  [20, 0, 5],
]

const solve = vi.fn((): SolveSketchRecordResult => {
  throw new Error("Model references must not solve another sketch.")
})

async function resolve(target: SketchRecord, records: readonly FeatureGeometryRecord[]) {
  return resolveExternalSketchGeometry(document(target), target, solve, [], new Map(), records)
}

describe("model spline references", () => {
  it("projects a parallel chain onto stable read-only cubic identities", async () => {
    const target = sketch()
    const result = await resolve(target, geometry(wave))
    const [chain] = result.externalCurveChains ?? []
    if (!chain) throw new Error("The spline reference must materialize one chain.")
    expect(chain.points.map(({ id: pointId }) => pointId)).toEqual(pointIds)
    expect(chain.points.map(({ x, y }) => [x, y])).toEqual(wave.map(([x, y]) => [x, y]))
    expect(chain.curves).toEqual([
      expect.objectContaining({
        id: curveIds[0],
        type: "cubic-bezier",
        construction: true,
        startPointId: pointIds[0],
        endPointId: pointIds[3],
      }),
      expect.objectContaining({
        id: curveIds[1],
        startPointId: pointIds[3],
        control1PointId: pointIds[4],
        endPointId: pointIds[6],
      }),
    ])
    // The solver accepts the chain as fixed external geometry beside the authored sketch.
    expect(compileSketchSystem({ revision: 1, sketch: target, ...result }).ok).toBe(true)
  })

  it("recomputes the same identities from the current edge and subdivides a coarser fit exactly", async () => {
    const target = sketch()
    const moved = wave.map(([x, y, z]): Point => [x, y * 2, z])
    const recomputed = await resolve(target, geometry(moved))
    expect(recomputed.externalCurveChains?.[0]?.points.map(({ y }) => y)).toEqual(
      moved.map(([, y]) => y),
    )
    // A rebuild that needs one segment still fills two persisted segments on the same curve.
    const single: Point[] = [
      [0, 0, 5],
      [6, 6, 5],
      [14, 6, 5],
      [20, 0, 5],
    ]
    const subdivided = await resolve(target, geometry(single))
    const points = subdivided.externalCurveChains?.[0]?.points ?? []
    expect(points.map(({ id: pointId }) => pointId)).toEqual(pointIds)
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[3]?.x).toBeCloseTo(10, 12)
    expect(points[3]?.y).toBeCloseTo(4.5, 12)
    expect(points[6]).toMatchObject({ x: 20, y: 0 })
  })

  it("fails closed for tilted, over-budget, unfitted, missing and ambiguous sources", async () => {
    await expect(resolve(sketch("xz"), geometry(wave))).rejects.toThrow(
      /plane parallel to the sketch/,
    )
    await expect(resolve(sketch("xy", 1), geometry(wave))).rejects.toThrow(
      /more than its 1 projected Bezier segment\(s\).*Repair it with an edge/,
    )
    const spatial = wave.map(([x, y]): Point => [x, y, 5 + x * 0.01])
    await expect(resolve(sketch(), geometry(spatial))).rejects.toThrow(/plane parallel/)
    await expect(resolve(sketch(), geometry(null))).rejects.toThrow(
      /cannot be fitted within 0.0001/,
    )
    await expect(resolve(sketch(), [])).rejects.toThrow(/geometry is unavailable/)
    await expect(resolve(sketch(), geometry(wave, 2))).rejects.toThrow(/is ambiguous/)
    const target = sketch("xz")
    expect(await inspectExternalModelReferenceHealth(document(target), [], geometry(wave))).toEqual(
      [{ sketchId: target.id, referenceId: id("5301"), status: "broken" }],
    )
  })

  it("keeps end identities on the same physical ends across rebuilds", async () => {
    const endsOf = async (target: SketchRecord, poles: readonly Point[]) => {
      const points = (await resolve(target, geometry(poles))).externalCurveChains?.[0]?.points ?? []
      return [points[0], points.at(-1)].map((point) => [point?.x, point?.y])
    }
    const cubic = (start: Point, end: Point): Point[] => [
      start,
      [start[0] + 3, start[1] + 3, 5],
      [end[0] + 3, end[1] - 3, 5],
      end,
    ]
    // Codex counterexample: the lexicographically smaller end flips after a 0.002 mm edit.
    const anchored = sketch("xy", 1, [
      [0, 0, 5],
      [-0.001, 10, 5],
    ])
    const flipped = cubic([0.001, 10, 5], [0, 0, 5])
    expect(await endsOf(anchored, flipped)).toEqual([
      [0, 0],
      [0.001, 10],
    ])
    // A reversed parameterization of the same edge resolves to the same ends.
    expect(await endsOf(anchored, [...flipped].reverse())).toEqual([
      [0, 0],
      [0.001, 10],
    ])
    // A genuine large move keeps the pairing with the smaller summed displacement.
    const moved = cubic([57, 13, 5], [50, 4, 5])
    expect(await endsOf(anchored, moved)).toEqual([
      [50, 4],
      [57, 13],
    ])
    // Reload: the anchors persist with the reference, so a reopened sketch pairs identically.
    const reopened = sketchRecordSchema.parse(JSON.parse(JSON.stringify(anchored)))
    expect(await endsOf(reopened, flipped)).toEqual([
      [0, 0],
      [0.001, 10],
    ])
  })

  it("fails closed when both end pairings are equally plausible, but accepts closed chains", async () => {
    const anchored = sketch("xy", 1, [
      [0, 0, 5],
      [0, 10, 5],
    ])
    // Sliding the edge along its own chord by more than its length makes both pairings equal.
    const slid: Point[] = [
      [0, 30, 5],
      [3, 33, 5],
      [3, 37, 5],
      [0, 40, 5],
    ]
    await expect(resolve(anchored, geometry(slid))).rejects.toThrow(/re-anchor its end points/)
    const target = sketch("xy", 1, [
      [0, 0, 5],
      [0, 10, 5],
    ])
    expect(await inspectExternalModelReferenceHealth(document(target), [], geometry(slid))).toEqual(
      [{ sketchId: target.id, referenceId: id("5301"), status: "broken" }],
    )
    // A closed chain starts and ends at its seam, so either orientation keeps the end identities.
    const loop: Point[] = [
      [0, 0, 5],
      [10, 10, 5],
      [-10, 10, 5],
      [0, 0, 5],
    ]
    const closed = await resolve(anchored, geometry(loop))
    expect(closed.externalCurveChains?.[0]?.points[0]).toMatchObject({ x: 0, y: 0 })
  })
})
