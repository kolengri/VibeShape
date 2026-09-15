import { describe, expect, it } from "vitest"
import {
  computeFeatureContentHash,
  createFeatureContentIdentity,
  type FeatureContentEnvironment,
} from "./feature-content-identity"
import { featureBodyDependencyIds } from "./feature-dependencies"
import { type FeatureRecord, featureRecordSchema } from "./feature-graph"
import { createFeatureTypeRegistry, type FeatureTypeRegistry } from "./feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { partDesignFeatureTypeHandlers } from "./part-design"
import { holeFeatureTypeV2, holeFeatureType as registeredHoleFeatureType } from "./part-design-hole"
import { topoRefSchema } from "./topology"
import { createLengthQuantity } from "./units"

const environment: FeatureContentEnvironment = {
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
}

const ids = {
  targetA: "0195b5ac-b220-7a2c-8c33-67a36a7f5101",
  supportA: "0195b5ac-b220-7a2c-8c33-67a36a7f5102",
  holeA: "0195b5ac-b220-7a2c-8c33-67a36a7f5103",
  targetB: "0195b5ac-b220-7a2c-8c33-67a36a7f5201",
  supportB: "0195b5ac-b220-7a2c-8c33-67a36a7f5202",
  holeB: "0195b5ac-b220-7a2c-8c33-67a36a7f5203",
  sketchA: "0195b5ac-b220-7a2c-8c33-67a36a7f5301",
  sketchB: "0195b5ac-b220-7a2c-8c33-67a36a7f5302",
  pointA: "0195b5ac-b220-7a2c-8c33-67a36a7f5401",
  pointB: "0195b5ac-b220-7a2c-8c33-67a36a7f5402",
} as const

function registry(): FeatureTypeRegistry {
  const modules = createModuleRegistry([partDesignModule, featureCoreModule, documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const result = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.registry
}

function supportReference(featureId: string) {
  return topoRefSchema.parse({
    schemaVersion: 0,
    featureId,
    kind: "face",
    semanticRole: "support.face",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 1,
      centroid: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      boundaryCount: 4,
      adjacentGeometryClasses: [],
    },
  })
}

function holeFeature(
  id: string,
  sketchId: string,
  pointId: string,
  dependencies: string[],
  referenceId?: string,
): FeatureRecord {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: registeredHoleFeatureType.type,
    parameters: {
      sketchId,
      pointIds: [pointId],
      diameter: createLengthQuantity(8),
      direction: "forward",
      extent: "blind",
      depth: createLengthQuantity(12),
    },
    dependencies,
    references: referenceId ? [supportReference(referenceId)] : [],
    suppressed: false,
  })
}

const preparedContent = {
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  centers: [[1, 2, 3]],
  diameter: 8,
  extent: "blind",
  depth: 12,
  direction: "forward",
  supportInputIndex: 0,
}

function equivalentPreparedContent(supportInputIndex: number) {
  return { ...preparedContent, supportInputIndex }
}

describe("Hole feature content identity", () => {
  it("is UUID-independent for same-target support slot zero", async () => {
    const first = holeFeature(ids.holeA, ids.sketchA, ids.pointA, [ids.targetA], ids.targetA)
    const second = holeFeature(ids.holeB, ids.sketchB, ids.pointB, [ids.targetB], ids.targetB)
    const dependenciesA = [{ featureId: ids.targetA, contentHash: "a".repeat(64) }]
    const dependenciesB = [{ featureId: ids.targetB, contentHash: "a".repeat(64) }]
    const firstIdentity = createFeatureContentIdentity(registry(), {
      feature: first,
      dependencies: dependenciesA,
      environment,
      contentParameters: equivalentPreparedContent(0),
    })
    const secondIdentity = createFeatureContentIdentity(registry(), {
      feature: second,
      dependencies: dependenciesB,
      environment,
      contentParameters: equivalentPreparedContent(0),
    })
    expect(firstIdentity).toMatchObject({ ok: true })
    expect(secondIdentity).toMatchObject({ ok: true })
    if (!firstIdentity.ok || !secondIdentity.ok) return
    expect(firstIdentity.canonicalPayload).toBe(secondIdentity.canonicalPayload)
    const hash = async () => "b".repeat(64)
    await expect(
      computeFeatureContentHash(
        registry(),
        {
          feature: first,
          dependencies: dependenciesA,
          environment,
          contentParameters: equivalentPreparedContent(0),
        },
        hash,
      ),
    ).resolves.toMatchObject({ contentHash: "b".repeat(64) })
  })

  it("keeps distinct sketch support in input slot one and consumes only the target body", () => {
    const first = holeFeature(
      ids.holeA,
      ids.sketchA,
      ids.pointA,
      [ids.targetA, ids.supportA],
      ids.supportA,
    )
    const second = holeFeature(
      ids.holeB,
      ids.sketchB,
      ids.pointB,
      [ids.targetB, ids.supportB],
      ids.supportB,
    )
    const firstIdentity = createFeatureContentIdentity(registry(), {
      feature: first,
      dependencies: [
        { featureId: ids.targetA, contentHash: "a".repeat(64) },
        { featureId: ids.supportA, contentHash: "c".repeat(64) },
      ],
      environment,
      contentParameters: equivalentPreparedContent(1),
    })
    const secondIdentity = createFeatureContentIdentity(registry(), {
      feature: second,
      dependencies: [
        { featureId: ids.targetB, contentHash: "a".repeat(64) },
        { featureId: ids.supportB, contentHash: "c".repeat(64) },
      ],
      environment,
      contentParameters: equivalentPreparedContent(1),
    })
    expect(firstIdentity).toMatchObject({ ok: true })
    expect(secondIdentity).toMatchObject({ ok: true })
    if (!firstIdentity.ok || !secondIdentity.ok) return
    expect(firstIdentity.identity.feature.inputs).toEqual(["a".repeat(64), "c".repeat(64)])
    expect(firstIdentity.identity.feature.references[0]).toMatchObject({ inputIndex: 1 })
    expect(firstIdentity.canonicalPayload).toBe(secondIdentity.canonicalPayload)
    expect(featureBodyDependencyIds(first)).toEqual([ids.targetA])
  })
})

describe("authored Hole body identity", () => {
  it("rejects dropped or substituted selectors and hashes the selected role without UUIDs", () => {
    const original = holeFeature(ids.holeA, ids.sketchA, ids.pointA, [ids.targetA])
    const feature = {
      ...original,
      type: holeFeatureTypeV2.type,
      parameters: {
        ...original.parameters,
        targetBody: { schemaVersion: 0, featureId: ids.targetA, outputRole: "pattern.instance.1" },
      },
    }
    for (const outputRole of [undefined, "result", "pattern.instance.2"]) {
      expect(
        createFeatureContentIdentity(registry(), {
          feature,
          environment,
          dependencies: [
            {
              featureId: ids.targetA,
              contentHash: "a".repeat(64),
              ...(outputRole === undefined ? {} : { outputRole }),
            },
          ],
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-dependency-content" } })
    }
    const result = createFeatureContentIdentity(registry(), {
      feature,
      environment,
      dependencies: [
        { featureId: ids.targetA, contentHash: "a".repeat(64), outputRole: "pattern.instance.1" },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.diagnostic.message)
    expect(result.identity).toMatchObject({
      schemaVersion: 1,
      feature: { inputRoles: ["pattern.instance.1"] },
    })
    expect(result.canonicalPayload).not.toContain(ids.targetA)
    expect(result.canonicalPayload).not.toContain("targetBody")
  })
})
