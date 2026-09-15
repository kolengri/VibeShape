import {
  automationDraftInspectionRequestSchema,
  automationDraftInspectionViewSchema,
} from "@vibeshape/automation-api/draft-inspection"
import {
  type AutomationCommandEnvelope,
  type AutomationDraftCommitView,
  type AutomationDraftDiscardView,
  type AutomationDraftPreview,
  type AutomationDraftState,
  applyAutomationDraftCommandRequestSchema,
  automationDraftCommitViewSchema,
  automationDraftDiscardViewSchema,
  automationDraftOperationRequestSchema,
  automationDraftPreviewSchema,
  automationDraftStateSchema,
  createAutomationDraftRequestSchema,
} from "@vibeshape/automation-api/drafts"
import type {
  QueryDiagnosticCode,
  QueryDispatcher,
  QueryIssue,
} from "@vibeshape/automation-api/queries"
import type {
  CommandDispatcher,
  CommandDispatcherDiagnosticCode,
} from "@vibeshape/domain/command-dispatcher"
import {
  type CommandActor,
  commandActorSchema,
  commandActorsEqual,
  type DocumentCommand,
  parseDocumentCommand,
} from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  createDocumentDraft,
  type DocumentDraft,
  type DraftCommitResult,
  type DraftDiagnosticCode,
} from "@vibeshape/domain/drafts"
import { type DocumentId, type DraftId, draftIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import { type DraftEdgeCache, inspectDraftQuery } from "./draft-inspection"
import type { DraftReviewInput, DraftReviewPort } from "./draft-review"
import { type DraftGeometryPort, evaluateDraftGeometry } from "./exact-draft-preview"

export type { DraftReviewDecision, DraftReviewInput, DraftReviewPort } from "./draft-review"
export type { DraftGeometryPort } from "./exact-draft-preview"

const draftReviewDecisionSchema = z.enum(["approved", "rejected", "cancelled"])

const hostOptionsSchema = z
  .object({
    draftTtlMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000)
      .safe()
      .default(5 * 60 * 1_000),
    maxDraftsPerActor: z.number().int().positive().max(64).safe().default(4),
    maxCommandsPerDraft: z.number().int().positive().max(1_024).safe().default(64),
  })
  .strict()

type Awaitable<Value> = Value | PromiseLike<Value>

export type AutomationDocumentPort = Readonly<{
  readSnapshot: (documentId: DocumentId) => Awaitable<unknown>
  compareAndCommitDraft: (
    draft: DocumentDraft,
    commands: readonly DocumentCommand[],
  ) => Awaitable<DraftCommitResult | Extract<AutomationHostResult<never>, { ok: false }>>
}>

export type AutomationHostConfiguration = Readonly<{
  commandDispatcher: CommandDispatcher
  queryDispatcher: QueryDispatcher
  documents: AutomationDocumentPort
  geometry: DraftGeometryPort
  review: DraftReviewPort
  createDraftId: () => unknown
  now?: () => number
  draftTtlMs?: number
  maxDraftsPerActor?: number
  maxCommandsPerDraft?: number
}>

export type AutomationHostDiagnosticCode =
  | CommandDispatcherDiagnosticCode
  | DraftDiagnosticCode
  | QueryDiagnosticCode
  | "document-write-unavailable"
  | "document-commit-failed"
  | "draft-commit-intent-mismatch"
  | "draft-geometry-invalid"
  | "draft-review-rejected"
  | "draft-review-cancelled"
  | "invalid-review-result"
  | "invalid-host-configuration"
  | "invalid-automation-actor"
  | "invalid-draft-request"
  | "invalid-generated-draft-id"
  | "invalid-host-clock"
  | "invalid-document-snapshot"
  | "invalid-command-handler-result"
  | "invalid-commit-port-result"
  | "draft-not-found"
  | "draft-expired"
  | "draft-owner-mismatch"
  | "draft-id-collision"
  | "draft-limit-reached"
  | "draft-command-limit-reached"
  | "duplicate-command-id"
  | "automation-operation-failed"

