import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import {
  createCommandDispatcher,
  createCoreCommandHandlers,
} from "@vibeshape/domain/command-dispatcher"
import { applyDocumentCommand, commandActorSchema } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { commitDocumentDraft, type DraftCommit } from "@vibeshape/domain/drafts"
import { createFeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "@vibeshape/domain/modules"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it } from "vitest"
import {
  type AutomationDocumentPort,
  type AutomationHost,
  createAutomationHost,
  type DraftReviewInput,
  type DraftReviewPort,
} from "./host"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const startedAt = Date.parse("2026-08-08T12:00:00Z")
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.model-client",
  sessionId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac",
})

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
    issuedAt: new Date(startedAt + baseRevision * 1_000).toISOString(),
    actor,
    payload: { name },
  } as const
}

function createdSnapshot(name = "Enclosure") {
  const result = applyDocumentCommand(
    null,
    command("org.vibeshape.document.create", 0, name, "0195b5ac-b21a-7a2c-8c33-67a36a7f21ac"),
  )
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.snapshot
}

function featureSnapshot(featureCount = 1) {
  let snapshot = createdSnapshot()
  for (let index = 0; index < featureCount; index += 1) {
    const featureId = `0195b5ac-b220-7a2c-8c33-67a36a7f3${String(index).padStart(3, "0")}`
    const result = applyDocumentCommand(snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: `0195b5ac-b221-7a2c-8c33-67a36a7f3${String(index).padStart(3, "0")}`,
      documentId,
      baseRevision: snapshot.revision,
      issuedAt: new Date(startedAt + snapshot.revision * 1_000).toISOString(),
      actor,
      payload: {
        feature: {
          schemaVersion: 0,
          id: featureId,
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(30),
            height: createLengthQuantity(1, "in"),
            centered: true,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })
    if (!result.ok) throw new Error(result.diagnostic.message)
    snapshot = result.snapshot
  }
  return snapshot
}

function dispatchers() {
  const registryResult = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    partDesignModule,
  ])
  if (!registryResult.ok) throw new Error(registryResult.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(
    registryResult.registry,
    partDesignFeatureTypeHandlers,
  )
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  const commandResult = createCommandDispatcher(
    registryResult.registry,
    createCoreCommandHandlers(featureTypes.registry),
  )
  const queryResult = createQueryDispatcher(registryResult.registry, documentCoreQueryHandlers)
  if (!commandResult.ok) throw new Error(commandResult.diagnostic.message)
  if (!queryResult.ok) throw new Error(queryResult.diagnostic.message)
  return { commandDispatcher: commandResult.dispatcher, queryDispatcher: queryResult.dispatcher }
}

function evidence(
  snapshot: DocumentSnapshot,
  status: "succeeded" | "failed" | "blocked" = "succeeded",
) {
  return {
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 1,
    features: snapshot.features.map((feature) =>
      status === "succeeded"
        ? {
            featureId: feature.id,
            status,
            contentHash: "a".repeat(64),
            shape: {
              valid: true,
              volume: 1,
              surfaceArea: 6,
              bounds: { min: [0, 0, 0], max: [1, 1, 1] },
              solidCount: 1,
              faceCount: 6,
              edgeCount: 12,
            },
          }
        : status === "failed"
          ? { featureId: feature.id, status, diagnosticCodes: ["org.vibeshape.test.failure"] }
          : { featureId: feature.id, status, blockedBy: [feature.id] },
    ),
  }
}

