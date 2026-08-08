import { describe, expect, it, vi } from "vitest"
import {
  createFeatureGraph,
  evaluateFeatureGraph,
  type FeatureEvaluationContext,
  type FeatureEvaluationRecord,
  type FeatureRecord,
  featureRecordSchema,
} from "./feature-graph"
import { topoRefSchema, topologySignatureSchema } from "./topology"

const featureIds = {
  a: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
  b: "0195b5ac-b220-7a2c-8c33-67a36a7f3102",
  c: "0195b5ac-b220-7a2c-8c33-67a36a7f3103",
  d: "0195b5ac-b220-7a2c-8c33-67a36a7f3104",
} as const

function feature(
  id: (typeof featureIds)[keyof typeof featureIds],
  dependencies: string[] = [],
  values: Partial<FeatureRecord> = {},
) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.test",
      schemaVersion: 1,
    },
    parameters: { length: 10 },
    dependencies,
    references: [],
    suppressed: false,
    ...values,
  })
}

function requireGraph(inputs: readonly FeatureRecord[]) {
  const result = createFeatureGraph(inputs)
  if (!result.ok) throw new Error(`${result.diagnostic.code}: ${result.diagnostic.message}`)
  return result.graph
}

function succeeded(featureId: string, digit: string): FeatureEvaluationRecord {
  return {
    featureId: featureId as FeatureEvaluationRecord["featureId"],
    status: "succeeded",
    contentHash: digit.repeat(64),
  }
}

function recordById(records: readonly FeatureEvaluationRecord[], featureId: string) {
  return records.find((record) => record.featureId === featureId)
}

describe("feature graph", () => {
  it("builds a stable topological order without replacing presentation order", () => {
    const graph = requireGraph([
      feature(featureIds.c, [featureIds.b]),
      feature(featureIds.d),
      feature(featureIds.a),
      feature(featureIds.b, [featureIds.a]),
    ])

    expect(graph.features.map(({ id }) => id)).toEqual([
      featureIds.c,
      featureIds.d,
      featureIds.a,
      featureIds.b,
    ])
    expect(graph.evaluationOrder.map(({ id }) => id)).toEqual([
      featureIds.d,
      featureIds.a,
      featureIds.b,
      featureIds.c,
    ])
    expect(graph.dependenciesOf(featureIds.c).map(({ id }) => id)).toEqual([featureIds.b])
    expect(graph.dependentsOf(featureIds.a).map(({ id }) => id)).toEqual([featureIds.b])
  })

  it("rejects duplicate IDs, missing dependencies, and cycles", () => {
    expect(createFeatureGraph([feature(featureIds.a), feature(featureIds.a)])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-feature" },
    })
    expect(createFeatureGraph([feature(featureIds.b, [featureIds.a])])).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-feature-dependency" },
    })
    expect(
      createFeatureGraph([
        feature(featureIds.a, [featureIds.b]),
        feature(featureIds.b, [featureIds.a]),
      ]),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-dependency-cycle" } })
  })

  it("requires topology references to name declared dependencies", () => {
    const reference = topoRefSchema.parse({
      schemaVersion: 0,
      featureId: featureIds.a,
      kind: "face",
      signature: topologySignatureSchema.parse({
        kind: "face",
        geometryClass: "plane",
        measure: 100,
        centroid: [0, 0, 0],
        bounds: { min: [-5, -5, 0], max: [5, 5, 0] },
        direction: [0, 0, 1],
        directionMode: "oriented",
        boundaryCount: 4,
        adjacentGeometryClasses: ["line", "line", "line", "line"],
      }),
    })
    const invalidReferenceOwner = {
      ...feature(featureIds.b, [featureIds.a], { references: [reference] }),
      dependencies: [],
    }
    expect(createFeatureGraph([feature(featureIds.a), invalidReferenceOwner])).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature" },
    })
    expect(
      createFeatureGraph([
        feature(featureIds.a),
        feature(featureIds.b, [featureIds.a], { references: [reference] }),
      ]),
    ).toMatchObject({ ok: true })
  })
})

