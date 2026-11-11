import { describe, expect, it } from "bun:test"
import { bodyOutputRoleSchema } from "./body-reference"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { featureGeometryDependencies } from "./feature-dependencies"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { featureIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import {
  legacyRevolveFeatureType,
  multiProfileRevolveFeatureType,
  partDesignFeatureTypeHandlers,
  readRevolveFeatureParameters,
  revolveFeatureParametersV8Schema,
  revolveFeatureType,
  revolveFeatureTypeV7,
  revolveFeatureTypeV8,
  revolveProfileOutputRole,
} from "./part-design"
import { type RevolveAuthoringIntent, routeRevolveAuthoring } from "./part-design-revolve-route"
import { createSketchProfileSet } from "./sketch-profile-selector"
import { createAngleQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const profile = {
  schemaVersion: 0 as const,
  sketchId: id(1),
  outerBoundaryEntityIds: [id(12), id(11)].sort(),
  holeBoundaryEntityIds: [],
}
const secondProfile = { ...profile, outerBoundaryEntityIds: [id(21)] }
const profiles = createSketchProfileSet([profile] as never)
const featureId = featureIdSchema.parse(id(100))
const targetId = featureIdSchema.parse(id(101))
const endId = featureIdSchema.parse(id(102))
const hash = "a".repeat(64)
const deg = (value: number, expression?: string) => createAngleQuantity(value, "deg", expression)
const face = {
  schemaVersion: 1 as const,
  featureId: endId,
  outputRole: "result",
  kind: "face" as const,
  signature: {
    kind: "face" as const,
    geometryClass: "PLANE",
    measure: 100,
    centroid: [0, 0, 0] as const,
    bounds: { min: [0, -5, -10] as const, max: [0, 10, -1] as const },
    direction: [1, 0, 0] as const,
    directionMode: "oriented" as const,
    boundaryCount: 4,
    adjacentGeometryClasses: ["PLANE", "PLANE", "PLANE", "PLANE"],
  },
}

const base = {
  profiles,
  axis: { kind: "origin-axis" as const, axis: "y" as const },
  angle: deg(90),
  symmetric: false,
  reversed: false,
  secondAngle: null,
  operation: "new" as const,
  targetBody: null,
  endCondition: { kind: "angle" as const },
}
const target = { schemaVersion: 0 as const, featureId: targetId, outputRole: "result" }
const endBody = { schemaVersion: 0 as const, featureId: endId, outputRole: "result" }

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}
function record(parameters: object, dependencies: readonly string[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureId,
    type: revolveFeatureTypeV8.type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
  })
}
const handler = () => {
  const found = partDesignFeatureTypeHandlers.find(
    ({ type }) => type.typeId === revolveFeatureTypeV8.type.typeId && type.schemaVersion === 8,
  )
  if (!found?.resolveParameters) throw new Error("Revolve v8 handler is not registered.")
  return found as typeof found & { resolveParameters: NonNullable<typeof found.resolveParameters> }
}
const valid = (parameters: object) => revolveFeatureParametersV8Schema.safeParse(parameters).success

describe("Revolve v8 angular extents", () => {
  it("accepts one-sided, reversed, symmetric, and two-sided angles within one turn", () => {
    expect(valid(base)).toBe(true)
    expect(valid({ ...base, reversed: true })).toBe(true)
    expect(valid({ ...base, symmetric: true, angle: deg(360) })).toBe(true)
    expect(valid({ ...base, angle: deg(300), secondAngle: deg(60) })).toBe(true)
    expect(valid({ ...base, reversed: true, angle: deg(10), secondAngle: deg(20) })).toBe(true)
  })

  it("rejects totals beyond one turn and contradictory symmetric intent", () => {
    expect(valid({ ...base, angle: deg(300), secondAngle: deg(61) })).toBe(false)
    expect(valid({ ...base, angle: deg(361) })).toBe(false)
    expect(valid({ ...base, angle: deg(0) })).toBe(false)
    expect(valid({ ...base, secondAngle: deg(0) })).toBe(false)
    expect(valid({ ...base, symmetric: true, secondAngle: deg(10) })).toBe(false)
    expect(valid({ ...base, symmetric: true, reversed: true })).toBe(false)
  })

  it("resolves first and second angle expressions and rejects an over-turn result", () => {
    const variables = evaluateVariableDefinitions([
      { schemaVersion: 0, id: id(900), name: "side", expression: "200 deg" },
    ])
    if (!variables.ok) throw new Error(variables.diagnostic.message)
    const authored = { ...base, angle: deg(10, "#side"), secondAngle: deg(10, "#side / 2") }
    expect(handler().resolveParameters(authored, variables.valuesByName)).toMatchObject({
      ok: true,
      parameters: {
        angle: { value: (200 * Math.PI) / 180 },
        secondAngle: { value: Math.PI / 1.8 },
      },
    })
    const overTurn = { ...authored, secondAngle: deg(10, "#side") }
    expect(handler().resolveParameters(overTurn, variables.valuesByName)).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "secondAngle" }] },
    })
    expect(handler().contentParameters(authored)).toMatchObject({
      angle: Math.PI / 18,
      secondAngle: Math.PI / 18,
      symmetric: false,
    })
  })
})

