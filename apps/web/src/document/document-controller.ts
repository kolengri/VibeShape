import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { createModelEdgeEvidence } from "@vibeshape/application/model-edges"
import {
  createModelBodyMeasurementEvidence,
  createModelMeasurementEvidence,
} from "@vibeshape/application/model-measurements"
import {
  createPersistentDocumentSession,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSession,
  type PersistentDocumentSessionDiagnostic,
  type PersistentDocumentSessionReport,
  type PersistentSketchSolveOptions,
  type PersistentSketchSolveResult,
} from "@vibeshape/application/persistent-document-session"
import { openVersionedDocumentSession } from "@vibeshape/application/versioned-document-session"
import { createVersionedPersistenceAdapter } from "@vibeshape/application/versioned-persistence-adapter"
import type {
  CadInspectionDetailQuery,
  CadInspectionListQuery,
  ModelBodyMeasurementQuery,
  ModelBodyTopologyQuery,
  ModelEdgeQuery,
  QueryResult,
  VariableListQuery,
} from "@vibeshape/automation-api/queries"
import {
  createQueryDispatcher,
  documentCoreQueryHandlers,
  documentSummaryViewSchema,
  modelMeasurementQuerySchema,
  modelMeasurementViewSchema,
} from "@vibeshape/automation-api/queries"
import type { AutomationDocumentPort, AutomationHostResult } from "@vibeshape/automation-host/host"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  createCommandDispatcher,
  createCoreCommandHandlers,
  createFeatureTypeRegistry,
  createModuleRegistry,
  type DocumentDisplayUnits,
  type DocumentSnapshot,
  documentCoreModule,
  documentIdSchema,
  draftIdSchema,
  evaluateVariableDefinitions,
  type FeatureRecord,
  featureCoreModule,
  featureIdSchema,
  generateUuidV7,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  referenceGeometryFeatureTypeHandlers,
  referenceGeometryModule,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchId,
  type SketchRecord,
  sessionIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  type VariableDefinition,
  type VariableId,
  variableIdSchema,
} from "@vibeshape/domain"
import type { DocumentCommand } from "@vibeshape/domain/commands"
import type { DocumentDraft, DraftCommitResult } from "@vibeshape/domain/drafts"
import { readVersionedVShape, writeVShapeV2 } from "@vibeshape/formats/vshape"
import {
  acquireDocumentLease,
  type LocalProjectSummary,
  releaseDocumentLease,
  VibeShapeDatabase,
} from "@vibeshape/persistence"
import type { GeometryExportFormat } from "@vibeshape/protocol"
import { isString } from "is-what"
import { useEffect, useSyncExternalStore } from "react"
import { createDocumentAutomationSession } from "../automation/document-automation-session"
import { BrowserProjectRepository } from "./browser-project-repository"
import { PRODUCT_MESH_POLICY } from "./document-worker-settings"
import { copyPortableProjectV2, portableProjectV2FromArchive } from "./versioned-project-file"

const DATABASE_NAME = "vibeshape-product-v0"
const DOCUMENT_STORAGE_KEY = "vibeshape-active-document-id"
const SESSION_STORAGE_KEY = "vibeshape-browser-session-id"
type ControllerStatus = "idle" | "loading" | "ready" | "error"
type SaveStatus = "saved" | "saving" | "save-error"

export type DocumentControllerState = Readonly<{
  status: ControllerStatus
  report: PersistentDocumentSessionReport | null
  saveStatus: SaveStatus
  diagnostic: PersistentDocumentSessionDiagnostic | null
  history?: Readonly<{ canUndo: boolean; canRedo: boolean }>
}>

export type ApplyVariableTableResult =
  | { ok: true }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type DocumentMutationResult = ApplyVariableTableResult
export type FeatureMutationResult = ApplyVariableTableResult
type SketchMutationResult = ApplyVariableTableResult
export type ActiveSketchSolveResult = PersistentSketchSolveResult
export type ActiveSketchSolveOptions = PersistentSketchSolveOptions

