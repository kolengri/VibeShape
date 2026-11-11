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

function sketch(plane: "xy" | "xz" = "xy", segments = 2): SketchRecord {
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
      /replace the reference to refit it/,
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
})
