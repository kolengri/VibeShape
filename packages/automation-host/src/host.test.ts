import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import {
  createCommandDispatcher,
  documentCoreCommandHandlers,
} from "@vibeshape/domain/command-dispatcher"
import { applyDocumentCommand, commandActorSchema } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { commitDocumentDraft, type DraftCommit } from "@vibeshape/domain/drafts"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { describe, expect, it } from "vitest"
import { type AutomationDocumentPort, type AutomationHost, createAutomationHost } from "./host"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const otherDocumentId = "0195b5ac-b214-7a2c-8c33-67a36a7f21ac"
const draftIdA = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const draftIdB = "0195b5ac-b217-7a2c-8c33-67a36a7f21ac"
const startedAt = Date.parse("2026-08-08T12:00:00Z")

const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.model-client",
  sessionId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
})
const otherActor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.model-client",
  sessionId: "0195b5ac-b219-7a2c-8c33-67a36a7f21ac",
})

function command(
  kind: "org.vibeshape.document.create" | "org.vibeshape.document.rename",
  baseRevision: number,
  name: string,
  commandId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind,
    schemaVersion: 1,
    commandId,
    documentId,
    baseRevision,
    issuedAt: new Date(startedAt + baseRevision * 1_000).toISOString(),
    actor,
    payload: { name },
    ...overrides,
  }
}

function createdSnapshot(name = "Enclosure") {
  const result = applyDocumentCommand(
    null,
    command("org.vibeshape.document.create", 0, name, "0195b5ac-b21a-7a2c-8c33-67a36a7f21ac"),
  )

  if (!result.ok) {
    throw new Error(result.diagnostic.message)
  }

  return result.snapshot
}

function dispatchers() {
  const registryResult = createModuleRegistry([documentCoreModule])

  if (!registryResult.ok) {
    throw new Error(registryResult.diagnostic.message)
  }

  const commandResult = createCommandDispatcher(
    registryResult.registry,
    documentCoreCommandHandlers,
  )
  const queryResult = createQueryDispatcher(registryResult.registry, documentCoreQueryHandlers)

  if (!commandResult.ok) {
    throw new Error(commandResult.diagnostic.message)
  }
  if (!queryResult.ok) {
    throw new Error(queryResult.diagnostic.message)
  }

  return { commandDispatcher: commandResult.dispatcher, queryDispatcher: queryResult.dispatcher }
}

function documentStore(initial: DocumentSnapshot | null) {
  let current = initial
  let lastCommit: DraftCommit | null = null

  const port: AutomationDocumentPort = {
    readSnapshot: () => current,
    compareAndCommitDraft: (draft) => {
      const result = commitDocumentDraft(current, draft)

      if (result.ok) {
        current = result.commit.snapshot
        lastCommit = result.commit
      }

      return result
    },
  }

  return {
    port,
    snapshot: () => current,
    lastCommit: () => lastCommit,
    replace: (snapshot: DocumentSnapshot | null) => {
      current = snapshot
    },
  }
}

function automationHost(
  documents: AutomationDocumentPort,
  options: {
    draftIds?: readonly unknown[]
    now?: () => number
    draftTtlMs?: number
    maxDraftsPerActor?: number
    maxCommandsPerDraft?: number
  } = {},
): AutomationHost {
  const ids = [...(options.draftIds ?? [draftIdA])]
  const factory = createAutomationHost({
    ...dispatchers(),
    documents,
    createDraftId: () => ids.shift(),
    now: options.now ?? (() => startedAt),
    draftTtlMs: options.draftTtlMs ?? 5 * 60 * 1_000,
    maxDraftsPerActor: options.maxDraftsPerActor ?? 4,
    maxCommandsPerDraft: options.maxCommandsPerDraft ?? 64,
  })

  if (!factory.ok) {
    throw new Error(factory.diagnostic.message)
  }

  return factory.host
}

function createRequest(baseRevision: number) {
  return { schemaVersion: 1, documentId, baseRevision }
}

function operationRequest(draftId = draftIdA) {
  return { schemaVersion: 1, draftId }
}

function applyRequest(commandInput: unknown, draftId = draftIdA) {
  return { schemaVersion: 1, draftId, command: commandInput }
}

