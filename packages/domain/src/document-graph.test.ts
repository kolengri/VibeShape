import { describe, expect, it } from "vitest"
import {
  createDocumentDependencyGraph,
  createDocumentDependencyGraphFromSnapshot,
  type DocumentNodeRef,
  deriveLegacyHistory,
  deriveLegacyHistoryWithPreferredOrder,
} from "./document-graph"
import { featureRecordV1Schema } from "./feature-graph"
import { createAngleQuantity, createLengthQuantity } from "./units"

const id = (value: string) => `00000000-0000-7000-8000-00000000000${value}`
const feature = (value: string, dependencies: string[] = []) => ({
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

const sketch = (value: string) => ({
  schemaVersion: 0 as const,
  id: id(value),
  label: `Sketch ${value}`,
  plane: "xy" as const,
  entities: [],
  constraints: [],
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

const circleEdgeReference = (featureId: string) => ({
  schemaVersion: 0 as const,
  featureId: id(featureId),
  kind: "edge" as const,
  semanticRole: "primitive.cylinder.edge.start",
  signature: {
    kind: "edge" as const,
    geometryClass: "CIRCLE",
    measure: Math.PI * 10,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [-5, -5, 0] as [number, number, number],
      max: [5, 5, 0] as [number, number, number],
    },
    boundaryCount: 0,
    adjacentGeometryClasses: [],
  },
})

const supportedSketch = (value: string, supportFeatureId: string) => ({
  ...sketch(value),
  support: { kind: "feature-face" as const, reference: faceReference(supportFeatureId) },
})

const extrusion = (value: string, profileSketchId: string, references: unknown[] = []) => ({
  schemaVersion: 0 as const,
  id: id(value),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 2,
  },
  parameters: {
    profile: {
      schemaVersion: 0 as const,
      sketchId: id(profileSketchId),
      outerBoundaryEntityIds: [id("9")],
      holeBoundaryEntityIds: [],
    },
    distance: createLengthQuantity(10),
    symmetric: false,
    operation: "new" as const,
  },
  dependencies: references.length ? [id("3")] : [],
  references,
  suppressed: false,
})

const multiProfileExtrusion = (value: string, profileSketchId: string) => ({
  ...extrusion(value, profileSketchId),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.extrusion",
    schemaVersion: 3,
  },
  parameters: {
    profiles: {
      schemaVersion: 0 as const,
      profiles: [
        {
          ...extrusion(value, profileSketchId).parameters.profile,
          outerBoundaryEntityIds: [id("8")],
        },
        extrusion(value, profileSketchId).parameters.profile,
      ],
    },
    distance: createLengthQuantity(10),
    symmetric: false,
    operation: "new" as const,
  },
})

const modifyingMultiProfileExtrusion = (
  value: string,
  profileSketchId: string,
  targetFeatureId: string,
) => ({
  ...multiProfileExtrusion(value, profileSketchId),
  type: {
    ...multiProfileExtrusion(value, profileSketchId).type,
    schemaVersion: 4,
  },
  parameters: {
    ...multiProfileExtrusion(value, profileSketchId).parameters,
    operation: "remove" as const,
  },
  dependencies: [id(targetFeatureId)],
})

const modifyingExtrusion = (value: string, profileSketchId: string, targetFeatureId: string) => ({
  ...extrusion(value, profileSketchId),
  parameters: {
    ...extrusion(value, profileSketchId).parameters,
    operation: "add" as const,
  },
  dependencies: [id(targetFeatureId)],
})

const booleanSubtract = (value: string, targetFeatureId: string, toolFeatureId: string) => ({
  ...feature(value, [targetFeatureId, toolFeatureId]),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.boolean",
    schemaVersion: 1,
  },
  parameters: { operation: "subtract" as const },
})