export type AutomationHostDiagnostic = Readonly<{
  code: AutomationHostDiagnosticCode
  message: string
  retryable: boolean
  issues: readonly QueryIssue[]
}>

export type AutomationHostResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; diagnostic: AutomationHostDiagnostic }

export type AutomationHost = Readonly<{
  createDraft: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<AutomationDraftState>>
  applyCommand: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<AutomationDraftState>>
  previewDraft: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<AutomationDraftPreview>>
  commitDraft: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<AutomationDraftCommitView>>
  discardDraft: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<AutomationDraftDiscardView>>
  inspectDraft: (
    actor: unknown,
    input: unknown,
  ) => Promise<AutomationHostResult<ReturnType<typeof automationDraftInspectionViewSchema.parse>>>
}>

export type AutomationHostFactoryResult =
  | { ok: true; host: AutomationHost }
  | { ok: false; diagnostic: AutomationHostDiagnostic }

type ManagedDraft = Readonly<{
  commands: readonly DocumentCommand[]
  draft: DocumentDraft
  expiresAt: number
}>

type OperationContext<Request> = Readonly<{
  actor: CommandActor
  request: Request
  at: number
}>

function detachedReviewCommands(
  record: ManagedDraft,
): AutomationHostResult<readonly DocumentCommand[]> {
  const commands: DocumentCommand[] = []
  for (const command of record.commands) {
    const detached = parseDocumentCommand(command)
    if (!detached.ok)
      return failure(
        hostDiagnostic(
          "invalid-review-result",
          "The automation host could not prepare the draft review input.",
        ),
      )
    commands.push(detached.command)
  }
  return { ok: true, value: commands }
}

function reviewDecisionDiagnostic(decisionInput: unknown): AutomationHostDiagnostic | null {
  const decision = draftReviewDecisionSchema.safeParse(decisionInput)
  if (!decision.success)
    return hostDiagnostic("invalid-review-result", "The draft review returned an invalid decision.")
  if (decision.data === "rejected")
    return hostDiagnostic("draft-review-rejected", "The draft review rejected this commit.")
  if (decision.data === "cancelled")
    return hostDiagnostic("draft-review-cancelled", "The draft review was cancelled.")
  return null
}

function hostDiagnostic(
  code: AutomationHostDiagnosticCode,
  message: string,
  retryable = false,
  issues: readonly QueryIssue[] = [],
): AutomationHostDiagnostic {
  return { code, message, retryable, issues }
}

function zodIssues(error: z.ZodError): readonly QueryIssue[] {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }))
}

function failure<Value>(diagnostic: AutomationHostDiagnostic): AutomationHostResult<Value> {
  return { ok: false, diagnostic }
}

function parseActor(actor: unknown): AutomationHostResult<CommandActor> {
  const parsed = commandActorSchema.safeParse(actor)

  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure(
        hostDiagnostic(
          "invalid-automation-actor",
          "The authenticated automation actor is invalid.",
          false,
          zodIssues(parsed.error),
        ),
      )
}

function invalidRequest<Value>(error: z.ZodError): AutomationHostResult<Value> {
  return failure(
    hostDiagnostic(
      "invalid-draft-request",
      "The automation draft request is invalid.",
      false,
      zodIssues(error),
    ),
  )
}

function createDraftState(record: ManagedDraft): AutomationDraftState {
  return automationDraftStateSchema.parse({
    schemaVersion: 1,
    draftId: record.draft.id,
    documentId: record.draft.documentId,
    baseRevision: record.draft.baseRevision,
    revision: record.draft.snapshot?.revision ?? 0,
    commandCount: record.draft.events.length,
    expiresAt: new Date(record.expiresAt).toISOString(),
  })
}

function validateCommandHandlerResult(
  draft: DocumentDraft,
  snapshot: DocumentSnapshot,
  event: DocumentDraft["events"][number],
  commandId: string,
  baseRevision: number,
) {
  return (
    event.transactionId === draft.id &&
    event.commandId === commandId &&
    event.documentId === draft.documentId &&
    event.baseRevision === baseRevision &&
    commandActorsEqual(event.actor, draft.actor) &&
    snapshot.id === draft.documentId &&
    snapshot.revision === event.revision
  )
}

