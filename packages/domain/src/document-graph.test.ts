import { describe, expect, it } from "vitest"
import { createDocumentDependencyGraph, type DocumentNodeRef } from "./document-graph"
import { createLengthQuantity } from "./units"

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

const vertexReference = (featureId: string) => ({
  schemaVersion: 0 as const,
  featureId: id(featureId),
  kind: "vertex" as const,
  signature: {
    kind: "vertex" as const,
    geometryClass: "POINT",
    measure: 0,
    centroid: [0, 0, 0] as [number, number, number],
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [0, 0, 0] as [number, number, number],
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

describe("createDocumentDependencyGraph", () => {
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
  })

  it("builds extrusion-profile, sketch-support, and external-sketch relations", () => {
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
      features: [feature("3"), extrusion("4", "1", [faceReference("3")])],
      history: [
        { kind: "feature", id: id("3") },
        { kind: "sketch", id: id("1") },
        { kind: "sketch", id: id("2") },
        { kind: "feature", id: id("4") },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.graph.edges.map(({ relation }) => relation).sort()).toEqual([
      "external-sketch",
      "extrusion-profile",
      "feature-dependency",
      "feature-topology-reference",
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

  it("orders a sketch after the model feature referenced by Use", () => {
    const target = {
      ...sketch("2"),
      externalReferences: [
        {
          schemaVersion: 0 as const,
          id: id("7"),
          kind: "model-point" as const,
          reference: vertexReference("1"),
          projectedPointId: id("8"),
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
})