describe("automation draft host", () => {
  it("creates, previews, and atomically commits an owner-bound multi-command draft", async () => {
    const store = documentStore(null)
    const host = automationHost(store.port)
    const created = await host.createDraft(actor, createRequest(0))

    expect(created).toMatchObject({
      ok: true,
      value: {
        draftId: draftIdA,
        documentId,
        baseRevision: 0,
        revision: 0,
        commandCount: 0,
      },
    })

    const appliedCreate = await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.create",
          0,
          "Enclosure",
          "0195b5ac-b21a-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    const appliedRename = await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Enclosure v2",
          "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
        ),
      ),
    )

    expect(appliedCreate).toMatchObject({ ok: true, value: { revision: 1, commandCount: 1 } })
    expect(appliedRename).toMatchObject({ ok: true, value: { revision: 2, commandCount: 2 } })
    expect(store.snapshot()).toBeNull()

    const preview = await host.previewDraft(actor, operationRequest())
    expect(preview).toMatchObject({
      ok: true,
      value: {
        draft: { revision: 2, commandCount: 2 },
        summary: {
          documentId,
          revision: 2,
          classification: "semantic",
          truncated: false,
          data: { name: "Enclosure v2" },
        },
      },
    })

    const committed = await host.commitDraft(actor, operationRequest())
    expect(committed).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        draftId: draftIdA,
        documentId,
        baseRevision: 0,
        revision: 2,
        commandCount: 2,
      },
    })
    expect(store.snapshot()).toMatchObject({ revision: 2, name: "Enclosure v2" })
    expect(store.lastCommit()).toMatchObject({
      transactionId: draftIdA,
      actor,
      commandIds: ["0195b5ac-b21a-7a2c-8c33-67a36a7f21ac", "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac"],
    })
    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-not-found" },
    })
  })

  it("serializes concurrent commands so draft revisions cannot overwrite each other", async () => {
    const host = automationHost(documentStore(createdSnapshot()).port)
    await host.createDraft(actor, createRequest(1))

    const results = await Promise.all([
      host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            1,
            "Enclosure v2",
            "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
          ),
        ),
      ),
      host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            2,
            "Enclosure v3",
            "0195b5ac-b21c-7a2c-ac33-67a36a7f21ac",
          ),
        ),
      ),
    ])

    expect(results).toMatchObject([
      { ok: true, value: { revision: 2, commandCount: 1 } },
      { ok: true, value: { revision: 3, commandCount: 2 } },
    ])
    expect(await host.previewDraft(actor, operationRequest())).toMatchObject({
      ok: true,
      value: { summary: { revision: 3, data: { name: "Enclosure v3" } } },
    })
  })

  it("rejects actor, document, schema, route, and duplicate-command boundary violations", async () => {
    const host = automationHost(documentStore(createdSnapshot()).port)
    await host.createDraft(actor, createRequest(1))
    const rename = command(
      "org.vibeshape.document.rename",
      1,
      "Enclosure v2",
      "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
    )

    expect(await host.previewDraft(otherActor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-owner-mismatch" },
    })
    expect(
      await host.applyCommand(actor, applyRequest({ ...rename, actor: otherActor })),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-actor-mismatch" } })
    expect(
      await host.applyCommand(actor, applyRequest({ ...rename, documentId: otherDocumentId })),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-document-mismatch" } })
    expect(await host.applyCommand(actor, { ...applyRequest(rename), extra: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-draft-request" },
    })
    expect(
      await host.applyCommand(
        actor,
        applyRequest({ ...rename, kind: "org.example.document.unknown" }),
      ),
    ).toMatchObject({ ok: false, diagnostic: { code: "unregistered-command" } })

    expect(await host.applyCommand(actor, applyRequest(rename))).toMatchObject({ ok: true })
    expect(await host.applyCommand(actor, applyRequest(rename))).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command-id" },
    })
    expect(await host.createDraft({ type: "mcp" }, createRequest(1))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-automation-actor" },
    })
  })

  it("renews inactivity expiry and makes discard idempotent", async () => {
    let currentTime = startedAt
    const host = automationHost(documentStore(createdSnapshot()).port, {
      draftIds: [draftIdA],
      now: () => currentTime,
      draftTtlMs: 100,
    })
    const created = await host.createDraft(actor, createRequest(1))

    expect(created).toMatchObject({
      ok: true,
      value: { expiresAt: new Date(startedAt + 100).toISOString() },
    })

    currentTime += 50
    expect(await host.previewDraft(actor, operationRequest())).toMatchObject({
      ok: true,
      value: { draft: { expiresAt: new Date(startedAt + 150).toISOString() } },
    })

    currentTime += 101
    expect(await host.previewDraft(actor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-expired" },
    })
    expect(await host.discardDraft(actor, operationRequest())).toEqual({
      ok: true,
      value: { schemaVersion: 1, draftId: draftIdA, discarded: false },
    })
  })

  it("keeps explicit discard idempotent without granting another actor cleanup authority", async () => {
    const host = automationHost(documentStore(createdSnapshot()).port)
    await host.createDraft(actor, createRequest(1))

    expect(await host.discardDraft(otherActor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-owner-mismatch" },
    })
    expect(await host.discardDraft(actor, operationRequest())).toEqual({
      ok: true,
      value: { schemaVersion: 1, draftId: draftIdA, discarded: true },
    })
    expect(await host.discardDraft(actor, operationRequest())).toEqual({
      ok: true,
      value: { schemaVersion: 1, draftId: draftIdA, discarded: false },
    })
  })

  it("enforces active-draft and command limits before state can grow without bounds", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port, {
      draftIds: [draftIdA, draftIdB],
      maxDraftsPerActor: 1,
      maxCommandsPerDraft: 1,
    })

    await host.createDraft(actor, createRequest(1))
    expect(await host.createDraft(actor, createRequest(1))).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-limit-reached", retryable: true },
    })
    expect(
      await host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            1,
            "Enclosure v2",
            "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
          ),
        ),
      ),
    ).toMatchObject({ ok: true })
    expect(
      await host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            2,
            "Enclosure v3",
            "0195b5ac-b21c-7a2c-ac33-67a36a7f21ac",
          ),
        ),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-command-limit-reached" },
    })

    const collisionHost = automationHost(store.port, { draftIds: [draftIdA, draftIdA] })
    await collisionHost.createDraft(actor, createRequest(1))
    expect(await collisionHost.createDraft(otherActor, createRequest(1))).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-id-collision" },
    })
  })

  it("retains a draft after an atomic stale-revision commit rejection", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port)
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Draft rename",
          "0195b5ac-b21b-7a2c-9c33-67a36a7f21ac",
        ),
      ),
    )

    const concurrent = applyDocumentCommand(
      store.snapshot(),
      command(
        "org.vibeshape.document.rename",
        1,
        "Concurrent rename",
        "0195b5ac-b21c-7a2c-ac33-67a36a7f21ac",
      ),
    )

    if (!concurrent.ok) {
      throw new Error(concurrent.diagnostic.message)
    }
    store.replace(concurrent.snapshot)

    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision", retryable: true },
    })
    expect(await host.previewDraft(actor, operationRequest())).toMatchObject({
      ok: true,
      value: { summary: { data: { name: "Draft rename" } } },
    })
    expect(store.snapshot()).toMatchObject({ name: "Concurrent rename" })
  })

  it("fails closed on invalid generated IDs, document snapshots, and host options", async () => {
    expect(
      createAutomationHost({
        ...dispatchers(),
        documents: documentStore(null).port,
        createDraftId: () => draftIdA,
        draftTtlMs: 0,
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-host-configuration" } })

    const invalidIdHost = automationHost(documentStore(null).port, { draftIds: ["invalid"] })
    expect(await invalidIdHost.createDraft(actor, createRequest(0))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-generated-draft-id" },
    })

    const invalidSnapshotHost = automationHost({
      readSnapshot: () => ({ invalid: true }),
      compareAndCommitDraft: (draft) => commitDocumentDraft(null, draft),
    })
    expect(await invalidSnapshotHost.createDraft(actor, createRequest(0))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-document-snapshot" },
    })

    const invalidClockHost = automationHost(documentStore(null).port, {
      now: () => Number.NaN,
    })
    expect(await invalidClockHost.createDraft(actor, createRequest(0))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-host-clock" },
    })

    const staleBaseHost = automationHost(documentStore(createdSnapshot()).port)
    expect(await staleBaseHost.createDraft(actor, createRequest(0))).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision", retryable: true },
    })
  })

  it("contains port failures and keeps the serialized operation queue usable", async () => {
    let reads = 0
    const host = automationHost(
      {
        readSnapshot: () => {
          reads += 1
          if (reads === 1) {
            throw new Error("Injected read failure")
          }
          return null
        },
        compareAndCommitDraft: (draft) => commitDocumentDraft(null, draft),
      },
      { draftIds: [draftIdA, draftIdB] },
    )

    expect(await host.createDraft(actor, createRequest(0))).toMatchObject({
      ok: false,
      diagnostic: { code: "automation-operation-failed", retryable: true },
    })
    expect(await host.createDraft(actor, createRequest(0))).toMatchObject({
      ok: true,
      value: { draftId: draftIdB },
    })
  })
})