export type ActiveDocumentExportResult =
  | {
      ok: true
      format: GeometryExportFormat
      file: Uint8Array
      bodyCount: number
      documentName: string
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type ActiveAutomationInfo = Readonly<{
  summary: ReturnType<typeof documentSummaryViewSchema.parse>
  measurements: ReturnType<typeof modelMeasurementViewSchema.parse> | null
  measurementDiagnostic: { code: string; message: string; retryable: boolean } | null
}>

export type ActiveProjectBackupResult =
  | { ok: true; file: Uint8Array; documentName: string }
  | { ok: false; diagnostic: { code: string; message: string } }

export type ProjectImportResult =
  | { ok: true; documentId: ReturnType<typeof documentIdSchema.parse> }
  | { ok: false; diagnostic: { code: string; message: string } }

export type LocalProjectListResult =
  | { ok: true; projects: readonly LocalProjectSummary[] }
  | { ok: false; diagnostic: { code: string; message: string } }

export type ProjectSwitchResult =
  | { ok: true }
  | { ok: false; diagnostic: { code: string; message: string } }

export type ProjectDeleteResult = ProjectSwitchResult
export type ProjectThumbnailWriteResult = ProjectSwitchResult

export type ProjectDuplicateResult =
  | {
      ok: true
      documentId: ReturnType<typeof documentIdSchema.parse>
      name: string
    }
  | { ok: false; diagnostic: { code: string; message: string } }

let state: DocumentControllerState = {
  status: "idle",
  report: null,
  saveStatus: "saved",
  diagnostic: null,
}
let session: PersistentDocumentSession | null = null
let activeRepository: BrowserProjectRepository | null = null
let startPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: DocumentControllerState) {
  state = { ...next, history: session?.history ?? { canUndo: false, canRedo: false } }
  for (const listener of listeners) listener()
}

function browserUuidV7() {
  return generateUuidV7({
    timestampMs: Date.now(),
    randomBytes: crypto.getRandomValues(new Uint8Array(10)),
  })
}

function readStoredId(storage: Storage, key: string) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredId(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
    return storage.getItem(key) === value
  } catch {
    // IndexedDB remains authoritative when browser key-value storage is unavailable.
    return false
  }
}

function removeStoredId(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null
  } catch {
    // IndexedDB remains authoritative when browser key-value storage is unavailable.
    return false
  }
}

function coreCommandDispatcher() {
  const { featureTypes, modules } = coreRegistries()
  const dispatcher = createCommandDispatcher(modules, createCoreCommandHandlers(featureTypes))
  if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
  return dispatcher.dispatcher
}

function coreRegistries() {
  const modules = createModuleRegistry([
    documentCoreModule,
    featureCoreModule,
    partDesignModule,
    referenceGeometryModule,
  ])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, [
    ...partDesignFeatureTypeHandlers,
    ...referenceGeometryFeatureTypeHandlers,
  ])
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  return { featureTypes: featureTypes.registry, modules: modules.registry }
}

export function resolveDocumentFeatureParameters(document: DocumentSnapshot) {
  const variables = evaluateVariableDefinitions(document.variables)
  if (!variables.ok) return document.features
  const { featureTypes } = coreRegistries()
  return document.features.map((feature) => {
    const resolved = featureTypes.resolveFeatureParameters(feature, variables.valuesByName)
    return resolved.ok ? resolved.feature : feature
  })
}

function dependencies(database: VibeShapeDatabase, repository: PersistentDocumentRepositoryPort) {
  return {
    commandDispatcher: coreCommandDispatcher(),
    repository,
    leases: {
      acquire: (input: Parameters<typeof acquireDocumentLease>[1]) =>
        acquireDocumentLease(database, input),
      release: (input: Parameters<typeof releaseDocumentLease>[1]) =>
        releaseDocumentLease(database, input),
    },
    createRebuildPort: (documentId: ReturnType<typeof documentIdSchema.parse>) =>
      createDocumentWorkerSession(documentId),
    now: () => Date.now(),
  }
}

function currentSessionId() {
  const stored = sessionIdSchema.safeParse(readStoredId(sessionStorage, SESSION_STORAGE_KEY))
  if (stored.success) return stored.data
  const created = sessionIdSchema.parse(browserUuidV7())
  writeStoredId(sessionStorage, SESSION_STORAGE_KEY, created)
  return created
}

function createCommand(documentId: ReturnType<typeof documentIdSchema.parse>, name: string) {
  return {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision: 0,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { name },
  } as const
}

