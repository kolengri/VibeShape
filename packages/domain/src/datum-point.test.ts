import { describe, expect, it } from "bun:test"
import { documentSnapshotSchema } from "./document"
import { createDocumentDependencyGraphFromSnapshot } from "./document-graph"
import { createFeatureContentIdentity } from "./feature-content-identity"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  referenceGeometryModule,
} from "./modules"
import {
  datumPointFeatureType,
  datumPointParametersSchema,
  isReferenceGeometryFeature,
  readDatumPointFeatureParameters,
  referenceGeometryFeatureTypeHandlers,
} from "./reference-geometry"
import { createLengthQuantity } from "./units"
import type { ExpressionValue } from "./variables"

const ownerId = "0195b5ac-b220-7a2c-8c33-67a36a7f3401"
const pointId = "0195b5ac-b220-7a2c-8c33-67a36a7f3402"
const environment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  modelingTolerancePolicyVersion: 1,
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "test",
    kernelId: "org.opencascade.occt",
    kernelVersion: "test",
    kernelSourceRevision: null,
  },
  provider: { kind: "built-in" },
} as const

function registry() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, referenceGeometryFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  return types.registry
}

const signature = (kind: "vertex" | "edge", geometryClass: string) => ({
  kind,
  geometryClass,
  measure: kind === "vertex" ? 0 : 12 * Math.PI,
  centroid: [5, -3, 12],
  bounds: { min: [5, -3, 12], max: [5, -3, 12] },
  boundaryCount: 0,
  adjacentGeometryClasses: [],
})
const vertexReference = {
  schemaVersion: 1,
  featureId: ownerId,
  outputRole: "result",
  kind: "vertex",
  semanticRole: "primitive.box.vertex.7",
  signature: signature("vertex", "POINT"),
}
const circleReference = {
  schemaVersion: 1,
  featureId: ownerId,
  outputRole: "result",
  kind: "edge",
  signature: signature("edge", "CIRCLE"),
}
const coordinates = {
  mode: "coordinates",
  position: {
    x: createLengthQuantity(1, "cm"),
    y: createLengthQuantity(-2.5),
    z: createLengthQuantity(7, "mm", "#height"),
  },
}

function datumPoint(parameters: unknown, dependencies: readonly string[] = []): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id: pointId,
    type: datumPointFeatureType.type,
    parameters,
    dependencies,
    references: [],
    suppressed: false,
    label: "Datum point 1",
  })
}

describe("Datum Point v1", () => {
  it("registers a reference-geometry type whose coordinates hash as millimeters", () => {
    const types = registry()
    const variables = new Map<string, ExpressionValue>([
      ["height", { dimension: "length", value: 9 }],
    ])
    const resolved = types.resolveFeatureParameters(datumPoint(coordinates), variables)
    if (!resolved.ok) throw new Error(resolved.diagnostic.message)
    const content = createFeatureContentIdentity(types, {
      feature: resolved.feature,
      environment,
      dependencies: [],
    })
    expect(content).toMatchObject({
      ok: true,
      identity: { feature: { parameters: { mode: "coordinates", position: [10, -2.5, 9] } } },
    })
    expect(types.validateFeature(datumPoint(coordinates))).toMatchObject({
      ok: true,
      descriptor: { classification: "reference" },
    })
  })

  it("rejects unresolved, non-length and out-of-workspace coordinate expressions", () => {
    const types = registry()
    const feature = datumPoint(coordinates)
    expect(types.resolveFeatureParameters(feature, new Map())).toMatchObject({ ok: false })
    for (const value of [
      { dimension: "angle" as const, value: 1 },
      { dimension: "length" as const, value: 100_001 },
    ])
      expect(types.resolveFeatureParameters(feature, new Map([["height", value]]))).toMatchObject({
        ok: false,
        diagnostic: { issues: [{ path: "parameters.position.z" }] },
      })
    expect(
      datumPointParametersSchema.safeParse({
        ...coordinates,
        position: { ...coordinates.position, x: createLengthQuantity(100_001) },
      }).success,
    ).toBe(false)
  })

  it.each([
    ["vertex", vertexReference],
    ["circle-center", circleReference],
  ] as const)(
    "persists only the body-bound %s reference and its owner dependency",
    (mode, reference) => {
      const types = registry()
      const point = datumPoint({ mode, reference }, [ownerId])
      expect(types.validateFeature(point)).toMatchObject({
        ok: true,
        contentParameters: { mode, reference },
      })
      expect(readDatumPointFeatureParameters(point)).toEqual({ mode, reference } as never)
      expect(isReferenceGeometryFeature(point)).toBe(true)
      for (const dependencies of [[], [ownerId, ownerId.replace(/1$/, "9")]])
        expect(types.validateFeature(datumPoint({ mode, reference }, dependencies)).ok).toBe(false)
      const { outputRole: _role, ...topoRef } = circleReference
      expect(
        types.validateFeature(
          featureRecordSchema.parse({ ...point, references: [{ ...topoRef, schemaVersion: 0 }] }),
        ).ok,
      ).toBe(false)
    },
  )

  it("rejects mismatched reference geometry and coordinate dependencies", () => {
    for (const parameters of [
      { mode: "vertex", reference: circleReference },
      { mode: "circle-center", reference: vertexReference },
      {
        mode: "circle-center",
        reference: { ...circleReference, signature: signature("edge", "LINE") },
      },
      { mode: "vertex", reference: { ...vertexReference, outputRole: undefined } },
    ])
      expect(datumPointParametersSchema.safeParse(parameters).success).toBe(false)
    expect(registry().validateFeature(datumPoint(coordinates, [ownerId])).ok).toBe(false)
  })

  it("round-trips through a native document and keeps its owner in the dependency graph", () => {
    const owner = featureRecordSchema.parse({
      schemaVersion: 0,
      id: ownerId,
      type: {
        moduleId: "org.vibeshape.core.part-design",
        moduleVersion: "0.1.0",
        typeId: "org.vibeshape.feature.part-design.box",
        schemaVersion: 1,
      },
      parameters: {
        width: createLengthQuantity(10),
        depth: createLengthQuantity(10),
        height: createLengthQuantity(10),
        centered: false,
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const point = datumPoint({ mode: "vertex", reference: vertexReference }, [ownerId])
    const snapshot = documentSnapshotSchema.parse({
      schemaVersion: 0,
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f3400",
      revision: 2,
      name: "Datum point",
      displayUnits: { length: "mm", angle: "deg" },
      variables: [],
      sketches: [],
      features: [owner, point],
      createdAt: "2026-11-10T00:00:00.000Z",
      updatedAt: "2026-11-10T00:00:00.000Z",
    })
    const restored = documentSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.features[1]).toEqual(point)
    const graph = createDocumentDependencyGraphFromSnapshot(restored)
    expect(graph.ok).toBe(true)
  })
})
