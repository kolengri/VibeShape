import { describe, expect, it } from "vitest"
import {
  coreCommandHandlers,
  createCommandDispatcher,
  documentCoreCommandHandlers,
  type TrustedCommandHandler,
} from "./command-dispatcher"
import { draftIdSchema, moduleIdSchema } from "./identifiers"
import { createModuleRegistry, documentCoreModule, featureCoreModule } from "./modules"

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
    const registry = createModuleRegistry([documentCoreModule, featureCoreModule])

    expect(registry.ok).toBe(true)
    if (!registry.ok) return

    const dispatcher = createCommandDispatcher(registry.registry, coreCommandHandlers)

    expect(dispatcher.ok).toBe(true)
    if (!dispatcher.ok) return

    const created = dispatcher.dispatcher.dispatch(
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

    const added = dispatcher.dispatcher.dispatch(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b215-7a2c-ac33-67a36a7f21ac",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T12:01:00Z",
      actor: userActor,
      payload: {
        feature: {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.test",
            schemaVersion: 1,
          },
          parameters: { length: 10 },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })

    expect(added).toMatchObject({
      ok: true,
      snapshot: { revision: 2, features: [{ parameters: { length: 10 } }] },
      event: { type: "org.vibeshape.feature.added" },
    })
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
})