function documentStore(initial: DocumentSnapshot | null) {
  let current = initial
  let lastCommit: DraftCommit | null = null
  let portCalls = 0
  let receivedCommands: readonly unknown[] = []
  const port: AutomationDocumentPort = {
    readSnapshot: () => current,
    compareAndCommitDraft: (draft, commands) => {
      portCalls += 1
      receivedCommands = commands
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
    portCalls: () => portCalls,
    receivedCommands: () => receivedCommands,
    replace: (snapshot: DocumentSnapshot | null) => {
      current = snapshot
    },
  }
}

function automationHost(
  documents: AutomationDocumentPort,
  options: {
    geometry?: { evaluate: (snapshot: DocumentSnapshot) => PromiseLike<unknown> | unknown }
    review?: DraftReviewPort
    now?: () => number
    draftTtlMs?: number
  } = {},
): AutomationHost {
  const factory = createAutomationHost({
    ...dispatchers(),
    documents,
    geometry: options.geometry ?? { evaluate: (snapshot) => evidence(snapshot) },
    review: options.review ?? { confirm: () => "approved" },
    createDraftId: () => draftId,
    now: options.now ?? (() => startedAt),
    draftTtlMs: options.draftTtlMs ?? 5 * 60 * 1_000,
  })
  if (!factory.ok) throw new Error(factory.diagnostic.message)
  return factory.host
}

function createRequest(baseRevision: number) {
  return { schemaVersion: 1, documentId, baseRevision }
}

function operationRequest() {
  return { schemaVersion: 1, draftId }
}

function applyRequest(commandInput: unknown) {
  return { schemaVersion: 1, draftId, command: commandInput }
}

describe("exact automation draft host boundary", () => {
  it("returns schema-version 2 preview with a bounded valid measurement view", async () => {
    const store = documentStore(featureSnapshot(1))
    const host = automationHost(store.port)
    await host.createDraft(actor, createRequest(2))

    const preview = await host.previewDraft(actor, operationRequest())

    expect(preview).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 2,
        geometry: {
          status: "valid",
          measurements: {
            classification: "derived",
            data: { total: 1, features: [{ status: "succeeded" }] },
            nextCursor: null,
          },
        },
      },
    })
  })

  it.each(["failed", "blocked"] as const)(
    "rejects %s geometry even when it is outside the first page and permits repair",
    async (status) => {
      const store = documentStore(featureSnapshot(21))
      let currentStatus: "succeeded" | "failed" | "blocked" = status
      let reviews = 0
      const host = automationHost(store.port, {
        geometry: { evaluate: (snapshot) => evidence(snapshot, currentStatus) },
        review: {
          confirm: () => {
            reviews += 1
            return "approved"
          },
        },
      })
      await host.createDraft(actor, createRequest(22))
      await host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            22,
            "Repaired",
            "0195b5ac-b222-7a2c-8c33-67a36a7f21ac",
          ),
        ),
      )

      const invalid = await host.commitDraft(actor, operationRequest())
      expect(invalid).toMatchObject({ ok: false, diagnostic: { code: "draft-geometry-invalid" } })
      expect(store.portCalls()).toBe(0)
      expect(reviews).toBe(0)

      currentStatus = "succeeded"
      expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
        ok: true,
        value: { revision: 23 },
      })
    },
  )

  it("rejects stale geometry evidence", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port, {
      geometry: {
        evaluate: (snapshot) => ({ ...evidence(snapshot), revision: snapshot.revision + 1 }),
      },
    })
    await host.createDraft(actor, createRequest(1))
    const preview = await host.previewDraft(actor, operationRequest())
    expect(preview).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  })

  it("rechecks the base after asynchronous geometry evaluation", async () => {
    const store = documentStore(createdSnapshot())
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    let release!: () => void
    const geometryDone = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = automationHost(store.port, {
      geometry: {
        evaluate: async (snapshot) => {
          markEntered()
          await geometryDone
          return evidence(snapshot)
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Draft",
          "0195b5ac-b223-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    const commit = host.commitDraft(actor, operationRequest())
    await entered
    const concurrent = applyDocumentCommand(
      createdSnapshot(),
      command(
        "org.vibeshape.document.rename",
        1,
        "Concurrent change",
        "0195b5ac-b226-7a2c-8c33-67a36a7f21ac",
      ),
    )
    if (!concurrent.ok) throw new Error(concurrent.diagnostic.message)
    store.replace(concurrent.snapshot)
    release()
    expect(await commit).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(store.portCalls()).toBe(0)
  })

  it("rejects expiry that occurs while geometry is evaluating", async () => {
    const store = documentStore(createdSnapshot())
    let now = startedAt
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    let release!: () => void
    const geometryDone = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = automationHost(store.port, {
      now: () => now,
      draftTtlMs: 1_000,
      geometry: {
        evaluate: async (snapshot) => {
          markEntered()
          await geometryDone
          return evidence(snapshot)
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Draft",
          "0195b5ac-b224-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    const commit = host.commitDraft(actor, operationRequest())
    await entered
    now += 1_001
    release()
    expect(await commit).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
    expect(store.portCalls()).toBe(0)
  })

  it("revalidates preview ownership after asynchronous geometry evaluation", async () => {
    const store = documentStore(createdSnapshot())
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    let release!: () => void
    const geometryDone = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = automationHost(store.port, {
      geometry: {
        evaluate: async (snapshot) => {
          markEntered()
          await geometryDone
          return evidence(snapshot)
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    const preview = host.previewDraft(actor, operationRequest())
    await entered
    const concurrent = applyDocumentCommand(
      createdSnapshot(),
      command(
        "org.vibeshape.document.rename",
        1,
        "Concurrent preview change",
        "0195b5ac-b227-7a2c-8c33-67a36a7f21ac",
      ),
    )
    if (!concurrent.ok) throw new Error(concurrent.diagnostic.message)
    store.replace(concurrent.snapshot)
    release()
    expect(await preview).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
  })

  it("keeps the operation queue usable after geometry evaluation throws", async () => {
    const store = documentStore(createdSnapshot())
    let shouldThrow = true
    const host = automationHost(store.port, {
      geometry: {
        evaluate: (snapshot) => {
          if (shouldThrow) throw new Error("kernel unavailable")
          return evidence(snapshot)
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    const failed = await host.previewDraft(actor, operationRequest())
    expect(failed).toMatchObject({ ok: false, diagnostic: { code: "automation-operation-failed" } })
    shouldThrow = false
    expect(await host.previewDraft(actor, operationRequest())).toMatchObject({ ok: true })
  })

  it("retains the parsed command intent and actor after the caller mutates input", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port)
    await host.createDraft(actor, createRequest(1))
    const original = command(
      "org.vibeshape.document.rename",
      1,
      "Original intent",
      "0195b5ac-b225-7a2c-8c33-67a36a7f21ac",
    )
    const input = { ...original, actor: { ...original.actor }, payload: { ...original.payload } }
    await host.applyCommand(actor, applyRequest(input))
    input.payload.name = "Mutated intent"
    if (input.actor.type === "mcp") input.actor.clientId = "org.example.mutated-client"

    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({ ok: true })
    expect(store.snapshot()).toMatchObject({ name: "Original intent" })
    expect(store.lastCommit()?.actor).toEqual(actor)
    expect(store.receivedCommands()[0]).toMatchObject({
      commandId: "0195b5ac-b225-7a2c-8c33-67a36a7f21ac",
      actor,
      payload: { name: "Original intent" },
    })
  })

  it.each(["rejected", "cancelled", "unexpected"] as const)(
    "does not write when review returns %s",
    async (decision) => {
      const store = documentStore(createdSnapshot())
      const host = automationHost(store.port, {
        review: { confirm: () => (decision === "unexpected" ? "later" : decision) },
      })
      await host.createDraft(actor, createRequest(1))
      await host.applyCommand(
        actor,
        applyRequest(
          command(
            "org.vibeshape.document.rename",
            1,
            "Reviewed",
            "0195b5ac-b228-7a2c-8c33-67a36a7f21ac",
          ),
        ),
      )

      expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
        ok: false,
        diagnostic: {
          code:
            decision === "rejected"
              ? "draft-review-rejected"
              : decision === "cancelled"
                ? "draft-review-cancelled"
                : "invalid-review-result",
        },
      })
      expect(store.portCalls()).toBe(0)
    },
  )

  it("rechecks the base revision after asynchronous review", async () => {
    const store = documentStore(createdSnapshot())
    let entered!: () => void
    const reviewEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const reviewDone = new Promise<string>((resolve) => {
      release = () => resolve("approved")
    })
    const host = automationHost(store.port, {
      review: {
        confirm: async () => {
          entered()
          return reviewDone
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Pending review",
          "0195b5ac-b229-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    const commit = host.commitDraft(actor, operationRequest())
    await reviewEntered
    const concurrent = applyDocumentCommand(
      createdSnapshot(),
      command(
        "org.vibeshape.document.rename",
        1,
        "Concurrent change",
        "0195b5ac-b230-7a2c-8c33-67a36a7f21ac",
      ),
    )
    if (!concurrent.ok) throw new Error(concurrent.diagnostic.message)
    store.replace(concurrent.snapshot)
    release()
    expect(await commit).toMatchObject({ ok: false, diagnostic: { code: "stale-revision" } })
    expect(store.portCalls()).toBe(0)
  })

  it("rejects expiry that occurs while review is pending", async () => {
    const store = documentStore(createdSnapshot())
    let now = startedAt
    let enterReview!: () => void
    const reviewEntered = new Promise<void>((resolve) => {
      enterReview = resolve
    })
    let approve!: () => void
    const reviewDone = new Promise<string>((resolve) => {
      approve = () => resolve("approved")
    })
    const host = automationHost(store.port, {
      now: () => now,
      draftTtlMs: 1_000,
      review: {
        confirm: async () => {
          enterReview()
          return reviewDone
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Pending expiry",
          "0195b5ac-b232-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    const commit = host.commitDraft(actor, operationRequest())
    await reviewEntered
    now += 1_001
    approve()
    expect(await commit).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
    expect(store.portCalls()).toBe(0)
  })

  it("requires a fresh review after a rejected draft changes", async () => {
    const store = documentStore(createdSnapshot())
    const reviews: DraftReviewInput[] = []
    const decisions = ["rejected", "approved"] as const
    const host = automationHost(store.port, {
      review: {
        confirm: (input) => {
          reviews.push(input)
          return decisions[reviews.length - 1] ?? "cancelled"
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "First draft revision",
          "0195b5ac-b233-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-rejected" },
    })
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          2,
          "Second draft revision",
          "0195b5ac-b234-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({ ok: true })
    expect(store.portCalls()).toBe(1)
    expect(reviews).toHaveLength(2)
    expect(reviews[0]?.preview.draft.revision).toBe(2)
    expect(reviews[1]?.preview.draft.revision).toBe(3)
    expect(reviews[0]?.commands).toHaveLength(1)
    expect(reviews[1]?.commands).toHaveLength(2)
  })

  it("reviews once with the exact valid preview and retained commands", async () => {
    const store = documentStore(createdSnapshot())
    const reviews: DraftReviewInput[] = []
    const host = automationHost(store.port, {
      review: {
        confirm: (input) => {
          reviews.push(input)
          return "approved"
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    const authored = command(
      "org.vibeshape.document.rename",
      1,
      "Exact review",
      "0195b5ac-b235-7a2c-8c33-67a36a7f21ac",
    )
    await host.applyCommand(actor, applyRequest(authored))
    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({ ok: true })
    expect(store.portCalls()).toBe(1)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({
      actor,
      preview: {
        schemaVersion: 2,
        draft: { documentId, baseRevision: 1, revision: 2, commandCount: 1 },
        summary: { documentId, revision: 2, data: { name: "Exact review" } },
        geometry: { status: "valid" },
      },
      commands: [
        { commandId: authored.commandId, baseRevision: 1, payload: { name: "Exact review" } },
      ],
    })
  })

  it("fails closed when review throws before persistence", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port, {
      review: { confirm: () => Promise.reject(new Error("review unavailable")) },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Review failure",
          "0195b5ac-b236-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )
    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-review-result" },
    })
    expect(store.portCalls()).toBe(0)
  })

  it("isolates reviewer mutations from the retained commit intent", async () => {
    const store = documentStore(createdSnapshot())
    const host = automationHost(store.port, {
      review: {
        confirm: (input) => {
          const reviewed = input.commands[0]
          if (reviewed?.kind !== "org.vibeshape.document.rename") throw new Error("wrong command")
          reviewed.payload.name = "Reviewer mutation"
          return "approved"
        },
      },
    })
    await host.createDraft(actor, createRequest(1))
    await host.applyCommand(
      actor,
      applyRequest(
        command(
          "org.vibeshape.document.rename",
          1,
          "Original intent",
          "0195b5ac-b231-7a2c-8c33-67a36a7f21ac",
        ),
      ),
    )

    expect(await host.commitDraft(actor, operationRequest())).toMatchObject({ ok: true })
    expect(store.snapshot()).toMatchObject({ name: "Original intent" })
  })
})