describe("feature graph evaluation", () => {
  it("evaluates uncached features in dependency order", () => {
    const graph = requireGraph([
      feature(featureIds.c, [featureIds.b]),
      feature(featureIds.a),
      feature(featureIds.b, [featureIds.a]),
    ])
    const observed: string[] = []
    const result = evaluateFeatureGraph(graph, {
      changedFeatureIds: [],
      evaluate(context) {
        observed.push(context.feature.id)
        expect(context.dependencies.every(({ status }) => status === "succeeded")).toBe(true)
        return { status: "succeeded", contentHash: String(observed.length).repeat(64) }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(observed).toEqual([featureIds.a, featureIds.b, featureIds.c])
    expect(result.evaluation.records.map(({ featureId }) => featureId)).toEqual([
      featureIds.c,
      featureIds.a,
      featureIds.b,
    ])
    expect(result.evaluation.dirtyFeatureIds).toEqual([featureIds.a, featureIds.b, featureIds.c])
  })

  it("rebuilds changed descendants while reusing independent results", () => {
    const graph = requireGraph([
      feature(featureIds.a),
      feature(featureIds.b, [featureIds.a]),
      feature(featureIds.c),
    ])
    const evaluate = vi.fn((_context: FeatureEvaluationContext) => ({
      status: "succeeded" as const,
      contentHash: "9".repeat(64),
    }))
    const result = evaluateFeatureGraph(graph, {
      changedFeatureIds: [featureIds.a],
      previousResults: [
        succeeded(featureIds.a, "1"),
        succeeded(featureIds.b, "2"),
        succeeded(featureIds.c, "3"),
      ],
      evaluate,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(evaluate.mock.calls.map(([context]) => context.feature.id)).toEqual([
      featureIds.a,
      featureIds.b,
    ])
    expect(result.evaluation.reusedFeatureIds).toEqual([featureIds.c])
    expect(recordById(result.evaluation.records, featureIds.c)).toEqual(
      succeeded(featureIds.c, "3"),
    )
  })

  it("blocks only failed descendants and continues independent branches", () => {
    const graph = requireGraph([
      feature(featureIds.a),
      feature(featureIds.b, [featureIds.a]),
      feature(featureIds.c),
    ])
    const evaluated: string[] = []
    const result = evaluateFeatureGraph(graph, {
      changedFeatureIds: [],
      evaluate({ feature: current }) {
        evaluated.push(current.id)
        return current.id === featureIds.a
          ? {
              status: "failed",
              diagnostics: [{ code: "org.vibeshape.feature.boolean-failed", values: {} }],
            }
          : { status: "succeeded", contentHash: "4".repeat(64) }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(evaluated).toEqual([featureIds.a, featureIds.c])
    expect(recordById(result.evaluation.records, featureIds.b)).toEqual({
      featureId: featureIds.b,
      status: "blocked",
      blockedBy: [featureIds.a],
    })
    expect(recordById(result.evaluation.records, featureIds.c)?.status).toBe("succeeded")
  })

  it("marks suppressed features and blocks their dependent branch", () => {
    const graph = requireGraph([
      feature(featureIds.a, [], { suppressed: true }),
      feature(featureIds.b, [featureIds.a]),
      feature(featureIds.c),
    ])
    const evaluate = vi.fn((_context: FeatureEvaluationContext) => ({
      status: "succeeded" as const,
      contentHash: "5".repeat(64),
    }))
    const result = evaluateFeatureGraph(graph, { changedFeatureIds: [], evaluate })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(recordById(result.evaluation.records, featureIds.a)?.status).toBe("suppressed")
    expect(recordById(result.evaluation.records, featureIds.b)).toEqual({
      featureId: featureIds.b,
      status: "blocked",
      blockedBy: [featureIds.a],
    })
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0]?.[0].feature.id).toBe(featureIds.c)
  })

  it("contains thrown and invalid evaluator outcomes as stable failures", () => {
    const graph = requireGraph([feature(featureIds.a), feature(featureIds.c)])
    const result = evaluateFeatureGraph(graph, {
      changedFeatureIds: [],
      evaluate({ feature: current }) {
        if (current.id === featureIds.a) throw new Error("native detail must not escape")
        return { status: "succeeded", contentHash: "invalid" }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evaluation.records).toEqual([
      {
        featureId: featureIds.a,
        status: "failed",
        diagnostics: [{ code: "org.vibeshape.feature.evaluator-threw", values: {} }],
      },
      {
        featureId: featureIds.c,
        status: "failed",
        diagnostics: [{ code: "org.vibeshape.feature.invalid-evaluator-output", values: {} }],
      },
    ])
  })

  it("fails closed on unknown dirty features and invalid cached results", () => {
    const graph = requireGraph([feature(featureIds.a)])
    const evaluate = () => ({ status: "succeeded", contentHash: "6".repeat(64) })
    expect(
      evaluateFeatureGraph(graph, { changedFeatureIds: [featureIds.b], evaluate }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-dirty-feature" } })
    expect(
      evaluateFeatureGraph(graph, {
        changedFeatureIds: [],
        previousResults: [succeeded(featureIds.b, "7")],
        evaluate,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-previous-feature-result" } })
    expect(
      evaluateFeatureGraph(graph, {
        changedFeatureIds: [],
        previousResults: [
          { featureId: featureIds.a, status: "blocked", blockedBy: [featureIds.b] },
        ],
        evaluate,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-previous-feature-result" } })
  })
})