describe("Revolve v8 endpoints and dependencies", () => {
  const upToFace = {
    kind: "up-to-face" as const,
    targetBody: endBody,
    sourceContentHash: hash,
    face,
  }

  it("requires one directional extent and a face on its own endpoint body", () => {
    expect(valid({ ...base, endCondition: upToFace })).toBe(true)
    expect(valid({ ...base, endCondition: upToFace, symmetric: true })).toBe(false)
    expect(valid({ ...base, endCondition: upToFace, secondAngle: deg(5) })).toBe(false)
    expect(
      valid({ ...base, endCondition: { ...upToFace, face: { ...face, featureId: targetId } } }),
    ).toBe(false)
  })

  it("orders target, axis owner, and endpoint owner and retains the endpoint as geometry input", () => {
    const modifying = {
      ...base,
      operation: "remove" as const,
      targetBody: target,
      endCondition: { kind: "up-to-body" as const, targetBody: endBody, sourceContentHash: hash },
    }
    const feature = record(modifying, [targetId, endId])
    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
    expect(registry().validateFeature(record(modifying, [endId, targetId])).ok).toBe(false)
    expect(registry().validateFeature(record(modifying, [targetId])).ok).toBe(false)
    expect(featureGeometryDependencies(feature)).toEqual([
      { featureId: targetId, outputRole: "result" },
      endBody,
    ])
  })

  it("normalizes v8 for shared readers without a New target", () => {
    expect(readRevolveFeatureParameters(record(base))).toMatchObject({
      profile,
      angle: { value: Math.PI / 2 },
      endCondition: { kind: "angle" },
    })
    expect(readRevolveFeatureParameters(record(base))).not.toHaveProperty("targetBody")
  })

  it("names separate profile outputs by their complete outer boundary", () => {
    // FNV-1a 64 of the sorted outer-boundary IDs joined by commas, computed independently.
    expect(revolveProfileOutputRole(profile as never)).toBe("revolve.profile.ee945e77d0948d2e")
    expect(
      revolveProfileOutputRole({
        ...profile,
        outerBoundaryEntityIds: [id(12), id(11)],
      } as never),
    ).toBe("revolve.profile.ee945e77d0948d2e")
    expect(bodyOutputRoleSchema.safeParse(revolveProfileOutputRole(profile as never)).success).toBe(
      true,
    )
  })

  it("gives adjacent regions that share their lowest boundary entity distinct names", () => {
    // Two rectangles sharing edge 11 have the same lowest entity but different outer boundaries.
    const left = { ...profile, outerBoundaryEntityIds: [id(11), id(12), id(13), id(14)] }
    const right = { ...profile, outerBoundaryEntityIds: [id(11), id(15), id(16), id(17)] }
    expect(revolveProfileOutputRole(left as never)).not.toBe(
      revolveProfileOutputRole(right as never),
    )
  })
})