function validateCommitPortResult(draft: DocumentDraft, result: DraftCommitResult) {
  if (!result.ok) {
    return false
  }

  const invariants = [
    result.commit.transactionId === draft.id,
    result.commit.documentId === draft.documentId,
    result.commit.baseRevision === draft.baseRevision,
    result.commit.revision === draft.snapshot?.revision,
    result.commit.snapshot.id === draft.documentId,
    result.commit.snapshot.revision === result.commit.revision,
    result.commit.events.length === draft.events.length,
    result.commit.commandIds.length === draft.events.length,
    result.commit.commandIds.every(
      (commandId, index) => commandId === draft.events[index]?.commandId,
    ),
    commandActorsEqual(result.commit.actor, draft.actor),
  ]

  return invariants.every(Boolean)
}

export function createAutomationHost(
  configuration: AutomationHostConfiguration,
): AutomationHostFactoryResult {
  const parsedOptions = hostOptionsSchema.safeParse({
    draftTtlMs: configuration.draftTtlMs,
    maxDraftsPerActor: configuration.maxDraftsPerActor,
    maxCommandsPerDraft: configuration.maxCommandsPerDraft,
  })

  if (!parsedOptions.success) {
    return {
      ok: false,
      diagnostic: hostDiagnostic(
        "invalid-host-configuration",
        "The automation host configuration is invalid.",
        false,
        zodIssues(parsedOptions.error),
      ),
    }
  }

  if (!configuration.review || typeof configuration.review.confirm !== "function") {
    return {
      ok: false,
      diagnostic: hostDiagnostic(
        "invalid-host-configuration",
        "The automation host review port is invalid.",
      ),
    }
  }

  const options = parsedOptions.data
  const drafts = new Map<DraftId, ManagedDraft>()
  const now = configuration.now ?? Date.now
  const clockValueSchema = z
    .number()
    .int()
    .nonnegative()
    .max(8_640_000_000_000_000 - options.draftTtlMs)
  let operationQueue: Promise<void> = Promise.resolve()
  let edgeCache: DraftEdgeCache | null = null

  function enqueue<Value>(
    operation: () => Promise<AutomationHostResult<Value>>,
  ): Promise<AutomationHostResult<Value>> {
    const guardedOperation = async () => {
      try {
        return await operation()
      } catch {
        return failure<Value>(
          hostDiagnostic(
            "automation-operation-failed",
            "The automation host could not complete the operation.",
            true,
          ),
        )
      }
    }
    const result = operationQueue.then(guardedOperation, guardedOperation)
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function invalidateDraftEdges(draftId: DraftId) {
    if (edgeCache?.draftId === draftId) edgeCache = null
  }

  function forgetDraft(draftId: DraftId) {
    drafts.delete(draftId)
    invalidateDraftEdges(draftId)
  }

  function purgeExpired(at: number) {
    for (const [draftId, record] of drafts) {
      if (record.expiresAt <= at) {
        forgetDraft(draftId)
      }
    }
  }

  function currentTime(): AutomationHostResult<number> {
    const parsed = clockValueSchema.safeParse(now())

    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure(
          hostDiagnostic(
            "invalid-host-clock",
            "The automation host clock returned an invalid timestamp.",
            false,
            zodIssues(parsed.error),
          ),
        )
  }

  function parseOperation<Schema extends z.ZodType>(
    actorInput: unknown,
    input: unknown,
    schema: Schema,
  ): AutomationHostResult<OperationContext<z.output<Schema>>> {
    const actor = parseActor(actorInput)

    if (!actor.ok) {
      return actor
    }

    const request = schema.safeParse(input)

    if (!request.success) {
      return invalidRequest(request.error)
    }

    const time = currentTime()

    return time.ok
      ? { ok: true, value: { actor: actor.value, request: request.data, at: time.value } }
      : time
  }

  function activeDraftCount(actor: CommandActor) {
    let count = 0

    for (const record of drafts.values()) {
      if (commandActorsEqual(record.draft.actor, actor)) {
        count += 1
      }
    }

    return count
  }

  function requireDraftCapacity(actor: CommandActor): AutomationHostResult<null> {
    return activeDraftCount(actor) < options.maxDraftsPerActor
      ? { ok: true, value: null }
      : failure(
          hostDiagnostic(
            "draft-limit-reached",
            "The automation actor has reached the active draft limit.",
            true,
          ),
        )
  }

  function generateDraftId(): AutomationHostResult<DraftId> {
    const parsed = draftIdSchema.safeParse(configuration.createDraftId())

    if (!parsed.success) {
      return failure(
        hostDiagnostic(
          "invalid-generated-draft-id",
          "The automation host generated an invalid draft identifier.",
          false,
          zodIssues(parsed.error),
        ),
      )
    }

    return drafts.has(parsed.data)
      ? failure(
          hostDiagnostic("draft-id-collision", "The generated draft identifier is already active."),
        )
      : { ok: true, value: parsed.data }
  }

  async function readDraftBase(
    documentId: DocumentId,
    baseRevision: number,
  ): Promise<AutomationHostResult<DocumentSnapshot | null>> {
    const parsed = documentSnapshotSchema
      .nullable()
      .safeParse(await configuration.documents.readSnapshot(documentId))

    if (!parsed.success) {
      return failure(
        hostDiagnostic(
          "invalid-document-snapshot",
          "The document port returned an invalid snapshot.",
          false,
          zodIssues(parsed.error),
        ),
      )
    }
    if (!parsed.data && baseRevision !== 0) {
      return failure(hostDiagnostic("document-not-found", "The requested document was not found."))
    }
    if (parsed.data && parsed.data.id !== documentId) {
      return failure(
        hostDiagnostic("document-id-mismatch", "The document port returned another document."),
      )
    }
    return (parsed.data?.revision ?? 0) === baseRevision
      ? { ok: true, value: parsed.data }
      : failure(
          hostDiagnostic(
            "stale-revision",
            "The requested base revision is no longer current.",
            true,
          ),
        )
  }

  function ownedDraft(
    actor: CommandActor,
    draftId: DraftId,
    at: number,
  ): AutomationHostResult<ManagedDraft> {
    const record = drafts.get(draftId)

    if (!record) {
      return failure(hostDiagnostic("draft-not-found", "The automation draft was not found."))
    }

    if (record.expiresAt <= at) {
      forgetDraft(draftId)
      return failure(hostDiagnostic("draft-expired", "The automation draft has expired."))
    }

    return commandActorsEqual(record.draft.actor, actor)
      ? { ok: true, value: record }
      : failure(
          hostDiagnostic("draft-owner-mismatch", "The automation actor does not own this draft."),
        )
  }

  function renew(record: ManagedDraft, at: number): ManagedDraft {
    return { ...record, expiresAt: at + options.draftTtlMs }
  }

  function validateDraftCommand(
    actor: CommandActor,
    record: ManagedDraft,
    command: AutomationCommandEnvelope,
  ): AutomationHostResult<null> {
    if (command.documentId !== record.draft.documentId) {
      return failure(
        hostDiagnostic("draft-document-mismatch", "The command targets another document."),
      )
    }
    if (!commandActorsEqual(command.actor, actor)) {
      return failure(
        hostDiagnostic("draft-actor-mismatch", "The command actor does not own this draft."),
      )
    }
    if (record.draft.events.some((event) => event.commandId === command.commandId)) {
      return failure(
        hostDiagnostic("duplicate-command-id", "The command identifier is already in this draft."),
      )
    }
    if ((record.draft.snapshot?.revision ?? 0) !== command.baseRevision) {
      return failure(
        hostDiagnostic("stale-revision", "The command does not extend the draft revision.", true),
      )
    }
    return record.draft.events.length < options.maxCommandsPerDraft
      ? { ok: true, value: null }
      : failure(
          hostDiagnostic(
            "draft-command-limit-reached",
            "The automation draft has reached its command limit.",
          ),
        )
  }

  function dispatchDraftCommand(
    record: ManagedDraft,
    command: AutomationCommandEnvelope,
  ): AutomationHostResult<DocumentDraft> {
    const dispatched = configuration.commandDispatcher.dispatch(record.draft.snapshot, command, {
      transactionId: record.draft.id,
    })

    if (!dispatched.ok) {
      return failure(dispatched.diagnostic)
    }
    if (
      !validateCommandHandlerResult(
        record.draft,
        dispatched.snapshot,
        dispatched.event,
        command.commandId,
        command.baseRevision,
      )
    ) {
      return failure(
        hostDiagnostic(
          "invalid-command-handler-result",
          "The trusted command handler returned a result outside the draft boundary.",
        ),
      )
    }

    return {
      ok: true,
      value: {
        ...record.draft,
        snapshot: dispatched.snapshot,
        events: [...record.draft.events, dispatched.event],
      },
    }
  }

  async function createDraft(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<AutomationDraftState>> {
    const operation = parseOperation(actorInput, input, createAutomationDraftRequestSchema)

    if (!operation.ok) {
      return operation
    }

    purgeExpired(operation.value.at)

    const capacity = requireDraftCapacity(operation.value.actor)

    if (!capacity.ok) {
      return capacity
    }

    const draftId = generateDraftId()

    if (!draftId.ok) {
      return draftId
    }

    const snapshot = await readDraftBase(
      operation.value.request.documentId,
      operation.value.request.baseRevision,
    )

    if (!snapshot.ok) {
      return snapshot
    }

    const created = createDocumentDraft({
      draftId: draftId.value,
      documentId: operation.value.request.documentId,
      actor: operation.value.actor,
      snapshot: snapshot.value,
    })

    if (!created.ok) {
      return failure(created.diagnostic)
    }

    const record: ManagedDraft = {
      draft: created.draft,
      commands: [],
      expiresAt: operation.value.at + options.draftTtlMs,
    }
    drafts.set(created.draft.id, record)
    return { ok: true, value: createDraftState(record) }
  }

  async function applyCommand(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<AutomationDraftState>> {
    const operation = parseOperation(actorInput, input, applyAutomationDraftCommandRequestSchema)

    if (!operation.ok) {
      return operation
    }

    const owned = ownedDraft(
      operation.value.actor,
      operation.value.request.draftId,
      operation.value.at,
    )

    if (!owned.ok) {
      return owned
    }
    const policy = validateDraftCommand(
      operation.value.actor,
      owned.value,
      operation.value.request.command,
    )

    if (!policy.ok) {
      return policy
    }

    const dispatched = dispatchDraftCommand(owned.value, operation.value.request.command)

    if (!dispatched.ok) {
      return dispatched
    }

    const command = parseDocumentCommand(operation.value.request.command)
    if (!command.ok) return failure(command.diagnostic)

    const record = renew(
      {
        draft: dispatched.value,
        commands: [...owned.value.commands, command.command],
        expiresAt: owned.value.expiresAt,
      },
      operation.value.at,
    )
    drafts.set(record.draft.id, record)
    invalidateDraftEdges(record.draft.id)
    return { ok: true, value: createDraftState(record) }
  }

  async function revalidateAfterGeometry(
    record: ManagedDraft,
  ): Promise<AutomationHostResult<number>> {
    const base = await readDraftBase(record.draft.documentId, record.draft.baseRevision)
    if (!base.ok) {
      invalidateDraftEdges(record.draft.id)
      return base
    }
    const time = currentTime()
    if (!time.ok) return time
    const current = ownedDraft(record.draft.actor, record.draft.id, time.value)
    return current.ok ? { ok: true, value: time.value } : current
  }

  function ownedOperation(actorInput: unknown, input: unknown): AutomationHostResult<ManagedDraft> {
    const operation = parseOperation(actorInput, input, automationDraftOperationRequestSchema)
    if (!operation.ok) return operation
    return ownedDraft(operation.value.actor, operation.value.request.draftId, operation.value.at)
  }

  async function currentDraftGeometry(
    record: ManagedDraft,
  ): Promise<AutomationHostResult<{ geometry: AutomationDraftPreview["geometry"]; at: number }>> {
    if (!record.draft.snapshot)
      return failure(hostDiagnostic("draft-empty", "The draft has no document to preview."))
    const base = await readDraftBase(record.draft.documentId, record.draft.baseRevision)
    if (!base.ok) return base
    const exact = await evaluateDraftGeometry(
      record.draft.snapshot,
      configuration.geometry,
      configuration.queryDispatcher,
    )
    if (!exact.ok) return failure(exact.diagnostic)
    const refreshed = await revalidateAfterGeometry(record)
    if (!refreshed.ok) return refreshed
    return { ok: true as const, value: { geometry: exact.geometry, at: refreshed.value } }
  }

  async function inspectDraft(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<ReturnType<typeof automationDraftInspectionViewSchema.parse>>> {
    const operation = parseOperation(actorInput, input, automationDraftInspectionRequestSchema)
    if (!operation.ok) return operation
    const owned = ownedDraft(
      operation.value.actor,
      operation.value.request.draftId,
      operation.value.at,
    )
    if (!owned.ok) return owned
    const snapshot = owned.value.draft.snapshot
    if (!snapshot)
      return failure(hostDiagnostic("draft-empty", "The draft has no document to inspect."))
    if (
      operation.value.request.query.documentId !== snapshot.id ||
      operation.value.request.query.revision !== snapshot.revision
    )
      return failure(
        hostDiagnostic(
          "stale-query-revision",
          "The draft query does not match the draft revision.",
          true,
        ),
      )
    const current = await revalidateAfterGeometry(owned.value)
    if (!current.ok) return current
    const inspected = await inspectDraftQuery(
      operation.value.request,
      snapshot,
      owned.value.draft.id,
      configuration.geometry,
      configuration.queryDispatcher,
      edgeCache,
    )
    if (!inspected.ok) return failure(inspected.diagnostic)
    const refreshed = await revalidateAfterGeometry(owned.value)
    if (!refreshed.ok) return refreshed
    edgeCache = inspected.cache
    return {
      ok: true,
      value: automationDraftInspectionViewSchema.parse({
        schemaVersion: 1,
        draft: createDraftState(owned.value),
        view: inspected.view,
      }),
    }
  }

  async function confirmDraft(
    record: ManagedDraft,
    geometry: AutomationDraftPreview["geometry"],
  ): Promise<AutomationHostResult<null>> {
    const snapshot = record.draft.snapshot
    if (!snapshot)
      return failure(hostDiagnostic("draft-empty", "The draft has no document to commit."))
    const queried = configuration.queryDispatcher.dispatch(snapshot, {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      documentId: record.draft.documentId,
      revision: snapshot.revision,
    })
    if (!queried.ok) return failure(queried.diagnostic)
    const preview = automationDraftPreviewSchema.parse({
      schemaVersion: 2,
      draft: createDraftState(record),
      summary: queried.view,
      geometry,
    })
    const reviewCommands = detachedReviewCommands(record)
    if (!reviewCommands.ok) return reviewCommands
    let reviewResult: unknown
    try {
      reviewResult = await configuration.review.confirm({
        actor: commandActorSchema.parse(record.draft.actor),
        preview,
        commands: reviewCommands.value,
      } satisfies DraftReviewInput)
    } catch {
      return failure(
        hostDiagnostic("invalid-review-result", "The draft review could not be completed."),
      )
    }
    const reviewDiagnostic = reviewDecisionDiagnostic(reviewResult)
    if (reviewDiagnostic) return failure(reviewDiagnostic)
    const refreshed = await revalidateAfterGeometry(record)
    return refreshed.ok ? { ok: true, value: null } : refreshed
  }

  async function previewDraft(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<AutomationDraftPreview>> {
    const owned = ownedOperation(actorInput, input)
    if (!owned.ok) return owned
    const exact = await currentDraftGeometry(owned.value)
    if (!exact.ok) return exact
    const snapshot = owned.value.draft.snapshot
    if (!snapshot)
      return failure(hostDiagnostic("draft-empty", "The draft has no document to preview."))

    const queried = configuration.queryDispatcher.dispatch(snapshot, {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      documentId: owned.value.draft.documentId,
      revision: snapshot.revision,
    })

    if (!queried.ok) {
      return failure(queried.diagnostic)
    }

    const record = renew(owned.value, exact.value.at)
    drafts.set(record.draft.id, record)
    return {
      ok: true,
      value: automationDraftPreviewSchema.parse({
        schemaVersion: 2,
        draft: createDraftState(record),
        summary: queried.view,
        geometry: exact.value.geometry,
      }),
    }
  }

  async function commitDraft(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<AutomationDraftCommitView>> {
    const owned = ownedOperation(actorInput, input)
    if (!owned.ok) return owned
    if (!owned.value.commands.length)
      return failure(hostDiagnostic("draft-empty", "The draft has no commands to commit."))
    const exact = await currentDraftGeometry(owned.value)
    if (!exact.ok) return exact
    if (exact.value.geometry.status !== "valid")
      return failure(
        hostDiagnostic(
          "draft-geometry-invalid",
          "The draft contains failed or blocked geometry and cannot be committed.",
        ),
      )

    const confirmed = await confirmDraft(owned.value, exact.value.geometry)
    if (!confirmed.ok) return confirmed
    const committed = await configuration.documents.compareAndCommitDraft(
      owned.value.draft,
      owned.value.commands,
    )

    if (!committed.ok) {
      return failure(committed.diagnostic)
    }
    if (!validateCommitPortResult(owned.value.draft, committed)) {
      return failure(
        hostDiagnostic(
          "invalid-commit-port-result",
          "The document port returned a commit outside the draft boundary.",
        ),
      )
    }

    forgetDraft(owned.value.draft.id)
    return {
      ok: true,
      value: automationDraftCommitViewSchema.parse({
        schemaVersion: 1,
        draftId: committed.commit.transactionId,
        documentId: committed.commit.documentId,
        baseRevision: committed.commit.baseRevision,
        revision: committed.commit.revision,
        commandCount: committed.commit.commandIds.length,
      }),
    }
  }

  async function discardDraft(
    actorInput: unknown,
    input: unknown,
  ): Promise<AutomationHostResult<AutomationDraftDiscardView>> {
    const operation = parseOperation(actorInput, input, automationDraftOperationRequestSchema)

    if (!operation.ok) {
      return operation
    }

    const record = drafts.get(operation.value.request.draftId)

    if (!record || record.expiresAt <= operation.value.at) {
      forgetDraft(operation.value.request.draftId)
      return {
        ok: true,
        value: automationDraftDiscardViewSchema.parse({
          schemaVersion: 1,
          draftId: operation.value.request.draftId,
          discarded: false,
        }),
      }
    }
    if (!commandActorsEqual(record.draft.actor, operation.value.actor)) {
      return failure(
        hostDiagnostic("draft-owner-mismatch", "The automation actor does not own this draft."),
      )
    }

    forgetDraft(record.draft.id)
    return {
      ok: true,
      value: automationDraftDiscardViewSchema.parse({
        schemaVersion: 1,
        draftId: record.draft.id,
        discarded: true,
      }),
    }
  }

  return {
    ok: true,
    host: {
      createDraft: (actor, input) => enqueue(() => createDraft(actor, input)),
      applyCommand: (actor, input) => enqueue(() => applyCommand(actor, input)),
      previewDraft: (actor, input) => enqueue(() => previewDraft(actor, input)),
      commitDraft: (actor, input) => enqueue(() => commitDraft(actor, input)),
      discardDraft: (actor, input) => enqueue(() => discardDraft(actor, input)),
      inspectDraft: (actor, input) => enqueue(() => inspectDraft(actor, input)),
    },
  }
}
