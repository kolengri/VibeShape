import { describe, expect, it } from "vitest"
import { featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  referenceGeometryModule,
} from "./modules"
import { datumPlaneFeatureType, referenceGeometryFeatureTypeHandlers } from "./reference-geometry"
import { createLengthQuantity } from "./units"

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

describe("datum plane feature", () => {
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