const revolve = (value: string, profileSketchId: string, references: unknown[] = []) => ({
  schemaVersion: 0 as const,
  id: id(value),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 1,
  },
  parameters: {
    profile: {
      schemaVersion: 0 as const,
      sketchId: id(profileSketchId),
      outerBoundaryEntityIds: [id("8")],
      holeBoundaryEntityIds: [],
    },
    axis: { kind: "origin-axis" as const, axis: "x" as const },
    angle: createAngleQuantity(360, "deg"),
    operation: "new" as const,
  },
  dependencies: references.map(
    (reference) => (reference as ReturnType<typeof faceReference>).featureId,
  ),
  references,
  suppressed: false,
})

const multiProfileRevolve = (value: string, profileSketchId: string) => ({
  ...revolve(value, profileSketchId),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 5,
  },
  parameters: {
    profiles: {
      schemaVersion: 0 as const,
      profiles: [
        revolve(value, profileSketchId).parameters.profile,
        {
          ...revolve(value, profileSketchId).parameters.profile,
          outerBoundaryEntityIds: [id("9")],
        },
      ],
    },
    axis: { kind: "origin-axis" as const, axis: "x" as const },
    angle: createAngleQuantity(360, "deg"),
    operation: "new" as const,
  },
})

const legacyRevolveV2 = (value: string, profileSketchId: string) => ({
  ...revolve(value, profileSketchId),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 2,
  },
  parameters: { ...revolve(value, profileSketchId).parameters, axis: "x" as const },
})

const modifyingRevolve = (
  value: string,
  profileSketchId: string,
  operation: "add" | "remove" | "intersect",
  targetFeatureId: string,
  references: unknown[] = [],
) => ({
  ...revolve(value, profileSketchId, references),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 2,
  },
  parameters: { ...revolve(value, profileSketchId).parameters, operation },
  dependencies: [id(targetFeatureId), ...references.map(() => id("3"))].filter(
    (dependency, index, dependencies) => dependencies.indexOf(dependency) === index,
  ),
})

const modelEdgeRevolve = (value: string, profileSketchId: string, sourceFeatureId: string) => ({
  ...revolve(value, profileSketchId),
  type: {
    moduleId: "org.vibeshape.core.part-design",
    moduleVersion: "0.1.0",
    typeId: "org.vibeshape.feature.part-design.revolve",
    schemaVersion: 4,
  },
  parameters: {
    ...revolve(value, profileSketchId).parameters,
    axis: {
      kind: "model-edge" as const,
      reference: {
        schemaVersion: 0 as const,
        featureId: id(sourceFeatureId),
        kind: "edge" as const,
        semanticRole: "test.axis.edge",
        signature: {
          kind: "edge" as const,
          geometryClass: "LINE",
          measure: 10,
          centroid: [5, 0, 0] as const,
          bounds: { min: [0, 0, 0] as const, max: [10, 0, 0] as const },
          direction: [1, 0, 0] as const,
          directionMode: "axis" as const,
          boundaryCount: 2,
          adjacentGeometryClasses: ["PLANE", "PLANE"],
        },
      },
    },
  },
  dependencies: [id(sourceFeatureId)],
})