async function openOrCreate(defaultDocumentName: string) {
  const database = new VibeShapeDatabase(DATABASE_NAME)
  const repository = new BrowserProjectRepository(database)
  activeRepository = repository
  const versionedAdapter = createVersionedPersistenceAdapter(repository.versioned)
  const sessionDependencies = dependencies(database, versionedAdapter)
  const sessionId = currentSessionId()
  const storedDocumentId = documentIdSchema.safeParse(
    readStoredId(localStorage, DOCUMENT_STORAGE_KEY),
  )

  if (storedDocumentId.success) {
    const opened = await openVersionedDocumentSession(
      {
        ...sessionDependencies,
        legacyRepository: repository.legacy,
        versionedRepository: repository.versioned,
      },
      {
        documentId: storedDocumentId.data,
        sessionId,
        mesh: PRODUCT_MESH_POLICY,
        storedAt: new Date().toISOString(),
      },
    )
    if (opened.ok) return opened
    if (opened.diagnostic.sourceCode !== "document-not-found") return opened
  }

  const documentId = createBrowserDocumentId()
  const created = await createPersistentDocumentSession(sessionDependencies, {
    sessionId,
    mesh: PRODUCT_MESH_POLICY,
    command: createCommand(documentId, defaultDocumentName),
  })
  if (created.ok) writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, documentId)
  return created
}

async function start(defaultDocumentName: string) {
  publish({ ...state, status: "loading", diagnostic: null })
  try {
    const result = await openOrCreate(defaultDocumentName)
    if (!result.ok) {
      publish({ ...state, status: "error", diagnostic: result.diagnostic })
      return
    }
    session = result.session
    publish({
      status: "ready",
      report: result.report,
      saveStatus: "saved",
      diagnostic: result.report.writeAccessDiagnostic,
    })
  } catch {
    publish({
      ...state,
      status: "error",
      diagnostic: {
        code: "persistence-failed",
        message: "The local document session could not be started.",
        retryable: true,
        sourceCode: null,
      },
    })
  }
}

function startDocumentController(defaultDocumentName: string) {
  startPromise ??= start(defaultDocumentName)
  return startPromise
}

export function createBrowserVariableId() {
  return variableIdSchema.parse(browserUuidV7())
}

export function createBrowserDocumentId() {
  return documentIdSchema.parse(browserUuidV7())
}

