import { describe, expect, it } from "bun:test"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  referenceGeometryModule,
} from "./modules"
import {
  datumPlaneFeatureType,
  datumPlaneParametersSchema,
  referenceGeometryFeatureTypeHandlers,
} from "./reference-geometry"
import { createAngleQuantity, createLengthQuantity } from "./units"
import { evaluateVariableDefinitions } from "./variables"

const supportFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3301"
const datumFeatureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3302"

function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(
    modules.registry,
    referenceGeometryFeatureTypeHandlers,
  )
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

function planarReference() {
  return {
    schemaVersion: 0,
    featureId: supportFeatureId,
    kind: "face",
    semanticRole: "primitive.box.cap.end",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 600,
      centroid: [0, 0, 20],
      bounds: { min: [-10, -15, 20], max: [10, 15, 20] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  } as const
}

function datum(parameters: unknown, dependencies: string[] = [], references: unknown[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: datumFeatureId,
    type: datumPlaneFeatureType.type,
    parameters,
    dependencies,
    references,
    suppressed: false,
    label: "Plane 1",
  })
}

const originParameters = {
  mode: "offset",
  support: { kind: "origin-plane", plane: "xz" },
  offset: createLengthQuantity(12),
} as const

function contentIdentity(feature: unknown) {
  const result = createFeatureContentIdentity(registry(), {
    feature,
    dependencies: [],
    environment: {
      schemaVersion: 0,
      hostApiVersion: "0.1.0",
      geometry: {
        adapterId: "org.vibeshape.geometry.replicad",
        adapterVersion: "0.1.0+test",
        kernelId: "org.opencascade.occt",
        kernelVersion: "7.8.1",
        kernelSourceRevision: null,
      },
      modelingTolerancePolicyVersion: 1,
      provider: { kind: "built-in" },
    },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.canonicalPayload
}

function angleVariables(expression: string) {
  const result = evaluateVariableDefinitions([
    {
      schemaVersion: 0,
      id: "0195b5ac-b240-7a2c-8c33-67a36a7f21ac",
      name: "tilt",
      expression,
    },
  ])
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.valuesByName
}

describe("datum plane feature", () => {
  it("preserves legacy records and canonical content exactly for absent and zero rotation", () => {
    expect(datumPlaneParametersSchema.parse(originParameters)).toEqual(originParameters)
    const legacy = datum(originParameters)
    const resolved = registry().resolveFeatureParameters(legacy, new Map())
    expect(resolved).toEqual({ ok: true, feature: legacy })
    expect(registry().validateFeature(legacy)).toMatchObject({
      ok: true,
      contentParameters: { mode: "offset", support: originParameters.support, offset: 12 },
    })
    for (const axis of ["x", "y"]) {
      expect(
        contentIdentity(
          datum({ ...originParameters, rotation: { axis, angle: createAngleQuantity(0) } }),
        ),
      ).toEqual(contentIdentity(legacy))
    }
  })

  it.each([-360, -90, 0, 90, 360])("accepts a signed rotation of %s degrees", (degrees) => {
    expect(
      registry().validateFeature(
        datum({
          ...originParameters,
          rotation: { axis: "y", angle: createAngleQuantity(degrees, "deg") },
        }),
      ),
    ).toMatchObject({ ok: true })
  })

  it.each([
    { axis: "z", angle: createAngleQuantity(1) },
    { axis: "x" },
    { axis: "x", angle: createLengthQuantity(1) },
    { axis: "x", angle: createAngleQuantity(361, "deg") },
    { axis: "y", angle: createAngleQuantity(-361, "deg") },
    { axis: "x", angle: { ...createAngleQuantity(1), value: Number.POSITIVE_INFINITY } },
    { axis: "x", angle: createAngleQuantity(1), pivot: [0, 0, 0] },
  ])("rejects invalid rotation intent %j", (rotation) => {
    expect(datumPlaneParametersSchema.safeParse({ ...originParameters, rotation }).success).toBe(
      false,
    )
  })

  it("resolves variable angles before range validation and fingerprints only the resolved axis and angle", () => {
    const feature = datum({
      ...originParameters,
      rotation: { axis: "x", angle: createAngleQuantity(400, "deg", "#tilt") },
    })
    const resolve = (expression: string) => {
      const result = registry().resolveFeatureParameters(feature, angleVariables(expression))
      if (!result.ok) throw new Error(result.diagnostic.message)
      return result.feature
    }
    const first = resolve("90 deg")
    expect(first.parameters).toMatchObject({
      rotation: { axis: "x", angle: { value: Math.PI / 2, source: { expression: "#tilt" } } },
    })
    expect(contentIdentity(first)).toEqual(
      contentIdentity(
        datum({
          ...originParameters,
          rotation: { axis: "x", angle: createAngleQuantity(Math.PI / 2) },
        }),
      ),
    )
    expect(contentIdentity(resolve("-90 deg"))).not.toEqual(contentIdentity(first))
    const zero = resolve("0 deg")
    expect(zero.parameters).toMatchObject({
      rotation: { axis: "x", angle: { value: 0, source: { expression: "#tilt" } } },
    })
    expect(contentIdentity(zero)).toEqual(contentIdentity(datum(originParameters)))
    expect(
      contentIdentity(
        datum({
          ...originParameters,
          rotation: { axis: "y", angle: createAngleQuantity(90, "deg") },
        }),
      ),
    ).not.toEqual(contentIdentity(first))
    expect(registry().resolveFeatureParameters(feature, angleVariables("361 deg"))).toMatchObject({
      ok: false,
      diagnostic: {
        reason: "invalid-rotation-angle",
        issues: [{ path: "parameters.rotation.angle" }],
      },
    })
    expect(registry().resolveFeatureParameters(feature, angleVariables("2 mm"))).toMatchObject({
      ok: false,
      diagnostic: {
        reason: "expression-dimension-mismatch",
        issues: [{ path: "parameters.rotation.angle" }],
      },
    })
    expect(registry().resolveFeatureParameters(feature, new Map())).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "parameters.rotation.angle" }] },
    })
  })

  it("accepts a signed origin-plane offset without a feature dependency", () => {
    const feature = datum({
      mode: "offset",
      support: { kind: "origin-plane", plane: "xy" },
      offset: createLengthQuantity(-12),
    })

    expect(registry().validateFeature(feature)).toMatchObject({ ok: true })
  })

  it("requires a face support reference and its exact owning dependency", () => {
    const reference = planarReference()
    const parameters = {
      mode: "offset",
      support: { kind: "feature-face", reference },
      offset: createLengthQuantity(8),
    }
    const valid = datum(parameters, [supportFeatureId], [reference])
    const invalid = datum(parameters, [], [])

    expect(registry().validateFeature(valid)).toMatchObject({ ok: true })
    expect(registry().validateFeature(invalid)).toMatchObject({
      ok: false,
      diagnostic: { issues: [{ path: "dependencies" }] },
    })
  })
})
