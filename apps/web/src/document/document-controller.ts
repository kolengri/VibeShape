import {
  createPersistentDocumentSession,
  openPersistentDocumentSession,
  type PersistentDocumentSession,
  type PersistentDocumentSessionDiagnostic,
  type PersistentDocumentSessionReport,
  type PersistentSketchSolveResult,
} from "@vibeshape/application/persistent-document-session"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  copyDocumentHistory,
  createCommandDispatcher,
  createCoreCommandHandlers,
  createFeatureTypeRegistry,
  createModuleRegistry,
  type DocumentDisplayUnits,
  documentCoreModule,
  documentIdSchema,
  draftIdSchema,
  type FeatureRecord,
  featureCoreModule,
  featureIdSchema,
  generateUuidV7,
  partDesignFeatureTypeHandlers,
  partDesignModule,
  type SketchConstraintId,
  type SketchEntityId,
  type SketchId,
  type SketchRecord,
  sessionIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  type VariableDefinition,
  type VariableId,
  variableIdSchema,
} from "@vibeshape/domain"
import { readVShape, writeVShape } from "@vibeshape/formats/vshape"
import {
  acquireDocumentLease,
  LocalDocumentRepository,
  type LocalProjectSummary,
  releaseDocumentLease,
  VibeShapeDatabase,
} from "@vibeshape/persistence"
import type { GeometryExportFormat } from "@vibeshape/protocol"
import { isString } from "is-what"
import { useEffect, useSyncExternalStore } from "react"

const DATABASE_NAME = "vibeshape-product-v0"
const DOCUMENT_STORAGE_KEY = "vibeshape-active-document-id"
const SESSION_STORAGE_KEY = "vibeshape-browser-session-id"
const MESH_POLICY = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

type ControllerStatus = "idle" | "loading" | "ready" | "error"
type SaveStatus = "saved" | "saving" | "save-error"

export type DocumentControllerState = Readonly<{
  status: ControllerStatus
  report: PersistentDocumentSessionReport | null
  saveStatus: SaveStatus
  diagnostic: PersistentDocumentSessionDiagnostic | null
}>

export type ApplyVariableTableResult =
  | { ok: true }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type DocumentMutationResult = ApplyVariableTableResult
export type FeatureMutationResult = ApplyVariableTableResult
type SketchMutationResult = ApplyVariableTableResult
export type ActiveSketchSolveResult = PersistentSketchSolveResult

export type ActiveDocumentExportResult =
  | {
      ok: true
      format: GeometryExportFormat
      file: Uint8Array
      bodyCount: number
      documentName: string
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

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
let activeRepository: LocalDocumentRepository | null = null
let startPromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: DocumentControllerState) {
  state = next
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
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const featureTypes = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!featureTypes.ok) throw new Error(featureTypes.diagnostic.message)
  const dispatcher = createCommandDispatcher(
    modules.registry,
    createCoreCommandHandlers(featureTypes.registry),
  )
  if (!dispatcher.ok) throw new Error(dispatcher.diagnostic.message)
  return dispatcher.dispatcher
}

function dependencies(database: VibeShapeDatabase, repository: LocalDocumentRepository) {
  return {
    commandDispatcher: coreCommandDispatcher(),
    repository: {
      commit: (input: Parameters<LocalDocumentRepository["commit"]>[0]) => repository.commit(input),
      commitDraft: (input: Parameters<LocalDocumentRepository["commitDraft"]>[0]) =>
        repository.commitDraft(input),
      recover: (documentId: Parameters<LocalDocumentRepository["recover"]>[0]) =>
        repository.recover(documentId),
      closeCleanly: (input: Parameters<LocalDocumentRepository["closeCleanly"]>[0]) =>
        repository.closeCleanly(input),
    },
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
  const repository = new LocalDocumentRepository(database)
  activeRepository = repository
  const sessionDependencies = dependencies(database, repository)
  const sessionId = currentSessionId()
  const storedDocumentId = documentIdSchema.safeParse(
    readStoredId(localStorage, DOCUMENT_STORAGE_KEY),
  )

  if (storedDocumentId.success) {
    const opened = await openPersistentDocumentSession(sessionDependencies, {
      documentId: storedDocumentId.data,
      sessionId,
      mesh: MESH_POLICY,
    })
    if (opened.ok) return opened
    if (opened.diagnostic.sourceCode !== "document-not-found") return opened
  }

  const documentId = documentIdSchema.parse(browserUuidV7())
  const created = await createPersistentDocumentSession(sessionDependencies, {
    sessionId,
    mesh: MESH_POLICY,
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

export function createBrowserFeatureId() {
  return featureIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchId(): SketchId {
  return sketchIdSchema.parse(browserUuidV7())
}

export function createBrowserSketchEntityId(): SketchEntityId {
  return sketchEntityIdSchema.parse(browserUuidV7())
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

export async function solveActiveSketch(
  baseRevision: number,
  sketch: SketchId | SketchRecord,
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
  return session.solveSketch(sketchId, draftSketch)
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
  const portable = await activeRepository.exportPortableProject(session.snapshot.id)
  if (!portable.ok) return portable
  const archived = await writeVShape({
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
  const decoded = await readVShape(bytes)
  if (!decoded.ok) return decoded
  const imported = await activeRepository.importPortableProject({
    snapshot: decoded.value.snapshot,
    events: decoded.value.events,
    exportedAt: decoded.value.manifest.exportedAt,
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
  if (!writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, documentId.data)) {
    return {
      ok: false,
      diagnostic: {
        code: "storage-unavailable",
        message: "The active project selection could not be stored in this browser.",
      },
    }
  }
  await session.close()
  session = null
  window.location.reload()
  return { ok: true }
}

export async function createNewLocalProject(): Promise<ProjectSwitchResult> {
  if (!session || state.status !== "ready") return unavailableProjectFileResult()
  if (!removeStoredId(localStorage, DOCUMENT_STORAGE_KEY)) {
    return {
      ok: false,
      diagnostic: {
        code: "storage-unavailable",
        message: "The active project selection could not be cleared in this browser.",
      },
    }
  }
  await session.close()
  session = null
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
  const portable = await activeRepository.exportPortableProject(documentId.data)
  if (!portable.ok) return { ok: false, diagnostic: portable.diagnostic }
  if (portable.value.snapshot.revision !== expectedHeadRevision) {
    return {
      ok: false,
      diagnostic: { code: "stale-revision", message: "The project changed before it was copied." },
    }
  }

  const copiedAt = new Date().toISOString()
  const copied = copyDocumentHistory({
    sourceSnapshot: portable.value.snapshot,
    sourceEvents: portable.value.events,
    documentId: documentIdSchema.parse(browserUuidV7()),
    commandIds: Array.from({ length: portable.value.events.length + 1 }, browserUuidV7),
    name,
    issuedAt: copiedAt,
    actor: { type: "user", userId: null },
  })
  if (!copied.ok) return { ok: false, diagnostic: copied.diagnostic }

  const stored = await activeRepository.copyPortableProject({
    snapshot: copied.snapshot,
    events: copied.events,
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
  return { ok: true, documentId: stored.value.documentId, name: copied.snapshot.name }
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
