import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import {
  createCommandDispatcher,
  createCoreCommandHandlers,
} from "@vibeshape/domain/command-dispatcher"
import {
  applyDocumentCommand,
  type CommandActor,
  commandActorSchema,
} from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { commitDocumentDraft, type DocumentDraft, type DraftCommit } from "@vibeshape/domain/drafts"
import { createFeatureTypeRegistry } from "@vibeshape/domain/feature-type-registry"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignModule,
} from "@vibeshape/domain/modules"
import { boxFeatureType, partDesignFeatureTypeHandlers } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { type AutomationDocumentPort, createAutomationHost } from "./host"

export const recoveryTestId = (value: number) =>
  `0195b5ac-b220-7a2c-8c33-${value.toString(16).padStart(12, "0")}`
export function recoveryActor(value: number) {
  const actor = commandActorSchema.parse({
    type: "mcp",
    clientId: "org.example.recovery",
    sessionId: recoveryTestId(value),
  })
  if (actor.type !== "mcp") throw new Error("An MCP actor is required.")
  return actor
}
export function recoveryGeometry(snapshot: DocumentSnapshot) {
  return {
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 1,
    features: snapshot.features.map((feature) => ({
      featureId: feature.id,
      status: "succeeded",
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
    })),
  }
}
export function recoveryFixture() {
  const actor = recoveryActor(1)
  const created = applyDocumentCommand(null, {
    schemaVersion: 1,
    kind: "org.vibeshape.document.create",
    documentId: recoveryTestId(2),
    commandId: recoveryTestId(3),
    baseRevision: 0,
    issuedAt: "2026-10-20T00:00:00Z",
    actor,
    payload: { name: "Recovery fixture" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  let saved = created.snapshot
  let at = Date.now()
  let next = 100
  let gate: Promise<void> | null = null
  let rejectValidation = false
  let loseCommitReceipt = false
  const commits: DraftCommit[] = []
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  const commands = createCommandDispatcher(
    modules.registry,
    createCoreCommandHandlers(types.registry),
  )
  const queries = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!commands.ok || !queries.ok) throw new Error("Recovery dispatchers are required.")
  const commandDispatcher = commands.dispatcher
  const queryDispatcher = queries.dispatcher
  const documents: AutomationDocumentPort = {
    readSnapshot: () => saved,
    validateDraft: () =>
      rejectValidation
        ? {
            ok: false,
            diagnostic: {
              code: "draft-commit-preflight-failed",
              message: "Captured source assets are unavailable.",
              retryable: false,
              issues: [],
            },
          }
        : { ok: true, value: null },
    compareAndCommitDraft: async (draft: DocumentDraft) => {
      if (gate) await gate
      const result = commitDocumentDraft(saved, draft)
      if (result.ok) {
        saved = result.commit.snapshot
        commits.push(result.commit)
      }
      if (result.ok && loseCommitReceipt)
        return {
          ok: false,
          diagnostic: {
            code: "document-commit-failed",
            message: "The accepted persistence receipt was lost.",
            retryable: true,
            issues: [],
          },
        }
      return result
    },
  }
  const generate = () => recoveryTestId(next++)
  function host() {
    const result = createAutomationHost({
      commandDispatcher,
      queryDispatcher,
      documents,
      geometry: { evaluate: recoveryGeometry },
      review: { confirm: () => "approved" },
      createDraftId: generate,
      createCommandId: generate,
      validateRecoverySources: async () => {},
      now: () => at,
    })
    if (!result.ok) throw new Error(result.diagnostic.message)
    return result.host
  }
  async function stage(hosted = host(), owner: CommandActor = actor) {
    const draft = await hosted.createDraft(owner, {
      schemaVersion: 1,
      documentId: saved.id,
      baseRevision: saved.revision,
    })
    if (!draft.ok) throw new Error(draft.diagnostic.message)
    const command = {
      schemaVersion: 1 as const,
      kind: "org.vibeshape.feature.add" as const,
      commandId: generate(),
      documentId: saved.id,
      baseRevision: saved.revision,
      issuedAt: new Date(at).toISOString(),
      actor: owner,
      payload: {
        feature: {
          schemaVersion: 0 as const,
          id: featureIdSchema.parse(recoveryTestId(10)),
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(30),
            height: createLengthQuantity(40),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    }
    const applied = await hosted.applyCommand(owner, {
      schemaVersion: 1,
      draftId: draft.value.draftId,
      command,
    })
    if (!applied.ok) throw new Error(applied.diagnostic.message)
    return { host: hosted, draft: applied.value, command }
  }
  return {
    actor,
    documents,
    modules: modules.registry,
    commands: commandDispatcher,
    generate,
    host,
    stage,
    loseCommitReceipt: () => {
      loseCommitReceipt = true
    },
    commits,
    get saved() {
      return saved
    },
    now: () => at,
    advance: (milliseconds: number) => {
      at += milliseconds
    },
    holdCommit: (promise: Promise<void>) => {
      gate = promise
    },
    rejectSourceAssets: () => {
      rejectValidation = true
    },
  }
}