describe("Revolve authoring route", () => {
  const intent: RevolveAuthoringIntent = base
  const legacyType = (version: number) => ({ ...revolveFeatureType.type, schemaVersion: version })

  it("authors new revolves as v8", () => {
    expect(routeRevolveAuthoring(intent, null)?.type).toEqual(revolveFeatureTypeV8.type)
  })

  it.each([1, 2, 3, 4])("keeps an edited single-profile v%i revolve on its version", (version) => {
    const route = routeRevolveAuthoring(
      { ...intent, axis: { kind: "origin-axis", axis: "x" } },
      legacyType(version),
    )
    expect(route?.type.schemaVersion).toBe(version)
  })

  it("keeps multi-profile v5 and exact-target v7 edits on their versions", () => {
    const multi = { ...intent, profiles: createSketchProfileSet([profile, secondProfile] as never) }
    expect(routeRevolveAuthoring(multi, multiProfileRevolveFeatureType.type)?.type).toEqual(
      multiProfileRevolveFeatureType.type,
    )
    const exact = {
      ...intent,
      operation: "add" as const,
      targetBody: { ...target, outputRole: "pattern.instance.1" },
    }
    expect(routeRevolveAuthoring(exact, revolveFeatureTypeV7.type)?.type).toEqual(
      revolveFeatureTypeV7.type,
    )
  })

  it("moves to v8 only for a v8 option or intent the saved version cannot hold", () => {
    expect(routeRevolveAuthoring({ ...intent, symmetric: true }, legacyType(4))?.type).toEqual(
      revolveFeatureTypeV8.type,
    )
    expect(routeRevolveAuthoring({ ...intent, secondAngle: deg(10) }, legacyType(5))?.type).toEqual(
      revolveFeatureTypeV8.type,
    )
    // Schema version 1 stores only origin axes and New.
    expect(
      routeRevolveAuthoring(
        { ...intent, operation: "add", targetBody: target },
        legacyRevolveFeatureType.type,
      )?.type,
    ).toEqual(revolveFeatureTypeV8.type)
    // Restoring the saved intent restores the saved schema.
    expect(routeRevolveAuthoring(intent, legacyType(4))?.type.schemaVersion).toBe(4)
  })

  it("returns no route for invalid intent", () => {
    expect(routeRevolveAuthoring({ ...intent, angle: deg(400) }, null)).toBeNull()
  })
})

describe("Revolve v1–v7 replay compatibility", () => {
  // A split body supports the sketch while one of its named outputs is the modifying target.
  const supportReference = {
    schemaVersion: 0 as const,
    featureId: targetId,
    kind: "face" as const,
    signature: { ...face.signature, centroid: [0, 0, 10] as const },
  }
  const namedTarget = { schemaVersion: 0 as const, featureId: targetId, outputRole: "split.a" }
  function supported(type: typeof revolveFeatureTypeV7.type, parameters: object) {
    return featureRecordSchema.parse({
      schemaVersion: 0,
      id: featureId,
      type,
      parameters,
      dependencies: [targetId],
      references: [supportReference],
      suppressed: false,
    })
  }
  const v7 = supported(revolveFeatureTypeV7.type, {
    profiles,
    axis: base.axis,
    angle: deg(90),
    operation: "add",
    targetBody: namedTarget,
  })
  const environment = {
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
  } as const

  it("keeps a v7 named target whose producer also supports the sketch valid and rebuildable", () => {
    expect(registry().validateFeature(v7)).toMatchObject({ ok: true })
    expect(
      createFeatureContentIdentity(registry(), {
        feature: v7,
        environment,
        dependencies: [{ featureId: targetId, contentHash: hash, outputRole: "split.a" }],
      }),
    ).toMatchObject({ ok: true })
  })

  it("keeps editing that v7 record on v7", () => {
    const route = routeRevolveAuthoring(
      { ...base, operation: "add", targetBody: namedTarget },
      revolveFeatureTypeV7.type,
    )
    expect(route?.type).toEqual(revolveFeatureTypeV7.type)
    expect(registry().validateFeature({ ...v7, ...route })).toMatchObject({ ok: true })
  })

  it("applies the whole-result support rule only to v8", () => {
    const v8 = supported(revolveFeatureTypeV8.type, {
      ...base,
      operation: "add",
      targetBody: namedTarget,
    })
    expect(registry().validateFeature(v8)).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([expect.objectContaining({ path: "references" })]),
      },
    })
  })
})