export function createBrowserFeatureId() {
  return featureIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchId(): SketchId {
  return sketchIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchEntityId(): SketchEntityId {
  return sketchEntityIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchExternalReferenceId() {
  return sketchExternalReferenceIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchConstraintId(): SketchConstraintId {
  return sketchConstraintIdSchema.parse(browserUuidV7())
}

function subscribeDocumentController(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getDocumentControllerState() {
  return state
}

function automationCommitFailure(
  code:
    | "document-write-unavailable"
    | "document-commit-failed"
    | "draft-commit-intent-mismatch"
    | "stale-revision",
  message: string,
  retryable = false,
): Extract<AutomationHostResult<never>, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable, issues: [] } }
}

function automationCommitEligibility(active: PersistentDocumentSession, draft: DocumentDraft) {
  if (
    session !== active ||
    state.status !== "ready" ||
    !state.report ||
    state.saveStatus === "saving" ||
    active.mode !== "read-write"
  )
    return automationCommitFailure(
      "document-write-unavailable",
      "The active project is not available for writing.",
      true,
    )
  if (active.snapshot.id !== draft.documentId || active.snapshot.revision !== draft.baseRevision)
    return automationCommitFailure(
      "stale-revision",
      "The active project changed after this draft was created.",
      true,
    )
  if (!draft.snapshot)
    return automationCommitFailure(
      "draft-commit-intent-mismatch",
      "The draft has no expected document state.",
    )
  return null
}

function automationSessionFailure(diagnostic: PersistentDocumentSessionDiagnostic) {
  const code =
    diagnostic.sourceCode === "stale-revision"
      ? "stale-revision"
      : diagnostic.code === "write-access-unavailable"
        ? "document-write-unavailable"
        : diagnostic.code === "invalid-draft-commit"
          ? "draft-commit-intent-mismatch"
          : "document-commit-failed"
  return automationCommitFailure(code, diagnostic.message, diagnostic.retryable)
}

async function commitActiveAutomationDraft(
  active: PersistentDocumentSession,
  draft: DocumentDraft,
  commands: readonly DocumentCommand[],
): Promise<Awaited<ReturnType<AutomationDocumentPort["compareAndCommitDraft"]>>> {
  const rejected = automationCommitEligibility(active, draft)
  if (rejected) return rejected
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active
    .commitDraft({
      draftId: draft.id,
      commands,
      expectedSnapshot: draft.snapshot,
    })
    .catch(() => ({
      ok: false as const,
      diagnostic: {
        code: "persistence-failed" as const,
        message: "The document session could not confirm the draft commit.",
        retryable: false,
        sourceCode: null,
      },
    }))
  if (!result.ok) {
    if (session === active)
      publish({
        ...state,
        report: state.report ? { ...state.report, mode: active.mode } : null,
        saveStatus: "save-error",
        diagnostic: result.diagnostic,
      })
    return automationSessionFailure(result.diagnostic)
  }
  if (session === active && state.report)
    publish({
      ...state,
      report: { ...state.report, snapshot: result.snapshot, rebuild: result.rebuild },
      saveStatus: "saved",
      diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
    })
  return {
    ok: true,
    commit: {
      transactionId: draft.id,
      documentId: draft.documentId,
      baseRevision: draft.baseRevision,
      revision: result.snapshot.revision,
      actor: draft.actor,
      commandIds: result.events.map((event) => event.commandId),
      events: result.events,
      snapshot: result.snapshot,
    },
  } satisfies DraftCommitResult
}

// Only trusted browser composition may create a handle; MCP pairing and review remain separate gates.
export function createActiveDocumentAutomationSession() {
  const active = session
  if (!active || state.status !== "ready" || !state.report)
    return automationCommitFailure("document-write-unavailable", "No local project is open.", true)
  const factory = createDocumentAutomationSession({
    commands: coreCommandDispatcher(),
    modules: coreRegistries().modules,
    createDraftId: browserUuidV7,
    documents: {
      readSnapshot: (documentId) =>
        session === active && state.status === "ready" && active.snapshot.id === documentId
          ? active.snapshot
          : null,
      compareAndCommitDraft: (draft, commands) =>
        commitActiveAutomationDraft(active, draft, commands),
    },
  })
  if (!factory.ok) return factory
  const queryDispatcher = createQueryDispatcher(coreRegistries().modules, documentCoreQueryHandlers)
  if (!queryDispatcher.ok) {
    factory.dispose()
    return automationCommitFailure(
      "document-write-unavailable",
      queryDispatcher.diagnostic.message,
      true,
    )
  }
  const capturedDocumentId = active.snapshot.id
  let closed = false
  const currentReport = () => {
    if (
      closed ||
      session !== active ||
      state.status !== "ready" ||
      active.snapshot.id !== capturedDocumentId
    )
      return null
    return state.report
  }
  const readInfo = (): ActiveAutomationInfo | null => {
    const report = currentReport()
    if (!report) return null
    const snapshot = active.snapshot
    const summary = queryDispatcher.dispatcher.dispatch(snapshot, {
      kind: "org.vibeshape.document.summary",
      schemaVersion: 1,
      documentId: snapshot.id,
      revision: snapshot.revision,
    })
    if (!summary.ok) return null
    const evidence = createModelMeasurementEvidence(snapshot, report.rebuild)
    const measurementDiagnostic = evidence.ok
      ? null
      : {
          code: evidence.code,
          message: "Exact model measurements are unavailable.",
          retryable: true,
        }
    const measurement = evidence.ok
      ? queryDispatcher.dispatcher.dispatch(
          snapshot,
          modelMeasurementQuerySchema.parse({
            kind: "org.vibeshape.model.measurements",
            schemaVersion: 1,
            documentId: snapshot.id,
            revision: snapshot.revision,
            cursor: null,
            limit: 200,
          }),
          { measurements: evidence.evidence },
        )
      : null
    return {
      summary: documentSummaryViewSchema.parse(summary.view),
      measurements: measurement?.ok ? modelMeasurementViewSchema.parse(measurement.view) : null,
      measurementDiagnostic,
    }
  }
  const readBodyMeasurements = (
    query: ModelBodyMeasurementQuery,
    report: NonNullable<ReturnType<typeof currentReport>>,
    snapshot: DocumentSnapshot,
  ): QueryResult => {
    const evidence = createModelBodyMeasurementEvidence(snapshot, report.rebuild)
    if (!evidence.ok) {
      return {
        ok: false,
        diagnostic: {
          code: evidence.code,
          message: "Exact body measurements are unavailable.",
          retryable: evidence.code !== "invalid-geometry-evidence",
          issues: [],
        },
      }
    }
    return queryDispatcher.dispatcher.dispatch(snapshot, query, {
      bodyMeasurements: evidence.evidence,
    })
  }
  const readCad = (
    query:
      | CadInspectionListQuery
      | CadInspectionDetailQuery
      | VariableListQuery
      | ModelEdgeQuery
      | ModelBodyMeasurementQuery
      | ModelBodyTopologyQuery,
  ): QueryResult => {
    const report = currentReport()
    if (!report) return queryDispatcher.dispatcher.dispatch(null, query)
    const snapshot = active.snapshot
    if (query.kind === "org.vibeshape.model.body-topology") {
      const bodyTopology = createModelBodyTopologyEvidence(snapshot, report.rebuild, {
        featureId: query.featureId,
        outputRole: query.outputRole,
        kind: query.topologyKind,
      })
      return queryDispatcher.dispatcher.dispatch(snapshot, query, { bodyTopology })
    }
    const edges =
      query.kind === "org.vibeshape.model.edges"
        ? createModelEdgeEvidence(snapshot, report.rebuild, query.featureId)
        : undefined
    if (query.kind === "org.vibeshape.model.body-measurements") {
      return readBodyMeasurements(query, report, snapshot)
    }
    return queryDispatcher.dispatcher.dispatch(snapshot, query, edges ? { edges } : undefined)
  }
  const exportRevisionBound = async (format: GeometryExportFormat, revision: number) => {
    if (!currentReport() || revision !== active.snapshot.revision)
      return automationCommitFailure(
        "stale-revision",
        "The active project changed before export.",
        true,
      )
    const result = await active.exportDocument(format)
    if (!result.ok) return result
    if (!currentReport() || active.snapshot.revision !== revision)
      return automationCommitFailure(
        "stale-revision",
        "The active project changed during export.",
        true,
      )
    return {
      ok: true as const,
      format: result.response.format,
      file: result.response.file,
      bodyCount: result.response.bodyCount,
      documentName: active.snapshot.name,
    }
  }
  const closeAutomation = factory.dispose
  let revision = active.snapshot.revision
  const unsubscribe = subscribeDocumentController(() => {
    if (session !== active || state.status !== "ready") {
      dispose()
      return
    }
    if (active.snapshot.revision !== revision) {
      revision = active.snapshot.revision
      factory.cancel("stale-revision")
    }
  })
  function dispose() {
    closed = true
    unsubscribe()
    window.removeEventListener("pagehide", dispose)
    closeAutomation()
  }
  window.addEventListener("pagehide", dispose, { once: true })
  return {
    ok: true as const,
    documentId: active.snapshot.id,
    get revision() {
      return active.snapshot.revision
    },
    host: factory.host,
    readInfo,
    readCad,
    exportRevisionBound,
    cancel: factory.cancel,
    dispose,
  }
}

export async function applyVariableTable(
  baseRevision: number,
  variables: readonly VariableDefinition[],
): Promise<ApplyVariableTableResult> {
  if (!session || state.status !== "ready" || !state.report) {
    return {
      ok: false,
      diagnostic: {
        code: "session-closed",
        message: "The local document session is unavailable.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await session.commitDraft({
    draftId: draftIdSchema.parse(browserUuidV7()),
    commands: [
      {
        kind: "org.vibeshape.variable.replace-table",
        schemaVersion: 1,
        commandId: browserUuidV7(),
        documentId: session.snapshot.id,
        baseRevision,
        issuedAt: new Date().toISOString(),
        actor: { type: "user", userId: null },
        payload: { variables },
      },
    ],
  })
  if (!result.ok) {
    publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
    return result
  }
  publish({
    ...state,
    report: { ...state.report, snapshot: result.snapshot, rebuild: result.rebuild },
    saveStatus: "saved",
    diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
  })
  return { ok: true }
}

async function navigateDocumentHistory(
  direction: "undo" | "redo",
  baseRevision: number,
): Promise<DocumentMutationResult> {
  if (!session || state.status !== "ready" || !state.report || state.saveStatus === "saving") {
    return {
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message: "Wait for the active document operation to finish.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  const activeSession = session
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  try {
    const result = await activeSession.navigateHistory({
      direction,
      commandId: browserUuidV7(),
      documentId: activeSession.snapshot.id,
      baseRevision,
      issuedAt: new Date().toISOString(),
      actor: { type: "user", userId: null },
    })
    if (!result.ok) {
      publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
      return result
    }
    publish({
      ...state,
      report: { ...state.report, snapshot: result.snapshot, rebuild: result.rebuild },
      saveStatus: "saved",
      diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
    })
    return { ok: true }
  } catch {
    const diagnostic: PersistentDocumentSessionDiagnostic = {
      code: "persistence-failed",
      message: "The history change could not be completed.",
      retryable: true,
      sourceCode: null,
    }
    publish({ ...state, saveStatus: "save-error", diagnostic })
    return { ok: false, diagnostic }
  }
}

export function undoDocument(baseRevision: number) {
  return navigateDocumentHistory("undo", baseRevision)
}

export function redoDocument(baseRevision: number) {
  return navigateDocumentHistory("redo", baseRevision)
}

async function commitDocumentCommand(
  createCommand: (
    documentId: ReturnType<typeof documentIdSchema.parse>,
  ) => Parameters<NonNullable<typeof session>["commit"]>[0],
): Promise<ApplyVariableTableResult> {
  if (!session || state.status !== "ready" || !state.report) {
    return {
      ok: false,
      diagnostic: {
        code: "session-closed",
        message: "The local document session is unavailable.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await session.commit(createCommand(session.snapshot.id))
  if (!result.ok) {
    if (result.diagnostic.sourceCode === "command-no-op") {
      publish({ ...state, saveStatus: "saved", diagnostic: null })
      return { ok: true }
    }
    publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
    return result
  }
  publish({
    ...state,
    report: { ...state.report, snapshot: result.snapshot, rebuild: result.rebuild },
    saveStatus: "saved",
    diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
  })
  return { ok: true }
}

async function commitFeatureMutation(
  kind: "org.vibeshape.feature.add" | "org.vibeshape.feature.update",
  baseRevision: number,
  feature: FeatureRecord,
): Promise<FeatureMutationResult> {
  return commitDocumentCommand((documentId) => ({
    kind,
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { feature },
  }))
}

export function addFeature(baseRevision: number, feature: FeatureRecord) {
  return commitFeatureMutation("org.vibeshape.feature.add", baseRevision, feature)
}

export function updateFeature(baseRevision: number, feature: FeatureRecord) {
  return commitFeatureMutation("org.vibeshape.feature.update", baseRevision, feature)
}

export function setFeatureSuppressed(
  baseRevision: number,
  featureId: FeatureRecord["id"],
  suppressed: boolean,
) {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.feature.set-suppressed",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { featureId, suppressed },
  }))
}

export function removeFeature(baseRevision: number, featureId: FeatureRecord["id"]) {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.feature.remove",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { featureId },
  }))
}

export function removeFeaturePreservingModelReferenceIntent(
  baseRevision: number,
  featureId: FeatureRecord["id"],
) {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.feature.remove-preserving-model-reference-intent",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { featureId },
  }))
}