describe("createDocumentDependencyGraph", () => {
  it("flags a multi-profile extrusion payload that does not match its declared version", () => {
    const mismatched = multiProfileExtrusion("2", "1")
    const result = createDocumentDependencyGraphFromSnapshot({
      sketches: [sketch("1")],
      features: [
        {
          ...mismatched,
          type: { ...mismatched.type, schemaVersion: 4 },
        },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      graph: {
        dependencyModelIssues: [
          {
            featureId: mismatched.id,
            ownerPath: "features.0.type",
          },
        ],
      },
    })
  })

  it("rejects multi-profile results as modifying and Boolean inputs", () => {
    const source = multiProfileExtrusion("2", "1")
    const tool = feature("3")
    const modifying = modifyingExtrusion("4", "1", "2")
    const revolveSource = multiProfileRevolve("6", "1")
    const boolean = booleanSubtract("7", "6", "3")

    expect(
      createDocumentDependencyGraphFromSnapshot({
        sketches: [sketch("1")],
        features: [source, modifying],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.1.dependencies.0" }],
      },
    })
    const ordinaryTarget = extrusion("3", "1")
    const modifyingMultiProfile = modifyingMultiProfileExtrusion("4", "1", "3")
    const downstream = modifyingExtrusion("5", "1", "4")
    expect(
      createDocumentDependencyGraphFromSnapshot({
        sketches: [sketch("1")],
        features: [ordinaryTarget, modifyingMultiProfile, downstream],
      }),
    ).toMatchObject({ ok: true })
    expect(
      createDocumentDependencyGraphFromSnapshot({
        sketches: [sketch("1")],
        features: [revolveSource, tool, boolean],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.2.dependencies.0" }],
      },
    })
  })

  it("derives sketch, extrusion, and supported-sketch history from a v0 snapshot", () => {
    const result = deriveLegacyHistory({
      sketches: [supportedSketch("2", "3"), sketch("1")],
      features: [extrusion("3", "1")],
    })
    expect(result).toEqual({
      ok: true,
      history: [
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("2") },
      ],
    })
    expect(
      createDocumentDependencyGraphFromSnapshot({
        sketches: [supportedSketch("2", "3"), sketch("1")],
        features: [extrusion("3", "1")],
      }),
    ).toMatchObject({ ok: true })
  })

  it("uses per-kind source ordinals and deterministic keys for independent nodes", () => {
    const snapshot = {
      sketches: [sketch("2"), sketch("1")],
      features: [feature("9"), feature("1")],
    }
    expect(deriveLegacyHistory(snapshot)).toEqual({
      ok: true,
      history: [
        { kind: "feature", id: id("9") },
        { kind: "sketch", id: id("2") },
        { kind: "feature", id: id("1") },
        { kind: "sketch", id: id("1") },
      ],
    })
    expect(deriveLegacyHistory(snapshot)).toEqual(deriveLegacyHistory(snapshot))
  })

  it("stabilizes a preferred presentation order against dependencies", () => {
    const snapshot = { sketches: [], features: [feature("2", ["1"]), feature("1")] }

    expect(
      deriveLegacyHistoryWithPreferredOrder(snapshot, [
        { kind: "feature", id: id("2") },
        { kind: "feature", id: id("1") },
      ]),
    ).toEqual({
      ok: true,
      history: [
        { kind: "feature", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })
  })

  it("uses v1 semantic declarations as graph edges and flags incomplete declarations", () => {
    const source = featureRecordV1Schema.parse({
      ...feature("1"),
      schemaVersion: 1,
      semanticInputs: [],
    })
    const consumer = featureRecordV1Schema.parse({
      ...feature("2"),
      schemaVersion: 1,
      semanticInputs: [{ kind: "feature", id: source.id }],
    })
    const result = createDocumentDependencyGraph({
      sketches: [],
      features: [source, consumer],
      history: [
        { kind: "feature", id: source.id },
        { kind: "feature", id: consumer.id },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      graph: {
        edges: [
          {
            relation: "semantic-input",
            source: { kind: "feature", id: source.id },
            target: { kind: "feature", id: consumer.id },
          },
        ],
      },
    })
    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: [{ ...consumer, semanticInputs: null }],
        history: [{ kind: "feature", id: consumer.id }],
      }),
    ).toMatchObject({ ok: true, graph: { dependencyModelIssues: [{ featureId: consumer.id }] } })
  })

  it("cross-checks first-party semantic declarations against validated parameters", () => {
    const profile = sketch("1")
    const feature = featureRecordV1Schema.parse({
      ...extrusion("2", "1"),
      schemaVersion: 1,
      semanticInputs: [],
    })

    expect(
      createDocumentDependencyGraph({
        sketches: [profile],
        features: [feature],
        history: [
          { kind: "sketch", id: profile.id },
          { kind: "feature", id: feature.id },
        ],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.0.semanticInputs" }],
      },
    })
  })

  it("preflights aggregate semantic-input limits before parsing records", () => {
    const semanticInputs = Array.from({ length: 1_024 }, () => ({
      kind: "feature",
      id: id("1"),
    }))

    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: Array.from({ length: 98 }, () => ({ semanticInputs })),
        history: [],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "edge-limit" } })
  })

  it("reports the durable semantic-input path for forward History references", () => {
    const source = featureRecordV1Schema.parse({
      ...feature("1"),
      schemaVersion: 1,
      semanticInputs: [],
    })
    const consumer = featureRecordV1Schema.parse({
      ...feature("2"),
      schemaVersion: 1,
      semanticInputs: [{ kind: "feature", id: source.id }],
    })

    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: [source, consumer],
        history: [
          { kind: "feature", id: consumer.id },
          { kind: "feature", id: source.id },
        ],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "forward-reference",
        issues: [{ path: "features.1.semanticInputs.0" }],
      },
    })
  })

  it("fails snapshot derivation for missing sources and cycles", () => {
    expect(deriveLegacyHistory({ sketches: [], features: [feature("1", ["9"])] })).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-node" },
    })
    expect(
      deriveLegacyHistory({
        sketches: [supportedSketch("1", "2")],
        features: [extrusion("2", "1")],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "cycle" } })
  })

  it("builds a deterministic feature dependency graph", () => {
    const result = createDocumentDependencyGraph({
      sketches: [],
      features: [feature("1"), feature("2", ["1"]), feature("3")],
      history: [
        { kind: "feature", id: id("1") },
        { kind: "feature", id: id("2") },
        { kind: "feature", id: id("3") },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges).toEqual([
      {
        source: { kind: "feature", id: id("1") },
        target: { kind: "feature", id: id("2") },
        relation: "feature-dependency",
      },
    ])
    expect(result.graph.evaluationOrder).toEqual([
      { kind: "feature", id: id("1") },
      { kind: "feature", id: id("2") },
      { kind: "feature", id: id("3") },
    ])
    expect(
      result.graph.dependenciesOf({ kind: "feature", id: id("2") } as DocumentNodeRef),
    ).toEqual([{ kind: "feature", id: id("1") }])
    expect(result.graph.dependentsOf({ kind: "feature", id: id("1") } as DocumentNodeRef)).toEqual([
      { kind: "feature", id: id("2") },
    ])
  })

  it("requires exact history coverage and never throws on malformed history", () => {
    expect(
      createDocumentDependencyGraph({ sketches: [sketch("1")], features: [], history: [] }),
    ).toMatchObject({ ok: false, diagnostic: { code: "history-coverage" } })
    expect(() =>
      createDocumentDependencyGraph({ sketches: [], features: [], history: [null] }),
    ).not.toThrow()
    expect(
      createDocumentDependencyGraph({ sketches: [], features: [], history: [null] }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-history" } })
  })

  it("rejects aggregate raw relation input before full record parsing", () => {
    const potentialExtrusion = extrusion("1", "9", [faceReference("9")])
    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: new Array(33_334).fill(potentialExtrusion),
        history: [{ kind: "feature", id: id("1") }],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "edge-limit" } })
  })

  it("rejects forward references, self references, and cycles", () => {
    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: [feature("1"), feature("2", ["1"])],
        history: [
          { kind: "feature", id: id("2") },
          { kind: "feature", id: id("1") },
        ],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "forward-reference" } })
    expect(
      createDocumentDependencyGraph({
        sketches: [],
        features: [{ ...feature("1"), dependencies: [id("1")] }],
        history: [{ kind: "feature", id: id("1") }],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "self-reference",
        issues: [{ path: "features.0.dependencies.0" }],
      },
    })
  })

  it("keeps node kinds distinct and rejects duplicate or non-strict history refs", () => {
    const shared = id("4")
    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("4")],
        features: [feature("4")],
        history: [
          { kind: "sketch", id: shared },
          { kind: "feature", id: shared },
        ],
      }),
    ).toMatchObject({ ok: true })
    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("4")],
        features: [],
        history: [
          { kind: "sketch", id: shared },
          { kind: "sketch", id: shared },
        ],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-history" } })
    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("4")],
        features: [],
        history: [{ kind: "sketch", id: shared, extra: true }],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-history" } })
    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("4"), sketch("4")],
        features: [],
        history: [{ kind: "sketch", id: shared }],
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "duplicate-node" } })
  })

  it("retains relation edges while deduplicating dependency adjacency", () => {
    const result = createDocumentDependencyGraph({
      sketches: [],
      features: [feature("1"), { ...feature("2", ["1"]), references: [faceReference("1")] }],
      history: [
        { kind: "feature", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges.map(({ relation }) => relation)).toEqual([
      "feature-dependency",
      "feature-topology-reference",
    ])
    expect(
      result.graph.dependenciesOf({ kind: "feature", id: id("2") } as DocumentNodeRef),
    ).toEqual([{ kind: "feature", id: id("1") }])
    expect(result.graph.dependencyModelIssues).toEqual([
      {
        featureId: id("1"),
        ownerPath: "features.0.type",
        typeKey: "org.vibeshape.test.core@0.1.0:org.vibeshape.test.feature.box#1",
      },
      {
        featureId: id("2"),
        ownerPath: "features.1.type",
        typeKey: "org.vibeshape.test.core@0.1.0:org.vibeshape.test.feature.box#1",
      },
    ])
    expect(
      result.graph.deletionBlockersFor({ kind: "feature", id: id("1") } as DocumentNodeRef),
    ).toEqual([
      {
        dependent: { kind: "feature", id: id("2") },
        ownerPath: "features.1.dependencies.0",
        relation: "feature-dependency",
      },
      {
        dependent: { kind: "feature", id: id("2") },
        ownerPath: "features.1.references.0.featureId",
        relation: "feature-topology-reference",
      },
    ])
  })

  it("builds profile, sketch-support, and external-sketch relations", () => {
    const source = {
      ...sketch("1"),
      entities: [
        {
          schemaVersion: 0 as const,
          id: id("9"),
          type: "point" as const,
          construction: false,
          x: 0,
          y: 0,
        },
      ],
    }
    const target = {
      ...supportedSketch("2", "3"),
      entities: [
        {
          schemaVersion: 0 as const,
          id: id("8"),
          type: "point" as const,
          construction: false,
          x: 1,
          y: 1,
        },
      ],
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("7"),
          sourceSketchId: id("1"),
          sourcePointId: id("9"),
          projectedPointId: id("6"),
        },
      ],
    }
    const result = createDocumentDependencyGraph({
      sketches: [source, target],
      features: [
        feature("3"),
        extrusion("4", "1", [faceReference("3")]),
        revolve("5", "2", [faceReference("3")]),
      ],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "sketch", id: id("2") },
        { kind: "feature", id: id("4") },
        { kind: "feature", id: id("5") },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges.map(({ relation }) => relation).sort()).toEqual([
      "external-sketch",
      "extrusion-profile",
      "feature-dependency",
      "feature-dependency",
      "feature-topology-reference",
      "feature-topology-reference",
      "revolve-profile",
      "sketch-support",
    ])
    expect(result.graph.getNode({ kind: "sketch", id: id("1") } as DocumentNodeRef)?.ref).toEqual({
      kind: "sketch",
      id: id("1"),
    })
  })

  it("reports precise owner paths for every missing relation source", () => {
    const missingDependency = createDocumentDependencyGraph({
      sketches: [],
      features: [feature("1", ["9"])],
      history: [{ kind: "feature", id: id("1") }],
    })
    expect(missingDependency).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-node", issues: [{ path: "features.0.dependencies.0" }] },
    })

    const missingTopology = createDocumentDependencyGraph({
      sketches: [],
      features: [{ ...feature("1", ["9"]), references: [faceReference("9")] }],
      history: [{ kind: "feature", id: id("1") }],
    })
    expect(missingTopology).toMatchObject({
      ok: false,
      diagnostic: {
        code: "missing-node",
        issues: [{ path: "features.0.references.0.featureId" }],
      },
    })

    const missingProfile = createDocumentDependencyGraph({
      sketches: [],
      features: [extrusion("1", "9")],
      history: [{ kind: "feature", id: id("1") }],
    })
    expect(missingProfile).toMatchObject({
      ok: false,
      diagnostic: {
        code: "missing-node",
        issues: [{ path: "features.0.parameters.profile.sketchId" }],
      },
    })

    const missingSupport = createDocumentDependencyGraph({
      sketches: [supportedSketch("1", "9")],
      features: [],
      history: [{ kind: "sketch", id: id("1") }],
    })
    expect(missingSupport).toMatchObject({
      ok: false,
      diagnostic: {
        code: "missing-node",
        issues: [{ path: "sketches.0.support.reference.featureId" }],
      },
    })

    const missingExternal = createDocumentDependencyGraph({
      sketches: [
        {
          ...sketch("1"),
          externalReferences: [
            {
              schemaVersion: 0 as const,
              id: id("8"),
              sourceSketchId: id("9"),
              sourcePointId: id("7"),
              projectedPointId: id("6"),
            },
          ],
        },
      ],
      features: [],
      history: [{ kind: "sketch", id: id("1") }],
    })
    expect(missingExternal).toMatchObject({
      ok: false,
      diagnostic: {
        code: "missing-node",
        issues: [{ path: "sketches.0.externalReferences.0.sourceSketchId" }],
      },
    })
  })

  it("orders a sketch after the circular model edge referenced by Use", () => {
    const target = {
      ...sketch("2"),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("7"),
          kind: "model-curve" as const,
          reference: circleEdgeReference("1"),
          sourceType: "circle" as const,
          projectedEntityId: id("8"),
          projectedType: "circle" as const,
          projectedPointIds: [id("9")],
        },
      ],
    }
    const result = createDocumentDependencyGraph({
      sketches: [target],
      features: [feature("1")],
      history: [
        { kind: "feature", id: id("1") },
        { kind: "sketch", id: id("2") },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges).toContainEqual({
      source: { kind: "feature", id: id("1") },
      target: { kind: "sketch", id: id("2") },
      relation: "feature-topology-reference",
    })
  })

  it("retains typed orphan repair intent without creating a missing-source graph edge", () => {
    const target = {
      ...sketch("2"),
      externalReferences: [
        {
          schemaVersion: 1 as const,
          id: id("7"),
          kind: "model-curve" as const,
          reference: circleEdgeReference("1"),
          sourceType: "circle" as const,
          projectedEntityId: id("8"),
          projectedType: "circle" as const,
          projectedPointIds: [id("9")],
          orphanedSource: { kind: "deleted-feature" as const, featureId: id("1") },
        },
      ],
    }
    const result = createDocumentDependencyGraph({
      sketches: [target],
      features: [],
      history: [{ kind: "sketch", id: id("2") }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges).toEqual([])
    expect(
      result.graph.deletionBlockersFor({ kind: "feature", id: id("1") } as DocumentNodeRef),
    ).toEqual([])
  })

  it("reports a real cross-kind cycle before forward ordering", () => {
    const cycle = createDocumentDependencyGraph({
      sketches: [supportedSketch("1", "2")],
      features: [extrusion("2", "1")],
      history: [
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })
    expect(cycle).toMatchObject({
      ok: false,
      diagnostic: {
        code: "cycle",
        issues: [
          { path: "sketches.0.support.reference.featureId" },
          { path: "features.0.parameters.profile.sketchId" },
        ],
      },
    })
  })

  it("rejects revolve support references that do not match the profile sketch", () => {
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1")],
      features: [feature("3"), revolve("2", "1", [faceReference("3")])],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.1.references" }, { path: "features.1.dependencies" }],
      },
    })
  })

  it("keeps saved schema-version-2 revolves in the complete dependency model", () => {
    const profile = sketch("1")
    const savedRevolve = legacyRevolveV2("2", "1")
    const result = createDocumentDependencyGraph({
      sketches: [profile],
      features: [savedRevolve],
      history: [
        { kind: "sketch", id: profile.id },
        { kind: "feature", id: savedRevolve.id },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      graph: {
        dependencyModelIssues: [],
        edges: [
          {
            relation: "revolve-profile",
            source: { kind: "sketch", id: profile.id },
            target: { kind: "feature", id: savedRevolve.id },
          },
        ],
      },
    })
  })

  it("rejects revolve dependencies that do not match the profile sketch support owner", () => {
    const invalidRevolve = {
      ...revolve("2", "1"),
      dependencies: [id("3")],
    }
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1")],
      features: [feature("3"), invalidRevolve],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.1.dependencies" }],
      },
    })
  })

  it("requires the stable model-edge axis source in canonical dependency order", () => {
    const valid = modelEdgeRevolve("2", "1", "3")
    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("1")],
        features: [feature("3"), valid],
        history: [
          { kind: "feature", id: id("3") },
          { kind: "sketch", id: id("1") },
          { kind: "feature", id: id("2") },
        ],
      }),
    ).toMatchObject({ ok: true })

    expect(
      createDocumentDependencyGraph({
        sketches: [sketch("1")],
        features: [feature("3"), { ...valid, dependencies: [] }],
        history: [
          { kind: "feature", id: id("3") },
          { kind: "sketch", id: id("1") },
          { kind: "feature", id: id("2") },
        ],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature", issues: [{ path: "features.1.dependencies" }] },
    })
  })

  it.each(["add", "remove", "intersect"] as const)(
    "accepts a target-first %s revolve dependency",
    (operation) => {
      const result = createDocumentDependencyGraph({
        sketches: [sketch("1")],
        features: [feature("3"), modifyingRevolve("2", "1", operation, "3")],
        history: [
          { kind: "feature", id: id("3") },
          { kind: "sketch", id: id("1") },
          { kind: "feature", id: id("2") },
        ],
      })

      expect(result).toMatchObject({ ok: true })
    },
  )

  it("rejects a modifying revolve without an explicit target", () => {
    const invalidRevolve = {
      ...modifyingRevolve("2", "1", "add", "3"),
      dependencies: [],
    }
    const result = createDocumentDependencyGraph({
      sketches: [sketch("1")],
      features: [feature("3"), invalidRevolve],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.1.dependencies" }],
      },
    })
  })

  it("deduplicates a revolve target that also owns the sketch support", () => {
    const result = createDocumentDependencyGraph({
      sketches: [supportedSketch("1", "3")],
      features: [feature("3"), modifyingRevolve("2", "1", "remove", "3", [faceReference("3")])],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({ ok: true })
  })

  it("accepts a distinct target before the sketch support dependency", () => {
    const result = createDocumentDependencyGraph({
      sketches: [supportedSketch("1", "3")],
      features: [
        feature("3"),
        feature("4"),
        modifyingRevolve("2", "1", "add", "4", [faceReference("3")]),
      ],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "feature", id: id("4") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({ ok: true })
  })

  it("rejects a revolve support dependency placed before its distinct target", () => {
    const invalidRevolve = {
      ...modifyingRevolve("2", "1", "add", "4", [faceReference("3")]),
      dependencies: [id("3"), id("4")],
    }
    const result = createDocumentDependencyGraph({
      sketches: [supportedSketch("1", "3")],
      features: [feature("3"), feature("4"), invalidRevolve],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "feature", id: id("4") },
        { kind: "sketch", id: id("1") },
        { kind: "feature", id: id("2") },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        issues: [{ path: "features.2.dependencies" }],
      },
    })
  })
})
