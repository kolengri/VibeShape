import { describe, expect, it } from "vitest"
import {
  createCommandDispatcher,
  createCoreCommandHandlers,
  documentCoreCommandHandlers,
  type TrustedCommandHandler,
} from "./command-dispatcher"
import { applyDocumentCommand } from "./commands"
import { createFeatureTypeRegistry } from "./feature-type-registry"
import { draftIdSchema, moduleIdSchema } from "./identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "./modules"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "./part-design"
import { createLengthQuantity } from "./units"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const userActor = { type: "user", userId: "org.vibeshape.user.alice" } as const

function command(
  kind: "org.vibeshape.document.create" | "org.vibeshape.document.rename",
  baseRevision: number,
  name: string,
  commandId: string,
) {
  return {
    kind,
    schemaVersion: 1,
    commandId,
    documentId,
    baseRevision,
    issuedAt: baseRevision === 0 ? "2026-08-08T12:00:00Z" : "2026-08-08T12:01:00Z",
    actor: userActor,
    payload: { name },
  }
}

function moduleRegistry() {
  const result = createModuleRegistry([documentCoreModule])

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.registry
}

function commandDispatcher() {
  const result = createCommandDispatcher(moduleRegistry(), documentCoreCommandHandlers)

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.dispatcher
}

function featureComposition() {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])

  if (!modules.ok) throw new Error(modules.diagnostic.message)

  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)

  return { modules: modules.registry, featureTypes: featureTypes.registry }
}

function featureCommandDispatcher() {
  const composition = featureComposition()

  const dispatcher = createCommandDispatcher(
    composition.modules,
    createCoreCommandHandlers(composition.featureTypes),
  )
  if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
  return dispatcher.dispatcher
}

function boxFeature(parameters: Record<string, unknown> = {}) {
  return {
    schemaVersion: 0,
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
    type: boxFeatureType.type,
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(30),
      height: createLengthQuantity(1, "in"),
      centered: true,
      ...parameters,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  }
}

