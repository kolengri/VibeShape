import { describe, expect, it, spyOn } from "bun:test"
import {
  createDocumentDependencyGraph,
  createDocumentDependencyGraphFromSnapshot,
  deriveLegacyHistory,
  type LegacyDocumentSnapshot,
} from "./document-graph"
import { featureRecordSchema, versionedFeatureRecordSchema } from "./feature-graph"
import { boxFeatureType } from "./part-design"

function feature(index: number, dependencies: number[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: `0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`,
    type: boxFeatureType.type,
    parameters: {},
    dependencies: dependencies.map(
      (dependency) => `0195b5ac-b220-7a2c-8c33-${String(dependency).padStart(12, "0")}`,
    ),
    references: [],
    suppressed: false,
  })
}

describe("snapshot dependency graph preparation", () => {
  it("validates each feature once and retains independently parsed records", () => {
    const first = feature(1)
    const second = feature(2, [1])
    const features = [first, second, feature(3)]
    const parse = spyOn(versionedFeatureRecordSchema, "safeParse")
    try {
      const result = createDocumentDependencyGraphFromSnapshot({ sketches: [], features })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("Expected a valid graph.")
      expect(parse).toHaveBeenCalledTimes(3)
      const source = { kind: "feature" as const, id: first.id }
      const consumer = { kind: "feature" as const, id: second.id }
      expect(result.graph.getNode(source)?.record).toEqual(first)
      expect(result.graph.getNode(source)?.record).not.toBe(first)
      expect(result.graph.dependenciesOf(consumer)).toEqual([source])
      expect(result.graph.dependentsOf(source)).toEqual([consumer])
    } finally {
      parse.mockRestore()
    }
  })

  it.each([
    { name: "independent roots", features: [feature(3), feature(1), feature(2)] },
    { name: "out-of-order branch", features: [feature(3, [2]), feature(1), feature(2, [1])] },
    { name: "duplicate node", features: [feature(1), feature(1)] },
    { name: "missing source", features: [feature(1, [99])] },
    { name: "cycle", features: [feature(1, [2]), feature(2, [1])] },
    { name: "malformed record", features: [{ ...feature(1), suppressed: "invalid" }] },
    {
      name: "opaque dependency model",
      features: [
        {
          ...feature(1),
          type: { ...boxFeatureType.type, typeId: "org.vibeshape.feature.extension.opaque" },
        },
      ],
    },
  ])("preserves the explicit history pipeline for $name", ({ features }) => {
    const input: LegacyDocumentSnapshot = { sketches: [], features }
    const history = deriveLegacyHistory(input)
    const expected = history.ok
      ? createDocumentDependencyGraph({ ...input, history: history.history })
      : history
    const actual = createDocumentDependencyGraphFromSnapshot(input)
    if (!expected.ok) {
      expect(actual).toEqual(expected)
      return
    }
    expect(actual.ok).toBe(true)
    if (!actual.ok) throw new Error("Expected the same valid graph.")
    expect(actual.graph.nodes).toEqual(expected.graph.nodes)
    expect(actual.graph.edges).toEqual(expected.graph.edges)
    expect(actual.graph.history).toEqual(expected.graph.history)
    expect(actual.graph.evaluationOrder).toEqual(expected.graph.evaluationOrder)
    expect(actual.graph.dependencyModelIssues).toEqual(expected.graph.dependencyModelIssues)
    for (const { ref } of expected.graph.nodes) {
      expect(actual.graph.dependenciesOf(ref)).toEqual(expected.graph.dependenciesOf(ref))
      expect(actual.graph.dependentsOf(ref)).toEqual(expected.graph.dependentsOf(ref))
      expect(actual.graph.deletionBlockersFor(ref)).toEqual(expected.graph.deletionBlockersFor(ref))
    }
  })
})
