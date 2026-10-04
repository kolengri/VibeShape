import { describe, expect, it } from "vitest"
import {
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { featureBodyDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { terminalBodyOutputs } from "./model-bodies"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  partDesignFeatureTypeHandlers,
  readRevolveFeatureParameters,
  revolveFeatureParametersV7Schema,
  revolveFeatureTypeV7,
} from "./part-design"
import { booleanFeatureTypeV2, readBooleanFeatureParametersV2 } from "./part-design-subtract"
import { classifyPartOperation } from "./part-operation"
import { createSketchProfileSet, sketchProfileSelectorSchema } from "./sketch-profile-selector"
import { createAngleQuantity } from "./units"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const targetBody = { schemaVersion: 0, featureId: id(2), outputRole: "pattern.instance.0" }
const toolBody = { ...targetBody, outputRole: "pattern.instance.1" }
const profile = sketchProfileSelectorSchema.parse({
  schemaVersion: 0,
  sketchId: id(1),
  outerBoundaryEntityIds: [id(3), id(4)],
  holeBoundaryEntityIds: [],
})
function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}
const environment: FeatureContentEnvironment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  provider: { kind: "built-in" },
  modelingTolerancePolicyVersion: 1,
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "7.8.1",
    kernelSourceRevision: null,
  },
}
function subtract(keepTools = false) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(5),
    type: booleanFeatureTypeV2.type,
    parameters: { operation: "subtract", targetBody, toolBody, keepTools },
    dependencies: [id(2)],
    references: [],
    suppressed: false,
  })
}
function revolve(operation: "add" | "remove" | "intersect") {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(5),
    type: revolveFeatureTypeV7.type,
    parameters: {
      operation,
      targetBody,
      profiles: createSketchProfileSet([profile]),
      axis: { kind: "origin-axis", axis: "x" },
      angle: createAngleQuantity(360, "deg"),
    },
    dependencies: [id(2)],
    references: [],
    suppressed: false,
  })
}
describe("exact-body modifying Revolve and Subtract", () => {
  it.each([false, true])(
    "preserves sibling slots and keepTools=%s without changing subtraction content",
    (keepTools) => {
      const feature = subtract(keepTools)
      expect(registry().validateFeature(feature).ok).toBe(true)
      expect(featureBodyDependencies(feature)).toEqual(
        keepTools ? [targetBody] : [targetBody, toolBody],
      )
      expect(
        classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] }),
      ).toMatchObject({ kind: "modify", target: targetBody, consumed: keepTools ? [] : [toolBody] })
      const identity = createFeatureContentIdentity(registry(), {
        feature,
        environment,
        dependencies: [{ featureId: feature.dependencies[0], contentHash: "a".repeat(64) }],
      })
      expect(identity).toMatchObject({
        ok: true,
        identity: {
          schemaVersion: 2,
          feature: {
            parameters: { operation: "subtract" },
            inputs: ["a".repeat(64)],
            inputSlots: [
              { inputIndex: 0, outputRole: targetBody.outputRole },
              { inputIndex: 0, outputRole: toolBody.outputRole },
            ],
          },
        },
      })
    },
  )
  it("rejects repeated exact bodies and reversed distinct producer order", () => {
    const feature = subtract()
    expect(
      registry().validateFeature({
        ...feature,
        parameters: { ...feature.parameters, toolBody: targetBody },
      }).ok,
    ).toBe(false)
    const distinct = {
      ...feature,
      parameters: { ...feature.parameters, toolBody: { ...toolBody, featureId: id(7) } },
      dependencies: [id(2), id(7)],
    }
    expect(registry().validateFeature(distinct).ok).toBe(true)
    expect(registry().validateFeature({ ...distinct, dependencies: [id(7), id(2)] }).ok).toBe(false)
    expect(
      readBooleanFeatureParametersV2({ ...feature, type: { ...feature.type, schemaVersion: 1 } }),
    ).toBeNull()
  })
  it.each(["add", "remove", "intersect"] as const)(
    "owns only the exact %s Revolve target",
    (operation) => {
      const feature = revolve(operation)
      expect(registry().validateFeature(feature).ok).toBe(true)
      expect(readRevolveFeatureParameters(feature)?.targetBody).toEqual(targetBody)
      expect(featureBodyDependencies(feature)).toEqual([
        { featureId: targetBody.featureId, outputRole: targetBody.outputRole },
      ])
      expect(
        classifyPartOperation({ ...feature, schemaVersion: 1, semanticInputs: [] }),
      ).toMatchObject({ kind: "modify", target: targetBody, consumed: [] })
      expect(registry().validateFeature({ ...feature, dependencies: [id(7)] }).ok).toBe(false)
    },
  )
  it("retains canonical profile sets and rejects New or an axis from another sketch", () => {
    const feature = revolve("add")
    expect(
      revolveFeatureParametersV7Schema.safeParse({ ...feature.parameters, operation: "new" })
        .success,
    ).toBe(false)
    expect(
      registry().validateFeature({
        ...feature,
        parameters: {
          ...feature.parameters,
          axis: { kind: "sketch-line", sketchId: id(7), entityId: id(8) },
        },
      }).ok,
    ).toBe(false)
  })
})

it("keeps geometry identity stable across tool retention and producer UUID rebinding while roles remain material", () => {
  const identity = (feature: ReturnType<typeof subtract>) =>
    createFeatureContentIdentity(registry(), {
      feature,
      environment,
      dependencies: feature.dependencies.map((featureId) => ({
        featureId,
        contentHash: "a".repeat(64),
      })),
    })
  const baseline = identity(subtract(false))
  expect(identity(subtract(true))).toEqual(baseline)
  const renamed = featureRecordSchema.parse({
    ...subtract(),
    id: id(20),
    dependencies: [id(21)],
    parameters: {
      operation: "subtract",
      targetBody: { ...targetBody, featureId: id(21) },
      toolBody: { ...toolBody, featureId: id(21) },
    },
  })
  expect(identity(renamed)).toEqual(baseline)
  const swapped = featureRecordSchema.parse({
    ...subtract(),
    parameters: { operation: "subtract", targetBody: toolBody, toolBody: targetBody },
  })
  expect(identity(swapped)).not.toEqual(baseline)
})
it.each([false, true])(
  "projects exact Subtract keepTools=%s terminal roles and preserves siblings",
  (keepTools) => {
    const feature = subtract(keepTools)
    const source = featureRecordSchema.parse({
      ...feature,
      id: targetBody.featureId,
      type: { ...feature.type, typeId: "org.vibeshape.feature.part-design.box", schemaVersion: 1 },
      dependencies: [],
      parameters: {},
      references: [],
    })
    const sibling = { ...targetBody, outputRole: "pattern.instance.2" }
    const result = { schemaVersion: 0, featureId: feature.id, outputRole: "result" }
    const map = new Map([
      [source.id, [targetBody, toolBody, sibling]],
      [feature.id, [result]],
    ])
    expect(terminalBodyOutputs([source, feature], map)).toEqual(
      keepTools ? [toolBody, sibling, result] : [sibling, result],
    )
    map.delete(feature.id)
    expect(terminalBodyOutputs([source, { ...feature, suppressed: true }], map)).toEqual([
      targetBody,
      toolBody,
      sibling,
    ])
  },
)