function commitSketchMutation(
  kind: "org.vibeshape.sketch.add" | "org.vibeshape.sketch.update",
  baseRevision: number,
  sketch: SketchRecord,
): Promise<SketchMutationResult> {
  return commitDocumentCommand((documentId) => ({
    kind,
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { sketch },
  }))
}

export function addSketch(baseRevision: number, sketch: SketchRecord) {
  return commitSketchMutation("org.vibeshape.sketch.add", baseRevision, sketch)
}

export function updateSketch(baseRevision: number, sketch: SketchRecord) {
  return commitSketchMutation("org.vibeshape.sketch.update", baseRevision, sketch)
}

export function removeSketch(baseRevision: number, sketchId: SketchId) {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.sketch.remove",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { sketchId },
  }))
}

export async function solveActiveSketch(
  baseRevision: number,
  sketch: SketchId | SketchRecord,
  options: ActiveSketchSolveOptions = {},
): Promise<ActiveSketchSolveResult> {
  if (!session || state.status !== "ready" || !state.report) {
    return {
      ok: false,
      diagnostic: {
        code: "session-closed",
        message: "The local document session is unavailable.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  const sketchId = isString(sketch) ? sketch : sketch.id
  const draftSketch = isString(sketch) ? undefined : sketch
  const committedSketchExists = state.report.snapshot.sketches.some(({ id }) => id === sketchId)
  if (state.report.snapshot.revision !== baseRevision || (!draftSketch && !committedSketchExists)) {
    return {
      ok: false,
      diagnostic: {
        code: "sketch-solve-failed",
        message: "The sketch changed before it could be solved.",
        retryable: true,
        sourceCode: "stale-revision",
      },
    }
  }
  return session.solveSketch(sketchId, draftSketch, options)
}

export async function exportActiveDocument(
  format: GeometryExportFormat,
): Promise<ActiveDocumentExportResult> {
  if (!session || state.status !== "ready" || !state.report) {
    return {
      ok: false,
      diagnostic: {
        code: "session-closed",
        message: "The local document session is unavailable.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  const result = await session.exportDocument(format)
  return result.ok
    ? {
        ok: true,
        format: result.response.format,
        file: result.response.file,
        bodyCount: result.response.bodyCount,
        documentName: session.snapshot.name,
      }
    : result
}

function unavailableProjectFileResult() {
  return {
    ok: false as const,
    diagnostic: {
      code: "session-closed",
      message: "The local document session is unavailable.",
    },
  }
}

export async function exportActiveProjectBackup(): Promise<ActiveProjectBackupResult> {
  if (!session || !activeRepository || state.status !== "ready" || !state.report) {
    return unavailableProjectFileResult()
  }
  const portable = await activeRepository.exportPortableProjectV2(session.snapshot.id)
  if (!portable.ok) return portable
  const archived = await writeVShapeV2({
    ...portable.value,
    exportedAt: new Date().toISOString(),
    createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    engine: null,
  })
  return archived.ok
    ? { ok: true, file: archived.value, documentName: session.snapshot.name }
    : archived
}

export async function importProjectBackup(bytes: Uint8Array): Promise<ProjectImportResult> {
  if (!activeRepository || state.status !== "ready") return unavailableProjectFileResult()
  const decoded = await readVersionedVShape(bytes)
  if (!decoded.ok) return decoded
  const portable = portableProjectV2FromArchive(decoded.value)
  if (!portable.ok) return portable
  const imported = await activeRepository.importPortableProjectV2({
    ...portable.project,
    exportedAt: portable.exportedAt,
    importedAt: new Date().toISOString(),
  })
  return imported.ok
    ? { ok: true, documentId: imported.value.documentId }
    : { ok: false, diagnostic: imported.diagnostic }
}

export async function listLocalProjects(): Promise<LocalProjectListResult> {
  if (!activeRepository || state.status !== "ready") return unavailableProjectFileResult()
  const result = await activeRepository.listProjects()
  return result.ok
    ? { ok: true, projects: result.value }
    : { ok: false, diagnostic: result.diagnostic }
}

export async function saveActiveProjectThumbnail(
  documentIdInput: unknown,
  revision: number,
  thumbnail: Readonly<{ mediaType: "image/svg+xml"; bytes: Uint8Array }>,
): Promise<ProjectThumbnailWriteResult> {
  if (!activeRepository || state.status !== "ready" || !state.report) {
    return unavailableProjectFileResult()
  }
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (
    !documentId.success ||
    state.report.snapshot.id !== documentId.data ||
    state.report.snapshot.revision !== revision
  ) {
    return {
      ok: false,
      diagnostic: { code: "stale-revision", message: "The active project revision changed." },
    }
  }
  const stored = await activeRepository.writeProjectThumbnail({
    documentId: documentId.data,
    revision,
    mediaType: thumbnail.mediaType,
    bytes: thumbnail.bytes,
    generatedAt: new Date().toISOString(),
  })
  return stored.ok ? { ok: true } : { ok: false, diagnostic: stored.diagnostic }
}

export async function activateLocalProject(documentIdInput: unknown): Promise<ProjectSwitchResult> {
  if (!session || !activeRepository || state.status !== "ready") {
    return unavailableProjectFileResult()
  }
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (!documentId.success) {
    return {
      ok: false,
      diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
    }
  }
  if (session.snapshot.id === documentId.data) return { ok: true }
  const projects = await activeRepository.listProjects()
  if (!projects.ok) return { ok: false, diagnostic: projects.diagnostic }
  if (!projects.value.some((project) => project.documentId === documentId.data)) {
    return {
      ok: false,
      diagnostic: { code: "document-not-found", message: "The local project does not exist." },
    }
  }
  const closed = await session.close()
  session = null
  if (!closed.ok) {
    window.location.reload()
    return { ok: false, diagnostic: closed.diagnostic }
  }
  if (!writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, documentId.data)) {
    window.location.reload()
    return {
      ok: false,
      diagnostic: {
        code: "storage-unavailable",
        message: "The active project selection could not be stored in this browser.",
      },
    }
  }
  window.location.reload()
  return { ok: true }
}

export async function createNewLocalProject(): Promise<ProjectSwitchResult> {
  if (!session || state.status !== "ready") return unavailableProjectFileResult()
  const closed = await session.close()
  session = null
  if (!closed.ok) {
    window.location.reload()
    return { ok: false, diagnostic: closed.diagnostic }
  }
  if (!removeStoredId(localStorage, DOCUMENT_STORAGE_KEY)) {
    window.location.reload()
    return {
      ok: false,
      diagnostic: {
        code: "storage-unavailable",
        message: "The active project selection could not be cleared in this browser.",
      },
    }
  }
  window.location.reload()
  return { ok: true }
}

export async function deleteLocalProject(
  documentIdInput: unknown,
  expectedHeadRevision: number,
): Promise<ProjectDeleteResult> {
  if (!session || !activeRepository || state.status !== "ready") {
    return unavailableProjectFileResult()
  }
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (!documentId.success) {
    return {
      ok: false,
      diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
    }
  }
  if (session.snapshot.id === documentId.data) {
    return {
      ok: false,
      diagnostic: { code: "invalid-input", message: "The active project cannot be deleted." },
    }
  }
  const deleted = await activeRepository.deleteProject({
    documentId: documentId.data,
    expectedHeadRevision,
    nowMs: Date.now(),
  })
  return deleted.ok ? { ok: true } : { ok: false, diagnostic: deleted.diagnostic }
}

export async function duplicateLocalProject(
  documentIdInput: unknown,
  expectedHeadRevision: number,
  name: string,
): Promise<ProjectDuplicateResult> {
  if (!activeRepository || state.status !== "ready") return unavailableProjectFileResult()
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (!documentId.success) {
    return {
      ok: false,
      diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
    }
  }
  const portable = await activeRepository.exportPortableProjectV2(documentId.data)
  if (!portable.ok) return { ok: false, diagnostic: portable.diagnostic }
  if (portable.value.snapshot.revision !== expectedHeadRevision) {
    return {
      ok: false,
      diagnostic: { code: "stale-revision", message: "The project changed before it was copied." },
    }
  }

  const copiedAt = new Date().toISOString()
  const copied = copyPortableProjectV2({
    source: portable.value,
    documentId: documentIdSchema.parse(browserUuidV7()),
    name,
    issuedAt: copiedAt,
    nextCommandId: browserUuidV7,
    nextTransactionId: () => draftIdSchema.parse(browserUuidV7()),
  })
  if (!copied.ok) return { ok: false, diagnostic: copied.diagnostic }

  const stored = await activeRepository.copyPortableProjectV2({
    ...copied.project,
    copiedAt,
  })
  if (!stored.ok) return { ok: false, diagnostic: stored.diagnostic }
  await activeRepository.copyProjectThumbnail({
    sourceDocumentId: documentId.data,
    sourceRevision: expectedHeadRevision,
    targetDocumentId: stored.value.documentId,
    targetRevision: stored.value.revision,
    generatedAt: copiedAt,
  })
  return { ok: true, documentId: stored.value.documentId, name: copied.project.snapshot.name }
}

export function renameVariable(baseRevision: number, variableId: VariableId, name: string) {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.variable.rename",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { variableId, name },
  }))
}

export function renameActiveProject(
  baseRevision: number,
  name: string,
): Promise<DocumentMutationResult> {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { name },
  }))
}

export function setActiveProjectDisplayUnits(
  baseRevision: number,
  displayUnits: DocumentDisplayUnits,
): Promise<DocumentMutationResult> {
  return commitDocumentCommand((documentId) => ({
    kind: "org.vibeshape.document.set-display-units",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { displayUnits },
  }))
}

export function useDocumentController(defaultDocumentName: string) {
  const controllerState = useSyncExternalStore(
    subscribeDocumentController,
    getDocumentControllerState,
    getDocumentControllerState,
  )
  useEffect(() => {
    void startDocumentController(defaultDocumentName)
  }, [defaultDocumentName])
  return controllerState
}
