import { describe, expect, it } from "bun:test"
import { matchValue } from "../../../tests/unit/support/match-value"
import { createDocumentDependencyGraph } from "./document-graph"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { boxFeatureType, extrusionFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import {
  readShellFeatureParameters,
  shellFeatureParametersSchema,
  shellFeatureParametersV2Schema,
  shellFeatureType,
  shellFeatureTypeV2,
} from "./part-design-shell"
import { createLengthQuantity } from "./units"

const sourceId = "0195b5ac-b220-7a2c-8c33-67a36a7f7801"
const shellId = "0195b5ac-b220-7a2c-8c33-67a36a7f7802"
const opening = {
  schemaVersion: 1,
  featureId: sourceId,
  outputRole: "body.primary",
  kind: "face",
  semanticRole: "box.top",
  signature: {
    kind: "face",
    geometryClass: "plane",
    measure: 600,
    centroid: [0, 0, 40],
    bounds: { min: [-10, -15, 40], max: [10, 15, 40] },
    boundaryCount: 4,
    adjacentGeometryClasses: ["plane"],
  },
}
const parameters = {
  targetBody: { schemaVersion: 0, featureId: sourceId, outputRole: "body.primary" },
  thickness: createLengthQuantity(1),
  direction: "inward",
  sourceContentHash: "a".repeat(64),
  openings: [opening],
}
const feature = featureRecordSchema.parse({
  schemaVersion: 0,
  id: shellId,
  type: shellFeatureType.type,
  parameters,
  dependencies: [sourceId],
  references: [],
  suppressed: false,
})
const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
if (!modules.ok) throw new Error(modules.diagnostic.message)
const registered = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
if (!registered.ok) throw new Error(registered.diagnostic.message)
const registry = registered.registry
const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.8.1",
    kernelSourceRevision: null,
  },
}
describe("persisted exact-body shell openings", () => {
  it("registers one exact body input and canonical v1 opening content without document UUIDs", () => {
    expect(registry.validateFeature(feature)).toMatchObject({
      ok: true,
      contentParameters: {
        thickness: 1,
        direction: "inward",
        sourceContentHash: parameters.sourceContentHash,
        openings: [{ schemaVersion: 1, outputRole: "body.primary", semanticRole: "box.top" }],
      },
    })
    expect(featureBodyDependencies(feature)).toEqual<unknown>([
      { featureId: sourceId, outputRole: "body.primary" },
    ])
    expect(readShellFeatureParameters(feature)?.openings[0]?.featureId).toBe<unknown>(sourceId)
    const dependency = {
      featureId: sourceId,
      contentHash: parameters.sourceContentHash,
      outputRole: "body.primary",
    }
    const original = createFeatureContentIdentity(registry, {
      feature,
      environment,
      dependencies: [dependency],
    })
    expect(original).toMatchObject({
      ok: true,
      identity: { schemaVersion: 1, feature: { inputRoles: ["body.primary"] } },
    })
    const remapped = {
      ...feature,
      id: sourceId,
      dependencies: [feature.id],
      parameters: {
        ...parameters,
        targetBody: { ...parameters.targetBody, featureId: feature.id },
        openings: [{ ...opening, featureId: feature.id }],
      },
    }
    expect(
      createFeatureContentIdentity(registry, {
        feature: remapped,
        environment,
        dependencies: [{ ...dependency, featureId: feature.id }],
      }),
    ).toEqual(original)
    expect(
      createFeatureContentIdentity(registry, {
        feature,
        environment,
        dependencies: [{ ...dependency, outputRole: "body.other" }],
      }).ok,
    ).toBe(false)
  })
  it.each([
    { thickness: createLengthQuantity(0) },
    { thickness: createLengthQuantity(-1) },
    { thickness: createLengthQuantity(100001) },
    { direction: "automatic" },
    { sourceContentHash: "unknown" },
    { openings: [] },
    { openings: [opening, opening] },
    { openings: [{ ...opening, kind: "edge" }] },
    { openings: [{ ...opening, outputRole: "body.other" }] },
    { openings: [{ ...opening, featureId: shellId }] },
    { openings: [{ ...opening, candidateId: "face:1" }] },
  ])("rejects unsafe or unbound opening intent %j", (changes) => {
    expect(shellFeatureParametersSchema.safeParse({ ...parameters, ...changes }).success).toBe(
      false,
    )
  })
  it("requires a sole matching dependency and exact registered version", () => {
    expect(registry.validateFeature({ ...feature, dependencies: [shellId] }).ok).toBe(false)
    expect(registry.validateFeature({ ...feature, dependencies: [sourceId, shellId] }).ok).toBe(
      false,
    )
    expect(
      readShellFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 3 } }),
    ).toBeNull()
  })
  it("registers explicit v2 closed cavities and preserves exact-body opening constraints", () => {
    const closed = {
      ...feature,
      type: shellFeatureTypeV2.type,
      parameters: { ...parameters, openings: [] },
    }
    expect(shellFeatureParametersV2Schema.parse(closed.parameters)).toEqual<unknown>(
      closed.parameters,
    )
    expect(readShellFeatureParameters(closed)?.openings).toEqual([])
    expect(registry.validateFeature(closed)).toMatchObject({
      ok: true,
      contentParameters: { openings: [] },
    })
    expect(shellFeatureParametersSchema.safeParse(closed.parameters).success).toBe(false)
    for (const openings of [
      [opening, opening],
      [{ ...opening, outputRole: "body.other" }],
      [{ ...opening, featureId: shellId }],
      Array.from({ length: 65 }, () => opening),
    ])
      expect(shellFeatureParametersV2Schema.safeParse({ ...parameters, openings }).success).toBe(
        false,
      )
  })
  it("rejects heuristic modifier Extrusion identities in v2 authored graphs while preserving v1 and exact references", () => {
    const baseId = "0195b5ac-b220-7a2c-8c33-67a36a7f7803"
    const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f7804"
    const base = {
      ...feature,
      id: baseId,
      type: boxFeatureType.type,
      dependencies: [],
      parameters: {
        width: createLengthQuantity(20),
        depth: createLengthQuantity(30),
        height: createLengthQuantity(10),
        centered: false,
      },
    }
    const source = {
      ...feature,
      id: sourceId,
      type: extrusionFeatureType.type,
      dependencies: [baseId],
      parameters: {
        profile: {
          schemaVersion: 0,
          sketchId,
          outerBoundaryEntityIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f7805"],
          holeBoundaryEntityIds: [],
        },
        distance: createLengthQuantity(40),
        symmetric: false,
        operation: "add",
      },
    }
    const graph = (shell: typeof feature) =>
      createDocumentDependencyGraph({
        sketches: [
          {
            schemaVersion: 0,
            id: sketchId,
            label: "Profile",
            plane: "xy",
            entities: [],
            constraints: [],
          },
        ],
        features: [base, source, shell],
        history: [
          { kind: "feature", id: baseId },
          { kind: "sketch", id: sketchId },
          { kind: "feature", id: sourceId },
          { kind: "feature", id: shellId },
        ],
      })
    expect(matchValue(graph({ ...feature, type: shellFeatureTypeV2.type }))).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-feature",
        message: expect.stringContaining("modifier Extrusions"),
      },
    })
    expect(graph(feature)).toMatchObject({ ok: true })
    const { semanticRole: _role, ...exactOpening } = opening
    expect(
      graph({
        ...feature,
        type: shellFeatureTypeV2.type,
        parameters: { ...parameters, openings: [exactOpening] },
      }),
    ).toMatchObject({ ok: true })
  })
})