describe("trusted command dispatcher", () => {
  it("routes first-party commands through registered handlers", () => {
    const dispatcher = commandDispatcher()
    const created = dispatcher.dispatch(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
      { transactionId: draftIdSchema.parse(draftId) },
    )

    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }

    expect(created.event.transactionId).toBe(draftId)

    const renamed = dispatcher.dispatch(
      created.snapshot,
      command(
        "org.vibeshape.document.rename",
        1,
        "Enclosure v2",
        "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      ),
    )

    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(renamed.snapshot.name).toBe("Enclosure v2")
      expect(renamed.snapshot.revision).toBe(2)
    }
  })

  it("routes feature commands only when the feature module and handler set are composed", () => {
    const dispatcher = featureCommandDispatcher()
    const created = dispatcher.dispatch(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const added = dispatcher.dispatch(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: { feature: boxFeature() },
    })

    expect(added).toMatchObject({
      ok: true,
      snapshot: {
        revision: 2,
        features: [{ type: boxFeatureType.type, parameters: { height: { value: 25.4 } } }],
      },
      event: { type: "org.vibeshape.feature.added" },
    })
  })

  it("rejects unavailable and invalid feature types before creating an event", () => {
    const dispatcher = featureCommandDispatcher()
    const created = dispatcher.dispatch(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const base = {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: { feature: boxFeature() },
    }

    expect(
      dispatcher.dispatch(created.snapshot, {
        ...base,
        payload: {
          feature: {
            ...boxFeature(),
            type: {
              moduleId: "org.example.features",
              moduleVersion: "1.0.0",
              typeId: "org.example.feature.unknown",
              schemaVersion: 1,
            },
          },
        },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "feature-type-unavailable" } })
    expect(
      dispatcher.dispatch(created.snapshot, {
        ...base,
        payload: { feature: boxFeature({ width: createLengthQuantity(0) }) },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-parameters", issues: [{ path: "parameters.width" }] },
    })
    expect(created.snapshot).toMatchObject({ revision: 1, features: [] })
  })

  it("rejects a feature whose trusted semantic content projection fails", () => {
    const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
    const [boxHandler, cylinderHandler, booleanHandler] = partDesignFeatureTypeHandlers
    if (!modules.ok || !boxHandler || !cylinderHandler || !booleanHandler) {
      throw new Error("The part design command composition fixture is invalid.")
    }
    const featureTypes = createFeatureTypeRegistry(modules.registry, [
      {
        ...boxHandler,
        contentParameters() {
          throw new Error("trusted implementation detail")
        },
      },
      cylinderHandler,
      booleanHandler,
    ])
    if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
    const composed = createCommandDispatcher(
      modules.registry,
      createCoreCommandHandlers(featureTypes.registry),
    )
    if (!composed.ok) throw new Error(composed.diagnostic.message)

    const created = composed.dispatcher.dispatch(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(
      composed.dispatcher.dispatch(created.snapshot, {
        kind: "org.vibeshape.feature.add",
        schemaVersion: 1,
        commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
        documentId,
        baseRevision: 1,
        issuedAt: "2026-08-08T12:01:00Z",
        actor: userActor,
        payload: { feature: boxFeature() },
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-feature-content-parameters" },
    })
    expect(created.snapshot).toMatchObject({ revision: 1, features: [] })
  })

  it("validates updates but permits suppression of a preserved unavailable feature", () => {
    const dispatcher = featureCommandDispatcher()
    const created = dispatcher.dispatch(
      null,
      command(
        "org.vibeshape.document.create",
        0,
        "Enclosure",
        "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
      ),
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const added = dispatcher.dispatch(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: { feature: boxFeature() },
    })

    expect(added.ok).toBe(true)
    if (!added.ok) return

    expect(
      dispatcher.dispatch(added.snapshot, {
        kind: "org.vibeshape.feature.update",
        schemaVersion: 1,
        commandId: "0195b5ac-b216-7a2c-bc33-67a36a7f21ac",
        documentId,
        baseRevision: 2,
        issuedAt: "2026-08-08T12:02:00Z",
        actor: userActor,
        payload: { feature: boxFeature({ height: createLengthQuantity(0) }) },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-feature-parameters" } })
    expect(added.snapshot).toMatchObject({ revision: 2, features: [{ suppressed: false }] })

    const preserved = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b217-7a2c-8c33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: {
        feature: {
          ...boxFeature(),
          type: {
            moduleId: "org.example.features",
            moduleVersion: "1.0.0",
            typeId: "org.example.feature.preserved",
            schemaVersion: 1,
          },
          parameters: { opaque: true },
        },
      },
    })

    expect(preserved.ok).toBe(true)
    if (!preserved.ok) return

    expect(
      dispatcher.dispatch(preserved.snapshot, {
        kind: "org.vibeshape.feature.set-suppressed",
        schemaVersion: 1,
        commandId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
        documentId,
        baseRevision: 2,
        issuedAt: "2026-08-08T12:02:00Z",
        actor: userActor,
        payload: {
          featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          suppressed: true,
        },
      }),
    ).toMatchObject({ ok: true, snapshot: { revision: 3, features: [{ suppressed: true }] } })
  })

  it.each([null, {}, { kind: "invalid", schemaVersion: 1 }])(
    "rejects invalid command routes before handler execution",
    (input) => {
      expect(commandDispatcher().dispatch(null, input)).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-command-route" },
      })
    },
  )

  it("rejects unregistered commands and unsupported schema versions", () => {
    const dispatcher = commandDispatcher()

    expect(
      dispatcher.dispatch(null, {
        kind: "org.example.document.unknown",
        schemaVersion: 1,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unregistered-command" } })
    expect(
      dispatcher.dispatch(null, {
        ...command(
          "org.vibeshape.document.create",
          0,
          "Enclosure",
          "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
        ),
        schemaVersion: 2,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "unsupported-command-version" } })
  })

  it("keeps strict command validation and domain failures behind the dispatcher", () => {
    const dispatcher = commandDispatcher()
    const invalid = command(
      "org.vibeshape.document.create",
      0,
      "Enclosure",
      "0195b5ac-b214-7a2c-8c33-67a36a7f21ac",
    )

    expect(dispatcher.dispatch(null, { ...invalid, payload: { name: "   " } })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-command" },
    })

    const created = dispatcher.dispatch(null, invalid)
    expect(created.ok).toBe(true)

    if (created.ok) {
      expect(
        dispatcher.dispatch(
          created.snapshot,
          command(
            "org.vibeshape.document.rename",
            0,
            "Stale rename",
            "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
          ),
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    }
  })

  it("requires exactly one trusted handler for every command descriptor", () => {
    const handlers = documentCoreCommandHandlers
    const first = handlers[0]

    if (!first) {
      throw new Error("The document module must expose a command handler fixture.")
    }

    expect(createCommandDispatcher(moduleRegistry(), handlers.slice(0, 1))).toMatchObject({
      ok: false,
      diagnostic: { code: "missing-command-handler" },
    })
    expect(createCommandDispatcher(moduleRegistry(), [...handlers, first])).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command-handler" },
    })
  })

  it("rejects orphaned handlers and descriptor metadata drift", () => {
    const base = documentCoreCommandHandlers[0]

    if (!base) {
      throw new Error("The document module must expose a command handler fixture.")
    }

    const orphan: TrustedCommandHandler = { ...base, kind: "org.example.document.unknown" }
    const wrongOwner: TrustedCommandHandler = {
      ...base,
      ownerModuleId: moduleIdSchema.parse("org.example.document"),
    }
    const wrongVersion: TrustedCommandHandler = { ...base, schemaVersion: 2 }

    expect(
      createCommandDispatcher(moduleRegistry(), [...documentCoreCommandHandlers, orphan]),
    ).toMatchObject({ ok: false, diagnostic: { code: "orphan-command-handler" } })
    expect(
      createCommandDispatcher(moduleRegistry(), [
        wrongOwner,
        ...documentCoreCommandHandlers.slice(1),
      ]),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "command-handler-owner-mismatch" },
    })
    expect(
      createCommandDispatcher(moduleRegistry(), [
        wrongVersion,
        ...documentCoreCommandHandlers.slice(1),
      ]),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "command-handler-version-mismatch" },
    })
  })

  it("rejects feature handlers bound to a different feature type composition", () => {
    const incomplete = createModuleRegistry([documentCoreModule, featureCoreModule])
    const composition = featureComposition()

    expect(incomplete.ok).toBe(true)
    if (incomplete.ok) {
      expect(
        createCommandDispatcher(
          incomplete.registry,
          createCoreCommandHandlers(composition.featureTypes),
        ),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "command-handler-feature-types-mismatch" },
      })
    }
  })
})
