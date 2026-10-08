import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { applyDocumentCommand, replayDocumentEvents } from "./commands"
import { featureBodyDependencies, featureBodyDependencyIds } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  fdmContentParameters,
  fdmDependencyIds,
  fdmFeatureParametersSchema,
  fdmFeatureType,
  fdmFeatureTypeHandler,
  readFdmFeatureParameters,
} from "./part-design-fdm"
import { createAngleQuantity, createLengthQuantity } from "./units"

const source = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7b01")
const support = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7b02")
const stop = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f7b03")
const targetBody = { schemaVersion: 0, featureId: source, outputRole: "body.primary" }
const origin = {
  x: createLengthQuantity(1, "cm"),
  y: createLengthQuantity(-2),
  z: createLengthQuantity(0),
}
const common = { axis: "Z", origin, targetBody }
function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    { ...partDesignModule, featureTypes: [fdmFeatureType] },
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, [fdmFeatureTypeHandler])
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}
function record(parameters: unknown, dependencies: readonly string[] = [source]) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: support,
    type: fdmFeatureType.type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}
describe("parametric FDM feature family", () => {
  it("exposes its strict public input schema to MCP JSON Schema discovery", () => {
    expect(() => z.toJSONSchema(fdmFeatureParametersSchema)).not.toThrow()
  })
  it("preserves exact body roles while canonical content excludes body UUIDs and source units", () => {
    const parameters = {
      ...common,
      kind: "teardrop-hole",
      diameter: createLengthQuantity(8),
      depth: createLengthQuantity(10),
      roofAngle: createAngleQuantity(45, "deg"),
      flatTop: false,
    }
    const feature = record(parameters)
    expect(registry().validateFeature(feature)).toMatchObject({
      ok: true,
      contentParameters: {
        kind: "teardrop-hole",
        axis: "Z",
        origin: { x: 10, y: -2, z: 0 },
        diameter: 8,
        depth: 10,
        roofAngle: Math.PI / 4,
        flatTop: false,
      },
    })
    expect(featureBodyDependencies(feature)).toEqual([
      { featureId: source, outputRole: "body.primary" },
    ])
    expect(featureBodyDependencyIds(feature)).toEqual([source])
    expect(registry().validateFeature({ ...feature, dependencies: [stop] }).ok).toBe(false)
    expect(
      readFdmFeatureParameters({ ...feature, type: { ...feature.type, schemaVersion: 2 } }),
    ).toBeNull()
  })
  it("creates an independent coupon and a sleeve with an optional exact target", () => {
    const coupon = fdmFeatureParametersSchema.parse({
      kind: "calibration-coupon",
      axis: "Z",
      origin,
      diameterStart: createLengthQuantity(4),
      diameterStep: createLengthQuantity(0.1),
      holeCount: 5,
      spacing: createLengthQuantity(8),
      thickness: createLengthQuantity(3),
      margin: createLengthQuantity(2),
    })
    expect(fdmDependencyIds(coupon)).toEqual([])
    expect(featureBodyDependencies(record(coupon, []))).toEqual([])
    expect(registry().validateFeature(record(coupon, [])).ok).toBe(true)
    const sleeve = fdmFeatureParametersSchema.parse({
      kind: "flexible-sleeve",
      axis: "Z",
      origin,
      outerDiameter: createLengthQuantity(12),
      innerDiameter: createLengthQuantity(8),
      length: createLengthQuantity(10),
      slotWidth: createLengthQuantity(1),
      slotLength: createLengthQuantity(7),
      count: 4,
    })
    if (sleeve.kind !== "flexible-sleeve") throw new Error("Expected a sleeve fixture.")
    expect(fdmDependencyIds(sleeve)).toEqual([])
    expect(
      fdmDependencyIds({
        ...sleeve,
        targetBody: { schemaVersion: 0, featureId: source, outputRole: "result" },
      }),
    ).toEqual([source])
  })
  it("binds Web to its saved sketch, ordered supports, canonical line IDs, and whole support slots", () => {
    const parameters = fdmFeatureParametersSchema.parse({
      kind: "web",
      targetBody: { ...targetBody, outputRole: "result" },
      sketchId: support,
      lineIds: [stop, source],
      thickness: createLengthQuantity(1),
      depth: createLengthQuantity(5),
      direction: "forward",
      style: "web",
      extendToWalls: true,
      stopPlane: { kind: "datum-plane", featureId: stop },
    })
    expect(fdmDependencyIds(parameters, support)).toEqual([source, support, stop])
    expect(fdmContentParameters(parameters)).toMatchObject({
      lineIds: [source, stop],
      thickness: 1,
      depth: 5,
    })
    expect(
      projectFirstPartyFeatureSemanticInputs(record(parameters, [source, stop])),
    ).toMatchObject({ recognized: true, ok: true, inputs: [{ kind: "sketch", id: support }] })
  })
  it.each([
    {
      kind: "flexible-sleeve",
      outerDiameter: 10,
      innerDiameter: 10,
      length: 10,
      slotLength: 7,
      slotWidth: 1,
      count: 4,
    },
    {
      kind: "flexible-sleeve",
      outerDiameter: 10,
      innerDiameter: 8,
      length: 10,
      slotLength: 10,
      slotWidth: 1,
      count: 4,
    },
    {
      kind: "insert-pocket",
      diameter: 4,
      depth: 8,
      clearance: 0.2,
      bossDiameter: 4.4,
      bossHeight: 8,
    },
    { kind: "insert-pocket", diameter: 4, depth: 8, clearance: 0.2, bossDiameter: 8 },
    { kind: "crush-ribs", holeDiameter: 8, ribHeight: 4, ribWidth: 1, depth: 5, count: 4 },
    {
      kind: "enclosure-joint",
      width: 10,
      length: 20,
      wall: 5,
      height: 3,
      clearance: 0,
      mode: "lip",
    },
    {
      kind: "membrane",
      width: 10,
      length: 20,
      thickness: 0.2,
      mode: "bridges",
      bridgeCount: 4,
      bridgeWidth: 3,
    },
    {
      kind: "calibration-coupon",
      diameterStart: 4,
      diameterStep: 1,
      holeCount: 5,
      spacing: 5,
      thickness: 3,
      margin: 2,
    },
  ])("rejects dimension combinations that erase the $kind material invariant", (values) => {
    const scalarKeys = new Set(["kind", "mode", "count", "holeCount", "bridgeCount"])
    const parameters = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        scalarKeys.has(key) || typeof value !== "number" ? value : createLengthQuantity(value),
      ]),
    )
    const { targetBody: _target, ...independent } = common
    expect(
      fdmFeatureParametersSchema.safeParse({
        ...(values.kind === "calibration-coupon" ? independent : common),
        ...parameters,
      }).success,
    ).toBe(false)
  })
  it("resolves dimensional expressions before rechecking sleeve wall and root-band bounds", () => {
    const sleeve = {
      kind: "flexible-sleeve",
      axis: "Z",
      origin,
      outerDiameter: createLengthQuantity(12),
      innerDiameter: createLengthQuantity(8, "mm", "#bore"),
      length: createLengthQuantity(10),
      slotWidth: createLengthQuantity(1),
      slotLength: createLengthQuantity(7),
      count: 4,
    }
    const result = registry().resolveFeatureParameters(
      record(sleeve, []),
      new Map([["bore", { dimension: "length", value: 13 }]]),
    )
    expect(result.ok).toBe(false)
  })
  it("adds, edits, serializes, and replays an independent FDM feature with its authored quantities", () => {
    const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
    const envelope = {
      schemaVersion: 1,
      documentId,
      issuedAt: "2026-10-07T00:00:00Z",
      actor: { type: "user", userId: "org.vibeshape.user.local" },
    }
    const created = applyDocumentCommand(null, {
      ...envelope,
      kind: "org.vibeshape.document.create",
      commandId: source,
      baseRevision: 0,
      payload: { name: "FDM lifecycle" },
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const parameters = fdmFeatureParametersSchema.parse({
      kind: "calibration-coupon",
      axis: "Z",
      origin,
      diameterStart: createLengthQuantity(4),
      diameterStep: createLengthQuantity(0.1),
      holeCount: 5,
      spacing: createLengthQuantity(8),
      thickness: createLengthQuantity(3),
      margin: createLengthQuantity(2),
    })
    const feature = record(parameters, [])
    const added = applyDocumentCommand(created.snapshot, {
      ...envelope,
      kind: "org.vibeshape.feature.add",
      commandId: support,
      baseRevision: 1,
      payload: { feature },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)
    const edited = applyDocumentCommand(added.snapshot, {
      ...envelope,
      kind: "org.vibeshape.feature.update",
      commandId: stop,
      baseRevision: 2,
      payload: {
        feature: {
          ...feature,
          parameters: { ...parameters, diameterStep: createLengthQuantity(0.15) },
        },
      },
    })
    if (!edited.ok) throw new Error(edited.diagnostic.message)
    expect(
      replayDocumentEvents(JSON.parse(JSON.stringify([created.event, added.event, edited.event]))),
    ).toMatchObject({ ok: true, snapshot: edited.snapshot })
    expect(replayDocumentEvents([created.event, added.event])).toMatchObject({
      ok: true,
      snapshot: added.snapshot,
    })
    const reopened = featureRecordSchema.parse(
      JSON.parse(JSON.stringify(edited.snapshot.features[0])),
    )
    expect(registry().validateFeature(reopened).ok).toBe(true)
    expect(readFdmFeatureParameters(reopened)).toMatchObject({
      kind: "calibration-coupon",
      diameterStep: { value: 0.15 },
    })
  })
})
