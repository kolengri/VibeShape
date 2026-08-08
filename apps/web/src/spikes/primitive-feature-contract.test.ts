import {
  boxFeatureType,
  createFeatureContentIdentity,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  serializeFeatureContentEnvironment as serializeDomainEnvironment,
} from "@vibeshape/domain"
import {
  primitiveFeatureContentIdentitySchema,
  serializeFeatureContentEnvironment as serializeProtocolEnvironment,
  serializePrimitiveFeatureContentIdentity,
} from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"

function registry() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return featureTypes.registry
}

const environment = {
  schemaVersion: 0,
  hostApiVersion: "0.1.0",
  geometry: {
    adapterId: "org.vibeshape.geometry.replicad",
    adapterVersion: "spike-2",
    kernelId: "org.opencascade.occt",
    kernelVersion: "0.23.0",
    kernelSourceRevision: null,
  },
  modelingTolerancePolicyVersion: 1,
  provider: { kind: "built-in" },
} as const

describe("primitive feature protocol composition", () => {
  it("preserves domain canonical identity across the dependency-free worker contract", () => {
    const content = createFeatureContentIdentity(registry(), {
      feature: {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(2, "cm"),
          depth: createLengthQuantity(30),
          height: createLengthQuantity(1, "in"),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      },
      dependencies: [],
      environment,
    })

    expect(content.ok).toBe(true)
    if (!content.ok) return
    const wireContent = primitiveFeatureContentIdentitySchema.parse(content.identity)

    expect(serializePrimitiveFeatureContentIdentity(wireContent)).toBe(content.canonicalPayload)
    expect(serializeProtocolEnvironment(wireContent.environment)).toBe(
      serializeDomainEnvironment(content.identity.environment),
    )
  })
})
