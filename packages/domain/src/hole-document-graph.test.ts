import { describe, expect, it } from "vitest"
import { createDocumentDependencyGraph } from "./document-graph"
import { featureIdSchema } from "./identifiers"
import { createLengthQuantity } from "./units"

const id = (value: string) => `00000000-0000-7000-8000-00000000000${value}`

const sketch = (value: string, supportFeatureId?: string) => ({
  schemaVersion: 0 as const,
  id: id(value),
  label: `Sketch ${value}`,
  plane: "xy" as const,
  entities: [],
  constraints: [],
  ...(supportFeatureId
    ? { support: { kind: "feature-face" as const, reference: faceReference(supportFeatureId) } }
    : {}),
})

const faceReference = (featureId: string) => ({
  schemaVersion: 0 as const,
  featureId: id(featureId),
  kind: "face" as const,
  signature: {
    kind: "face" as const,
    geometryClass: "PLANE",
    measure: 1,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 1, 0] as [number, number, number],
    },
    boundaryCount: 4,
    adjacentGeometryClasses: [],
  },
})

const ordinaryFeature = (value: string, dependencies: string[] = []) => ({
  schemaVersion: 0 as const,
  id: id(value),
  type: {
    moduleId: "org.vibeshape.test.core",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.test.feature.box",
    schemaVersion: 1,
  },
  parameters: {},
  dependencies: dependencies.map(id),
  references: [],
  suppressed: false,
})

const hole = (
  value: string,
  profileSketchId = "1",
  dependencies: string[] = ["3"],
  references: unknown[] = [],
) => ({
  schemaVersion: 0 as const,
  id: id(value),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.hole",
    schemaVersion: 1,
  },
  parameters: {
    sketchId: id(profileSketchId),
    pointIds: [id("9")],
    diameter: createLengthQuantity(8),
    direction: "forward" as const,
    extent: "blind" as const,
    depth: createLengthQuantity(12),
  },
  dependencies: dependencies.map(id),
  references,
  suppressed: false,
})

const history = (...refs: Array<["sketch" | "feature", string]>) =>
  refs.map(([kind, value]) => ({ kind, id: id(value) }))

describe("Hole document dependency graph integration", () => {
  it("registers the sketch semantic input and preserves target-first support order", () => {
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1", "3")],
      features: [ordinaryFeature("3"), hole("2", "1", ["3"], [faceReference("3")])],
      history: history(["feature", "3"], ["sketch", "1"], ["feature", "2"]),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        {
          source: { kind: "sketch", id: id("1") },
          target: { kind: "feature", id: id("2") },
          relation: "semantic-input",
        },
        {
          source: { kind: "feature", id: id("3") },
          target: { kind: "feature", id: id("2") },
          relation: "feature-dependency",
        },
      ]),
    )
    expect(
      result.graph.dependenciesOf({ kind: "feature", id: featureIdSchema.parse(id("2")) }),
    ).toEqual(
      expect.arrayContaining([
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
      ]),
    )
  })

  it("deduplicates a target that also owns sketch support and accepts distinct support", () => {
    const sameOwner = createDocumentDependencyGraph({
      sketches: [sketch("1", "3")],
      features: [ordinaryFeature("3"), hole("2", "1", ["3"], [faceReference("3")])],
      history: history(["feature", "3"], ["sketch", "1"], ["feature", "2"]),
    })
    expect(sameOwner).toMatchObject({ ok: true })

    const distinct = createDocumentDependencyGraph({
      sketches: [sketch("1", "3")],
      features: [
        ordinaryFeature("3"),
        ordinaryFeature("4"),
        hole("2", "1", ["4", "3"], [faceReference("3")]),
      ],
      history: history(["feature", "3"], ["feature", "4"], ["sketch", "1"], ["feature", "2"]),
    })
    expect(distinct).toMatchObject({ ok: true })
  })

  it("rejects support references that do not match the selected sketch", () => {
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1", "3")],
      features: [ordinaryFeature("3"), hole("2", "1", ["3"], [])],
      history: history(["feature", "3"], ["sketch", "1"], ["feature", "2"]),
    })
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature" } })
  })

  it.each([
    [
      "missing sketch",
      {
        sketches: [sketch("9")],
        features: [ordinaryFeature("3"), hole("2")],
        history: history(["feature", "3"], ["sketch", "9"], ["feature", "2"]),
      },
    ],
    [
      "forward target",
      {
        sketches: [sketch("1")],
        features: [hole("2", "1", ["3"]), ordinaryFeature("3")],
        history: history(["sketch", "1"], ["feature", "2"], ["feature", "3"]),
      },
    ],
    [
      "cycle",
      {
        sketches: [sketch("1")],
        features: [ordinaryFeature("3", ["2"]), hole("2", "1", ["3"])],
        history: history(["sketch", "1"], ["feature", "3"], ["feature", "2"]),
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(createDocumentDependencyGraph(input)).toMatchObject({ ok: false })
  })

  it("accepts migrated v1 semantic inputs and rejects a mismatched declaration", () => {
    const migrated = {
      ...hole("2", "1", ["3"]),
      schemaVersion: 1 as const,
      semanticInputs: [{ kind: "sketch" as const, id: id("1") }],
    }
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1")],
      features: [ordinaryFeature("3"), migrated],
      history: history(["feature", "3"], ["sketch", "1"], ["feature", "2"]),
    })
    expect(result).toMatchObject({ ok: true })
    const mismatch = createDocumentDependencyGraph({
      sketches: [sketch("1")],
      features: [ordinaryFeature("3"), { ...migrated, semanticInputs: [] }],
      history: history(["feature", "3"], ["sketch", "1"], ["feature", "2"]),
    })
    expect(mismatch).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature" } })
  })
})
