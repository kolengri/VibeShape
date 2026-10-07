import { openAuthorityDocumentSession } from "@vibeshape/application/authority-document-session"
import { createAuthorityPersistenceAdapter } from "@vibeshape/application/authority-persistence-adapter"
import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { createModelDiagnosticsEvidence } from "@vibeshape/application/model-diagnostics"
import { createModelEdgeEvidence } from "@vibeshape/application/model-edges"
import {
  createModelBodyMeasurementEvidence,
  createModelMeasurementEvidence,
} from "@vibeshape/application/model-measurements"
import {
  createPersistentDocumentSession,
  type PersistentDocumentHistoryResult,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSession,
  type PersistentDocumentSessionDiagnostic,
  type PersistentDocumentSessionOpenResult,
  type PersistentDocumentSessionReport,
  type PersistentSketchSolveOptions,
  type PersistentSketchSolveResult,
} from "@vibeshape/application/persistent-document-session"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import type {
  CadInspectionDetailQuery,
  CadInspectionListQuery,
  ModelBodyMeasurementQuery,
  ModelBodyTopologyQuery,
  ModelEdgeQuery,
  ModelMeasurementQuery,
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
import type { AssemblySessionConfiguration } from "@vibeshape/automation-host/assembly-session-contract"
import {
  type HistoryCommitInput,
  type HistoryRequest,
  historyRequestSchema,
} from "@vibeshape/automation-host/history-session"
import type { AutomationDocumentPort, AutomationHostResult } from "@vibeshape/automation-host/host"
import type { SurfaceTextureReviewedInput } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { DocumentWorkerRequestError } from "@vibeshape/document-worker/client"
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
  type HistoryItemRef,
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
import {
  type AssemblyMutation,
  applyCapturedAssemblyMutations,
  captureAssemblyMutations,
  emptyAssemblyAuthority,
  pinnedAssemblyDefinitionSchema,
} from "@vibeshape/domain/assembly-authority"
import { mergeCapturedAssemblyAssets } from "@vibeshape/domain/assembly-pinned-insertion"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type CommandActor,
  commandActorsEqual,
  type DocumentCommand,
} from "@vibeshape/domain/commands"
import { documentNameInputSchema, documentSnapshotSchema } from "@vibeshape/domain/document"
import type {
  AuthoredDocumentSnapshot,
  DocumentAuthoritySnapshot,
} from "@vibeshape/domain/document-v2"
import type {
  DocumentV2Command,
  DocumentV2MetadataChange,
} from "@vibeshape/domain/document-v2-command-schemas"
import {
  type DocumentV3Command,
  documentV2MetadataCommandSchema,
  documentV3MetadataCommandSchema,
} from "@vibeshape/domain/document-v2-command-schemas"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import { documentSnapshotV4Schema, promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { applyDocumentV4AuthoredCommand } from "@vibeshape/domain/document-v4-commands"
import type { DocumentDraft, DraftCommitResult } from "@vibeshape/domain/drafts"
import type { FeatureId } from "@vibeshape/domain/identifiers"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import type { SourceAssetBlob } from "@vibeshape/domain/source-assets"
import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
import {
  readAuthoredVShape,
  writeVShapeV2,
  writeVShapeV3,
  writeVShapeV4,
  writeVShapeV5,
} from "@vibeshape/formats/vshape"
import {
  acquireDocumentLease,
  type LocalProjectSummary,
  releaseDocumentLease,
  VibeShapeDatabase,
} from "@vibeshape/persistence"
import type {
  AssemblyExportSettings,
  AssemblyInspection,
  GeometryExportFormat,
  MeshExportQuality,
  PrintPreparationResult,
  PrintPreparationSettings,
} from "@vibeshape/protocol"
import { assemblyExportSettingsSchema } from "@vibeshape/protocol"
import { isString } from "is-what"
import { useEffect, useSyncExternalStore } from "react"
import {
  assemblyPortFailure,
  createBrowserAssemblyAutomationSession,
} from "../automation/assembly-automation-session"
import { assemblyInspectionView } from "../automation/assembly-inspection-view"
import { automationReviews } from "../automation/automation-review-controller"
import { isImportReview, isPlanarImportReview } from "../automation/automation-review-state"
import { createBinaryExportSession } from "../automation/binary-export-session"
import { createDocumentAutomationSession } from "../automation/document-automation-session"
import { createBrowserHistoryAutomationSession } from "../automation/history-automation-session"
import { createImportAutomationSession } from "../automation/import-automation-session"
import type { ImportReviewedCommit, ImportReviewInput } from "../automation/import-upload-session"
import { createMetadataAutomationSession } from "../automation/metadata-automation-session"
import { createPlanarImportAutomationSession } from "../automation/planar-import-automation-session"
import type {
  PlanarImportReviewedCommit,
  PlanarImportReviewInput,
} from "../automation/planar-import-upload-session"
import {
  previewOwnedSurfaceTextures,
  surfaceTextureReviewedInputMatches,
} from "../automation/surface-texture-automation-preview"
import { createBrowserSurfaceTextureAutomationSession } from "../automation/surface-texture-automation-session"
import { createAssemblyTransaction } from "../features/assembly/assembly-model"
import { prepareDocumentPrint } from "../printing/prepare-document-print"
import { createBrowserPart, enableAuthoredDocument } from "./authored-document-session"
import { copyBrowserPortableProject, portableProjectFromArchive } from "./authored-project-file"
import { createAutomationLibraryPort } from "./browser-library-repository"
import { BrowserProjectRepository } from "./browser-project-repository"
import { prepareDocumentGeometryExport } from "./document-geometry-export"
import { PRODUCT_MESH_POLICY } from "./document-worker-settings"
import { captureLibrarySource } from "./library-source"
import { createProjectActionGuard } from "./project-action-guard"
import { materializeDocumentSourceAssets } from "./source-assets-rebuild"
import { formatProjectCopyName } from "./versioned-project-file"

const DATABASE_NAME = "vibeshape-product-v0"
const DOCUMENT_STORAGE_KEY = "vibeshape-active-document-id"
const SESSION_STORAGE_KEY = "vibeshape-browser-session-id"
type ControllerStatus = "idle" | "loading" | "ready" | "error"
type SaveStatus = "saved" | "saving" | "save-error"

export type DocumentControllerState = Readonly<{
  status: ControllerStatus
  report: PersistentDocumentSessionReport | null
  authoredSnapshot?: DocumentAuthoritySnapshot | null
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
      printPreparation?: PrintPreparationResult
    }
  | { ok: false; diagnostic: PersistentDocumentSessionDiagnostic }

export type ActiveAutomationInfo = Readonly<{
  summary: ReturnType<typeof documentSummaryViewSchema.parse>
  measurements: ReturnType<typeof modelMeasurementViewSchema.parse> | null
  diagnostics?: ModelDiagnosticsEvidence | null
  measurementDiagnostic: { code: string; message: string; retryable: boolean } | null
}>

export type ActiveProjectBackupResult =
  | { ok: true; file: Uint8Array; documentName: string; documentId: string; revision: number }
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

export type AutomationProjectExpectation = Readonly<{ documentId: string; revision: number }>
export type AutomationProjectResult =
  | { ok: true; value: { projectId: string; name: string; revision: number } }
  | { ok: false; diagnostic: { code: string; message: string; retryable: boolean } }

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
let activeDatabase: VibeShapeDatabase | null = null
let defaultProjectName = "Untitled project"
let startPromise: Promise<void> | null = null
const listeners = new Set<() => void>()
const projectActionGuard = createProjectActionGuard()
export const registerProjectActionGuard = projectActionGuard.register

export function getProjectActiveWorkBlock() {
  const review = automationReviews.getSnapshot()
  if (review && review.status !== "error") return "automation-busy" as const
  return projectActionGuard.read()
}

export function getProjectActionBlock() {
  if (state.status !== "ready" || !session || !activeRepository) return "unavailable" as const
  if (state.saveStatus === "saving") return "saving" as const
  if (state.saveStatus === "save-error") return "save-error" as const
  return getProjectActiveWorkBlock()
}

function captureProjectAction() {
  const blocked = getProjectActionBlock()
  if (blocked || !session || !activeRepository) return null
  const active = session
  const repository = activeRepository
  const { id, revision } = active.snapshot
  return {
    active,
    repository,
    id,
    revision,
    current: (saveStatus: SaveStatus = "saved") =>
      state.status === "ready" &&
      state.saveStatus === saveStatus &&
      !getProjectActiveWorkBlock() &&
      session === active &&
      activeRepository === repository &&
      active.snapshot.id === id &&
      active.snapshot.revision === revision,
  }
}

function projectActionUnavailable() {
  return {
    ok: false as const,
    diagnostic: {
      code: "project-action-blocked",
      message: "Finish the active edit, save, or AI operation before using project files.",
    },
  }
}

function publish(next: DocumentControllerState) {
  state = {
    ...next,
    authoredSnapshot: session?.authoredSnapshot ?? null,
    history: session?.history ?? { canUndo: false, canRedo: false },
  }
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

function dependencies(
  database: VibeShapeDatabase,
  repository: PersistentDocumentRepositoryPort,
  sourceRepository: BrowserProjectRepository,
) {
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
      createDocumentWorkerSession(documentId, {
        materializeSourceAssets: (document) =>
          materializeDocumentSourceAssets(
            database,
            async () => {
              const recovered = await sourceRepository.versioned.recoverAuthority(documentId)
              if (!recovered.ok) throw new Error(recovered.diagnostic.message)
              return recovered.value.snapshot
            },
            document.features,
          ),
      }),
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

function createCommand(
  documentId: ReturnType<typeof documentIdSchema.parse>,
  name: string,
  actor: CommandActor = { type: "user", userId: null },
) {
  return {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId,
    baseRevision: 0,
    issuedAt: new Date().toISOString(),
    actor,
    payload: { name },
  } as const
}

async function openOrCreate(defaultDocumentName: string) {
  const database = new VibeShapeDatabase(DATABASE_NAME)
  activeDatabase = database
  const repository = new BrowserProjectRepository(database)
  activeRepository = repository
  const storedDocumentId = documentIdSchema.safeParse(
    readStoredId(localStorage, DOCUMENT_STORAGE_KEY),
  )
  if (storedDocumentId.success) {
    const opened = await openControllerProject(database, repository, storedDocumentId.data)
    if (opened.ok || opened.diagnostic.sourceCode !== "document-not-found") return opened
  }
  const documentId = createBrowserDocumentId()
  const created = await createPersistentDocumentSession(
    browserProjectDependencies(database, repository),
    {
      sessionId: currentSessionId(),
      mesh: PRODUCT_MESH_POLICY,
      command: createCommand(documentId, defaultDocumentName),
    },
  )
  if (created.ok) writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, documentId)
  return enableAuthoredDocument(created)
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
  defaultProjectName = defaultDocumentName
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

export function getDocumentControllerState() {
  return state
}

function automationCommitFailure(
  code:
    | "document-write-unavailable"
    | "document-commit-failed"
    | "draft-commit-intent-mismatch"
    | "draft-commit-preflight-failed"
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

function automationSessionFailure(
  diagnostic: PersistentDocumentSessionDiagnostic,
  preflight = false,
) {
  const code =
    diagnostic.sourceCode === "stale-revision"
      ? "stale-revision"
      : diagnostic.code === "write-access-unavailable"
        ? "document-write-unavailable"
        : preflight
          ? "draft-commit-preflight-failed"
          : diagnostic.code === "invalid-draft-commit"
            ? "draft-commit-intent-mismatch"
            : "document-commit-failed"
  return automationCommitFailure(code, diagnostic.message, diagnostic.retryable)
}

async function validateActiveAutomationDraft(
  active: PersistentDocumentSession,
  draft: DocumentDraft,
  commands: readonly DocumentCommand[],
): Promise<AutomationHostResult<null>> {
  const rejected = automationCommitEligibility(active, draft)
  if (rejected) return rejected
  const result = await active.validateDraft({
    draftId: draft.id,
    commands,
    expectedSnapshot: draft.snapshot,
  })
  const current = automationCommitEligibility(active, draft)
  if (current) return current
  return result.ok ? { ok: true, value: null } : automationSessionFailure(result.diagnostic, true)
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
      report: {
        ...state.report,
        snapshot: result.snapshot,
        historyItems: active.historyItems,
        rebuild: result.rebuild,
      },
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
  const repository = activeRepository
  if (!active || !repository || state.status !== "ready" || !state.report)
    return automationCommitFailure("document-write-unavailable", "No local project is open.", true)
  const capturedSession = active
  const capturedRepository = repository
  const capturedDocumentId = active.snapshot.id
  let closed = false
  const sourceSessionAvailable = () =>
    !closed &&
    session === capturedSession &&
    activeRepository === capturedRepository &&
    state.status === "ready" &&
    capturedSession.snapshot.id === capturedDocumentId
  async function materializeAutomationSourceAssets(input: unknown) {
    const document = documentSnapshotSchema.parse(input)
    if (!sourceSessionAvailable() || document.id !== capturedDocumentId)
      throw new Error("The paired source document session is unavailable.")
    const sourceRevision = capturedSession.snapshot.revision
    // Draft revisions are private; the host owns stale-base checks against this committed session.
    const assets = await capturedRepository.materializeSourceAssets(
      capturedDocumentId,
      document.features,
    )
    if (!sourceSessionAvailable() || capturedSession.snapshot.revision !== sourceRevision)
      throw new Error("The paired source document changed during materialization.")
    return assets
  }
  const factory = createDocumentAutomationSession({
    materializeSourceAssets: materializeAutomationSourceAssets,
    unsupportedPreviewRepresentation(target) {
      const authority = active.authoredSnapshot
      if (!authority || authority.schemaVersion === 1) return null
      if (!target && authority.schemaVersion === 4 && authority.assembly.instances.length)
        return "Preview rendering does not support assembly occurrence placement. Request an exact local CAD body instead."
      if (
        authority.schemaVersion !== 2 &&
        authority.surfaceTextures.some(
          (layer) =>
            layer.enabled &&
            (!target ||
              (layer.featureId === target.featureId &&
                layer.target.outputRole === target.outputRole)),
        )
      )
        return "Preview rendering does not support authored surface relief on the requested bodies."
      return null
    },
    commands: coreCommandDispatcher(),
    modules: coreRegistries().modules,
    createDraftId: browserUuidV7,
    documents: {
      readSnapshot: (documentId) =>
        session === active && state.status === "ready" && active.snapshot.id === documentId
          ? active.snapshot
          : null,
      validateDraft: (draft, commands) => validateActiveAutomationDraft(active, draft, commands),
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
  // Heartbeats need identity, not a fresh validation of every derived mesh buffer.
  const readIdentity = () =>
    sourceSessionAvailable()
      ? {
          id: active.snapshot.id,
          name: active.snapshot.name,
          revision: active.snapshot.revision,
        }
      : null
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
    const diagnostics = createModelDiagnosticsEvidence(snapshot, report.rebuild)
    const measurementDiagnostic = evidence.ok
      ? diagnostics.ok
        ? null
        : {
            code: diagnostics.code,
            message: "Complete model diagnostics are unavailable.",
            retryable: true,
          }
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
      diagnostics: diagnostics.ok ? diagnostics.evidence : null,
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
      | ModelMeasurementQuery
      | ModelBodyMeasurementQuery
      | ModelBodyTopologyQuery,
  ): QueryResult => {
    const report = currentReport()
    if (!report) return queryDispatcher.dispatcher.dispatch(null, query)
    const snapshot = active.snapshot
    if (query.kind === "org.vibeshape.model.measurements") {
      const measurements = createModelMeasurementEvidence(snapshot, report.rebuild)
      return queryDispatcher.dispatcher.dispatch(snapshot, query, {
        measurements: measurements.ok ? measurements.evidence : undefined,
      })
    }
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
  const exportRevisionBound = async (
    format: GeometryExportFormat,
    revision: number,
    meshQuality?: MeshExportQuality,
  ) => {
    if (!currentReport() || revision !== active.snapshot.revision)
      return automationCommitFailure(
        "stale-revision",
        "The active project changed before export.",
        true,
      )
    const result = await exportActiveDocument(format, undefined, meshQuality)
    if (!result.ok) return result
    if (!currentReport() || active.snapshot.revision !== revision)
      return automationCommitFailure(
        "stale-revision",
        "The active project changed during export.",
        true,
      )
    return result
  }
  const metadata = createMetadataAutomationSession({
    materializeSourceAssets: materializeAutomationSourceAssets,
    documentId: active.snapshot.id,
    queries: queryDispatcher.dispatcher,
    createDraftId: browserUuidV7,
    readSnapshot: () => (currentReport() ? active.authoredSnapshot : null),
    hasCommandId: (commandId) => repository.hasCommandId(commandId),
    isActive: () => currentReport() !== null,
    commit: (command, expected) => commitReviewedMetadata(active, command, expected),
  })
  function readSourceContext() {
    const snapshot = currentReport() ? active?.authoredSnapshot : null
    return snapshot && snapshot.schemaVersion !== 1
      ? {
          documentId: capturedDocumentId,
          revision: snapshot.revision,
          authorityVersion: snapshot.schemaVersion,
          historyAfter: state.report?.historyItems?.at(-1) ?? null,
        }
      : null
  }
  const imports = createImportAutomationSession({
    documentId: capturedDocumentId,
    isActive: sourceSessionAvailable,
    createId: browserUuidV7,
    readContext: readSourceContext,
    async commit(input) {
      if (!sourceSessionAvailable() || !importReviewedInputMatches(input))
        return localFailure(
          "import-review-mismatch",
          "The captured import review no longer matches.",
        )
      return commitReviewedImport(active, input)
    },
  })
  const planarImports = createPlanarImportAutomationSession({
    documentId: capturedDocumentId,
    isActive: sourceSessionAvailable,
    createId: browserUuidV7,
    readContext: readSourceContext,
    async commit(input) {
      if (!sourceSessionAvailable() || !planarImportReviewedInputMatches(input))
        return localFailure(
          "planar-import-review-mismatch",
          "The captured planar import review no longer matches.",
        )
      return commitReviewedPlanarImport(active, input)
    },
  })
  const assembly = createBrowserAssemblyAutomationSession({
    documentId: capturedDocumentId,
    createId: browserUuidV7,
    isActive: sourceSessionAvailable,
    readSnapshot: () => (sourceSessionAvailable() ? active.authoredSnapshot : null),
    library: createAutomationLibraryPort(async (input) => {
      if (!sourceSessionAvailable() || assemblySourceCaptureBlock())
        return assemblyPortFailure({
          code: "document-write-unavailable",
          message: "The paired source document is not writable for library capture.",
          retryable: true,
        })
      const captured = captureLibrarySource(getDocumentControllerState(), input)
      const { libraryBinding: _binding, ...definition } = captured
      const authority = active.authoredSnapshot
      if (!authority || authority.schemaVersion === 1)
        throw new Error("The paired library source authority is unavailable.")
      const materials = await verifyCapturedFrozenDefinition(definition, {
        active,
        repository,
        authority,
      })
      const blobs = new Map(
        materials.map(({ asset, bytes }) => [
          asset.digest,
          { digest: asset.digest, bytes: bytes.slice() },
        ]),
      )
      return { ok: true, value: { definition, blobs: [...blobs.values()] } }
    }),
    async inspect(revision, input) {
      if (!sourceSessionAvailable() || active.snapshot.revision !== revision)
        return assemblyPortFailure({
          code: "stale-revision",
          message: "The paired assembly revision changed.",
          retryable: true,
        })
      const result = await inspectActiveAssembly(input.interferencePairs)
      return result.ok
        ? {
            ok: true,
            value: assemblyInspectionView(
              capturedDocumentId,
              revision,
              result.inspection,
              input.topology,
            ),
          }
        : assemblyPortFailure(result.diagnostic)
    },
    async preview(changes, baseRevision, blobs) {
      if (!sourceSessionAvailable() || active.snapshot.revision !== baseRevision)
        return assemblyPortFailure({
          code: "stale-revision",
          message: "The paired assembly revision changed.",
          retryable: true,
        })
      const result = await previewAssemblyChanges(changes, baseRevision, blobs)
      return result.ok
        ? {
            ok: true,
            value: assemblyInspectionView(capturedDocumentId, baseRevision, result.inspection),
          }
        : assemblyPortFailure(result.diagnostic)
    },
    commit: (input) => commitReviewedAssembly(active, input),
  })
  const history = createBrowserHistoryAutomationSession({
    documentId: capturedDocumentId,
    isActive: sourceSessionAvailable,
    readSnapshot: () => (sourceSessionAvailable() ? active.snapshot : null),
    availability: () => active.history,
    readTarget: (direction) => (sourceSessionAvailable() ? active.previewHistory(direction) : null),
    hasCommandId: (commandId) => repository.hasCommandId(commandId),
    createId: browserUuidV7,
    async materializeSourceAssets(target, baseRevision) {
      if (
        !sourceSessionAvailable() ||
        active.snapshot.revision !== baseRevision ||
        target.authority.id !== capturedDocumentId
      )
        throw new Error("The paired history source document is unavailable.")
      // A restored checkpoint owns its descriptors even when Undo removed them from current authority.
      const assets = await repository.materializeCapturedSourceAssets(target.authority)
      if (!sourceSessionAvailable() || active.snapshot.revision !== baseRevision)
        throw new Error("The paired history base changed during materialization.")
      return assets
    },
    async previewAssembly(target, baseRevision) {
      if (!sourceSessionAvailable() || active.snapshot.revision !== baseRevision)
        throw new Error("The paired history base changed during preview.")
      if (target.authority.schemaVersion !== 4) return undefined
      const result = await inspectCapturedAssembly(
        { active, repository, authority: target.authority },
        [],
        [],
        baseRevision,
      )
      return {
        occurrenceCount: result.inspection.occurrences.length,
        ...(result.inspection.kinematics
          ? { degreesOfFreedom: result.inspection.kinematics.degreesOfFreedom }
          : {}),
      }
    },
    commit: (input) => commitReviewedHistory(active, input),
  })
  function texturePreviewAvailable(input: SurfaceTextureReviewedInput) {
    if (
      !sourceSessionAvailable() ||
      capturedSession.snapshot.revision !== input.draft.baseRevision ||
      assemblyEditorDraftBlock()
    )
      return false
    const review = automationReviews.getSnapshot()
    return !review || review.status === "error" || surfaceTextureReviewedInputMatches(review, input)
  }
  const surfaceTextures = createBrowserSurfaceTextureAutomationSession({
    documentId: capturedDocumentId,
    createId: browserUuidV7,
    isActive: sourceSessionAvailable,
    readSnapshot: () => (sourceSessionAvailable() ? active.authoredSnapshot : null),
    async preview(input, signal) {
      if (!texturePreviewAvailable(input))
        return localFailure(
          "stale-revision",
          "The texture source is no longer available for preview.",
          true,
        )
      try {
        const evidence = await previewOwnedSurfaceTextures(
          getDocumentControllerState(),
          input.command.payload.layers,
          signal,
        )
        if (!texturePreviewAvailable(input) || signal.aborted)
          return localFailure("stale-revision", "The texture source changed during preview.", true)
        return { ok: true, value: evidence }
      } catch (error) {
        return localFailure(
          "surface-texture-preview-failed",
          error instanceof Error
            ? error.message.slice(0, 512)
            : "The native surface relief preview failed.",
        )
      }
    },
    commit: (input) =>
      sourceSessionAvailable()
        ? commitReviewedSurfaceTexture(active, input)
        : Promise.resolve(
            localFailure("session-revoked", "The texture source session is unavailable."),
          ),
  })
  const exports = createBinaryExportSession({
    documentId: capturedDocumentId,
    currentRevision: () => active.snapshot.revision,
    isActive: () => currentReport() !== null,
    async prepare(format, revision, meshQuality) {
      if (format !== "vshape") {
        const result = await exportRevisionBound(format, revision, meshQuality)
        return result.ok
          ? {
              ok: true as const,
              documentId: capturedDocumentId,
              revision,
              format,
              file: result.file,
            }
          : { ok: false as const }
      }
      if (!currentReport() || active.snapshot.revision !== revision) return { ok: false as const }
      const result = await exportCapturedProjectBackup({
        active,
        repository,
        id: capturedDocumentId,
        revision,
        current: () =>
          currentReport() !== null &&
          session === active &&
          activeRepository === repository &&
          active.snapshot.revision === revision &&
          state.saveStatus !== "saving" &&
          state.saveStatus !== "save-error",
      })
      if (!currentReport() || active.snapshot.revision !== revision || !result.ok)
        return { ok: false as const }
      return {
        ok: true as const,
        documentId: result.documentId,
        revision: result.revision,
        format,
        file: result.file,
      }
    },
  })
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
      metadata.cancel("stale-revision")
      imports.cancel("stale-revision")
      planarImports.cancel("stale-revision")
      assembly.cancel("stale-revision")
      history.cancel("stale-revision")
      surfaceTextures.cancel("stale-revision")
    }
  })
  function dispose() {
    closed = true
    unsubscribe()
    window.removeEventListener("pagehide", dispose)
    closeAutomation()
    metadata.dispose()
    imports.dispose()
    planarImports.dispose()
    assembly.dispose()
    history.dispose()
    surfaceTextures.dispose()
    exports.dispose()
  }
  window.addEventListener("pagehide", dispose, { once: true })
  return {
    ok: true as const,
    documentId: active.snapshot.id,
    get revision() {
      return active.snapshot.revision
    },
    host: factory.host,
    metadata,
    imports,
    planarImports,
    assembly,
    history,
    surfaceTextures,
    exports,
    enableAutoApply: (actor: unknown) => currentReport() !== null && factory.enableAutoApply(actor),
    disableAutoApply: factory.disableAutoApply,
    readInfo,
    readIdentity,
    readSketchSolution: factory.readSketchSolution,
    readRenderPreview: factory.readRenderPreview,
    readCad,
    exportRevisionBound,
    cancel: (reason?: Parameters<typeof factory.cancel>[0]) => {
      factory.cancel(reason)
      metadata.cancel(reason)
      imports.cancel(reason)
      planarImports.cancel(reason)
      assembly.cancel(reason)
      history.cancel(reason)
      surfaceTextures.cancel(reason)
      exports.cancel()
    },
    dispose,
  }
}

export async function applyVariableTable(
  baseRevision: number,
  variables: readonly VariableDefinition[],
): Promise<ApplyVariableTableResult> {
  if (!session || state.status !== "ready" || !state.report || state.saveStatus === "saving") {
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
    report: {
      ...state.report,
      snapshot: result.snapshot,
      historyItems: session.historyItems,
      rebuild: result.rebuild,
    },
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
  const result = await publishHistoryNavigation(
    session,
    historyRequestSchema.parse({
      direction,
      commandId: browserUuidV7(),
      documentId: session.snapshot.id,
      baseRevision,
      issuedAt: new Date().toISOString(),
      actor: { type: "user", userId: null },
    }),
  )
  return result.ok ? { ok: true } : result
}

async function publishHistoryNavigation(
  activeSession: PersistentDocumentSession,
  request: HistoryRequest,
): Promise<PersistentDocumentHistoryResult> {
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  try {
    const result = await activeSession.navigateHistory(request)
    if (!result.ok) {
      if (session === activeSession)
        publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
      return result
    }
    if (session === activeSession && state.report)
      publish({
        ...state,
        report: {
          ...state.report,
          snapshot: result.snapshot,
          historyItems: activeSession.historyItems,
          rebuild: result.rebuild,
        },
        saveStatus: "saved",
        diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
      })
    return result
  } catch {
    const diagnostic: PersistentDocumentSessionDiagnostic = {
      code: "persistence-failed",
      message: "The history change could not be completed.",
      retryable: true,
      sourceCode: null,
    }
    if (session === activeSession) publish({ ...state, saveStatus: "save-error", diagnostic })
    return { ok: false, diagnostic }
  }
}

export function undoDocument(baseRevision: number) {
  return navigateDocumentHistory("undo", baseRevision)
}

export function redoDocument(baseRevision: number) {
  return navigateDocumentHistory("redo", baseRevision)
}

function canWriteAuthoredMetadata(active: PersistentDocumentSession | null) {
  return canWriteAuthoredState(active) && !getProjectActiveWorkBlock()
}

function canWriteAuthoredState(active: PersistentDocumentSession | null) {
  return (
    active?.mode === "read-write" &&
    state.status === "ready" &&
    state.report !== null &&
    state.saveStatus !== "saving"
  )
}

function reviewedMetadataBase(active: PersistentDocumentSession, baseRevision: number) {
  if (
    session !== active ||
    state.status !== "ready" ||
    state.saveStatus === "saving" ||
    active.mode !== "read-write"
  )
    return null
  const base = active.authoredSnapshot
  return base && base.schemaVersion !== 1 && base.revision === baseRevision ? base : null
}

function planarImportReviewedInputMatches(input: PlanarImportReviewedCommit) {
  const review = automationReviews.getSnapshot()
  if (review?.status !== "applying" || !isPlanarImportReview(review.input)) return false
  return (
    commandActorsEqual(review.input.actor, input.actor) &&
    planarImportReviewIdentity(review.input) === planarImportReviewIdentity(input)
  )
}
function planarImportReviewIdentity(input: PlanarImportReviewInput) {
  return canonicalJson({
    draft: input.draft,
    source: input.source,
    label: input.label,
    inspection: input.inspection,
    transaction: input.transaction,
  })
}
async function commitReviewedPlanarImport(
  active: PersistentDocumentSession,
  input: PlanarImportReviewedCommit,
) {
  if (
    !reviewedMetadataBase(active, input.draft.baseRevision) ||
    active.snapshot.id !== input.draft.documentId ||
    projectActionGuard.read((block) => block !== "automation-busy") ||
    !planarImportReviewedInputMatches(input)
  )
    return localFailure(
      "stale-revision",
      "The reviewed planar import base has an active edit or changed.",
      true,
    )
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active.commitAuthoredTransaction({
    ...input.transaction,
    assetBlobs: input.assetBlobs,
  })
  publishAuthoredResult(active, result)
  return result.ok
    ? { ok: true as const, value: { revision: result.snapshot.revision } }
    : localFailure(result.diagnostic.code, result.diagnostic.message, result.diagnostic.retryable)
}

function importReviewedInputMatches(input: ImportReviewedCommit) {
  const review = automationReviews.getSnapshot()
  if (review?.status !== "applying" || !isImportReview(review.input)) return false
  const expected = review.input
  return (
    commandActorsEqual(expected.actor, input.actor) &&
    importReviewIdentity(expected) === importReviewIdentity(input)
  )
}
function importReviewIdentity(input: ImportReviewInput) {
  return canonicalJson({
    draft: input.draft,
    source: input.source,
    label: input.label,
    transaction: input.transaction,
  })
}

async function commitReviewedImport(
  active: PersistentDocumentSession,
  input: ImportReviewedCommit,
) {
  if (
    !reviewedMetadataBase(active, input.draft.baseRevision) ||
    active.snapshot.id !== input.draft.documentId ||
    projectActionGuard.read((block) => block !== "automation-busy") ||
    !importReviewedInputMatches(input)
  )
    return localFailure(
      "stale-revision",
      "The reviewed import base has an active edit or changed.",
      true,
    )
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active.commitAuthoredTransaction({
    ...input.transaction,
    assetBlobs: input.assetBlobs,
  })
  publishAuthoredResult(active, result)
  return result.ok
    ? { ok: true as const, value: { revision: result.snapshot.revision } }
    : localFailure(result.diagnostic.code, result.diagnostic.message, result.diagnostic.retryable)
}

async function commitReviewedMetadata(
  active: PersistentDocumentSession,
  command: Extract<DocumentV2Command, { kind: "org.vibeshape.document.metadata-command" }>,
  expected: AuthoredDocumentSnapshot,
) {
  const base = reviewedMetadataBase(active, command.baseRevision)
  if (!base)
    return {
      ok: false as const,
      diagnostic: {
        code: "stale-revision",
        message: "The reviewed metadata base is no longer writable.",
        retryable: true,
      },
    }
  const replayed =
    base.schemaVersion === 4
      ? applyDocumentV4AuthoredCommand(base, { ...command, schemaVersion: 3 })
      : base.schemaVersion === 3
        ? applyDocumentV3Command(base, { ...command, schemaVersion: 3 })
        : applyDocumentV2Command(base, command)
  if (!replayed.ok || canonicalJson(replayed.snapshot) !== canonicalJson(expected))
    return {
      ok: false as const,
      diagnostic: {
        code: "draft-commit-intent-mismatch",
        message: "The reviewed metadata does not match the requested change.",
        retryable: false,
      },
    }
  const result = await commitActiveAuthoredCommand(active, command)
  if (!result.ok)
    return {
      ok: false as const,
      diagnostic: {
        code: result.diagnostic.sourceCode ?? result.diagnostic.code,
        message: result.diagnostic.message,
        retryable: result.diagnostic.retryable,
      },
    }
  return {
    documentId: command.documentId,
    commandId: command.commandId,
    baseRevision: command.baseRevision,
    revision: result.snapshot.revision,
    change: command.payload,
  }
}

export async function inspectGeometrySource(input: unknown) {
  const active = session
  if (!active) throw new Error("The document session is unavailable.")
  const result = await active.inspectSourceImport(input)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

export async function inspectTriangleMeshSource(input: unknown) {
  const active = session
  if (!active) throw new Error("The document session is unavailable.")
  const result = await active.inspectMeshImport(input)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.value
}

function captureAssemblyContext() {
  const active = session
  const repository = activeRepository
  const authority = active?.authoredSnapshot
  if (
    !active ||
    !repository ||
    state.status !== "ready" ||
    !authority ||
    authority.schemaVersion === 1
  )
    throw new Error("Assembly authority is unavailable.")
  return { active, repository, authority: promoteDocumentSnapshotV4(authority) }
}

function assertAuthorityCurrent(active: NonNullable<typeof session>, revision: number) {
  if (session !== active || active.authoredSnapshot?.revision !== revision)
    throw new Error("The source document changed during assembly preparation.")
}

function assemblyFailure(message: unknown, operation: string) {
  const constraint =
    message instanceof DocumentWorkerRequestError && message.response?.type === "failure"
      ? message.response.diagnostic.assembly
      : undefined
  return {
    ok: false as const,
    diagnostic: {
      code: "export-failed" as const,
      message: message instanceof Error ? message.message : `${operation} failed.`,
      retryable: false,
      sourceCode: "assembly-operation-failed",
      ...(constraint ? { assembly: constraint } : {}),
    },
  }
}

export async function inspectActiveAssembly(
  pairs: readonly { leftInstanceId: string; rightInstanceId: string }[] = [],
): Promise<
  | { ok: true; inspection: AssemblyInspection }
  | { ok: false; diagnostic: { code: string; message: string; retryable: boolean } }
> {
  try {
    return await inspectCapturedAssembly(captureAssemblyContext(), pairs)
  } catch (error) {
    return assemblyFailure(error, "Assembly inspection")
  }
}

/** Validates disposable mate geometry before a revision-safe authored transaction. */
export async function previewAssemblyChanges(
  changes: readonly AssemblyMutation[],
  revision: number,
  ownedBlobs: readonly SourceAssetBlob[] = [],
) {
  try {
    const context = captureAssemblyContext()
    if (context.authority.revision !== revision)
      throw new Error("The assembly preview revision is stale.")
    const captured = captureAssemblyMutations(
      context.authority,
      context.authority.assembly,
      changes,
    )
    const assembly = applyCapturedAssemblyMutations(context.authority.assembly, captured)
    const authority = documentSnapshotV4Schema.parse({
      ...context.authority,
      assets: mergeCapturedAssemblyAssets(context.authority, captured),
      assembly,
    })
    return await inspectCapturedAssembly({ ...context, authority }, [], ownedBlobs)
  } catch (error) {
    return assemblyFailure(error, "Assembly preview")
  }
}

async function inspectCapturedAssembly(
  context: ReturnType<typeof captureAssemblyContext>,
  pairs: readonly { leftInstanceId: string; rightInstanceId: string }[],
  ownedBlobs: readonly SourceAssetBlob[] = [],
  baseRevision = context.authority.revision,
) {
  const { active, repository, authority } = context
  const worker = createDocumentWorkerSession(authority.id, { retryRecoverableFailure: false })
  try {
    const sourceAssets = await repository.materializeAssemblySourceAssets(authority, ownedBlobs)
    assertAuthorityCurrent(active, baseRevision)
    const result = await worker.inspectAssembly(
      {
        authorityJson: canonicalJson(authority),
        sourceAssets: [...sourceAssets],
        mesh: PRODUCT_MESH_POLICY,
        interferencePairs: [...pairs],
      },
      authority.revision,
    )
    assertAuthorityCurrent(active, baseRevision)
    return { ok: true as const, inspection: result.inspection }
  } finally {
    worker.terminate()
  }
}

export async function exportActiveAssembly(
  settings: AssemblyExportSettings,
  signal?: AbortSignal,
): Promise<ActiveDocumentExportResult> {
  try {
    return await exportCapturedAssembly(
      captureAssemblyContext(),
      assemblyExportSettingsSchema.parse(settings),
      signal,
    )
  } catch (error) {
    return assemblyFailure(error, "Assembly export")
  }
}

async function exportCapturedAssembly(
  context: ReturnType<typeof captureAssemblyContext>,
  settings: AssemblyExportSettings,
  signal?: AbortSignal,
): Promise<ActiveDocumentExportResult> {
  const { active, repository, authority } = context
  if (signal?.aborted) throw new Error("Assembly export was cancelled.")
  const worker = createDocumentWorkerSession(authority.id, { retryRecoverableFailure: false })
  const cancel = () => worker.terminate()
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    const sourceAssets = await repository.materializeAssemblySourceAssets(authority)
    if (signal?.aborted) throw new Error("Assembly export was cancelled.")
    assertAuthorityCurrent(active, authority.revision)
    const result = await worker.exportAssembly(
      {
        assembly: {
          authorityJson: canonicalJson(authority),
          sourceAssets: [...sourceAssets],
          mesh: PRODUCT_MESH_POLICY,
          interferencePairs: [],
        },
        settings,
      },
      authority.revision,
    )
    if (signal?.aborted) throw new Error("Assembly export was cancelled.")
    assertAuthorityCurrent(active, authority.revision)
    return {
      ok: true,
      format: settings.format,
      file: result.file,
      bodyCount: result.bodyCount,
      documentName: authority.name,
      ...(result.printPreparation ? { printPreparation: result.printPreparation } : {}),
    }
  } finally {
    signal?.removeEventListener("abort", cancel)
    worker.terminate()
  }
}

function captureLibrarySourceContext() {
  const active = session
  const repository = activeRepository
  const authority = active?.authoredSnapshot
  if (
    !active ||
    !repository ||
    !authority ||
    authority.schemaVersion === 1 ||
    getProjectActionBlock()
  )
    throw new Error("The source document is unavailable for a library save.")
  return { active, repository, authority }
}

/** Verifies a saved library pin using an isolated occurrence, including definitions without instances. */
export async function verifyActiveFrozenDefinition(input: unknown) {
  return verifyCapturedFrozenDefinition(input, captureLibrarySourceContext())
}

async function verifyCapturedFrozenDefinition(
  input: unknown,
  context: ReturnType<typeof captureLibrarySourceContext>,
) {
  const definition = pinnedAssemblyDefinitionSchema.parse(input)
  const { active, repository, authority } = context
  const frozen = documentSnapshotV4Schema.parse({
    ...authority,
    schemaVersion: 4,
    surfaceTextures: authority.schemaVersion === 2 ? [] : authority.surfaceTextures,
    assets: authority.schemaVersion === 4 ? authority.assets : [],
    assembly: {
      ...emptyAssemblyAuthority(),
      definitions: [definition],
      instances: [
        {
          schemaVersion: 1,
          id: browserUuidV7(),
          definitionId: definition.id,
          name: definition.name,
          grounded: true,
          worldFrame: { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        },
      ],
    },
  })
  const worker = createDocumentWorkerSession(authority.id, { retryRecoverableFailure: false })
  try {
    const sourceAssets = await repository.materializeAssemblySourceAssets(frozen)
    await worker.inspectAssembly(
      {
        authorityJson: canonicalJson(frozen),
        sourceAssets: [...sourceAssets],
        mesh: PRODUCT_MESH_POLICY,
        interferencePairs: [],
      },
      authority.revision,
    )
    assertAuthorityCurrent(active, authority.revision)
    return sourceAssets
  } finally {
    worker.terminate()
  }
}

function historyBaseWritable(active: PersistentDocumentSession, request: HistoryRequest) {
  return (
    session === active &&
    canWriteAuthoredState(active) &&
    !assemblyEditorDraftBlock() &&
    active.snapshot.revision === request.baseRevision &&
    request.documentId === active.snapshot.id
  )
}
function historyReviewMatches(input: HistoryCommitInput) {
  const visible = automationReviews.getSnapshot()
  if (
    visible?.status !== "applying" ||
    !("kind" in visible.input) ||
    visible.input.kind !== "history"
  )
    return false
  if (canonicalJson(visible.input) !== canonicalJson(input.review)) return false
  const target = session?.previewHistory(input.review.request.direction)
  return !!target && canonicalJson(target) === canonicalJson(input.target)
}

async function commitReviewedHistory(active: PersistentDocumentSession, input: HistoryCommitInput) {
  const request = input.review.request
  if (!historyBaseWritable(active, request) || !historyReviewMatches(input))
    return {
      ok: false as const,
      diagnostic: {
        code: "stale-history-review",
        message: "The exact history approval or saved target is no longer current.",
        retryable: true,
      },
    }
  const result = await publishHistoryNavigation(active, request)
  if (!result.ok)
    return {
      ok: false as const,
      diagnostic: {
        code: result.diagnostic.sourceCode ?? result.diagnostic.code,
        message: result.diagnostic.message,
        retryable: result.diagnostic.retryable,
      },
    }
  return {
    ok: true as const,
    value: {
      documentId: request.documentId,
      baseRevision: request.baseRevision,
      revision: result.snapshot.revision,
      commandId: request.commandId,
      direction: request.direction,
      targetRevision: input.target.targetRevision,
    },
  }
}

function assemblyEditorDraftBlock() {
  return projectActionGuard.read((block) => block !== "automation-busy")
}
function assemblySourceCaptureBlock() {
  const review = automationReviews.getSnapshot()
  return (
    assemblyEditorDraftBlock() ?? (review && review.status !== "error" ? "automation-busy" : null)
  )
}
function assemblyReviewedInputMatches(
  input: Parameters<AssemblySessionConfiguration["commit"]>[0],
) {
  const review = automationReviews.getSnapshot()
  if (
    review?.status !== "applying" ||
    !("kind" in review.input) ||
    review.input.kind !== "assembly"
  )
    return false
  const owned = review.input
  return (
    owned.draft.draftId === input.draftId &&
    owned.draft.baseRevision === input.baseRevision &&
    owned.draft.draftVersion === input.draftVersion &&
    commandActorsEqual(owned.actor, input.actor) &&
    canonicalJson(owned.changes) === canonicalJson(input.changes)
  )
}
async function commitReviewedAssembly(
  active: PersistentDocumentSession,
  input: Parameters<AssemblySessionConfiguration["commit"]>[0],
) {
  const base = reviewedMetadataBase(active, input.baseRevision)
  if (!base || assemblyEditorDraftBlock() || !assemblyReviewedInputMatches(input))
    return assemblyPortFailure({
      code: "stale-revision",
      message: "The reviewed assembly base is no longer writable.",
      retryable: true,
    })
  const transaction = createAssemblyTransaction(
    { documentId: base.id, revision: base.revision, authorityVersion: base.schemaVersion },
    input.changes,
    browserUuidV7,
    input.actor,
  )
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active.commitAuthoredTransaction({
    ...transaction,
    transactionId: input.draftId,
    assetBlobs: input.blobs,
  })
  publishAuthoredResult(active, result)
  return result.ok
    ? { ok: true as const, value: { revision: active.snapshot.revision } }
    : assemblyPortFailure(result.diagnostic)
}

function reviewedSurfaceTextureBase(
  active: PersistentDocumentSession,
  input: SurfaceTextureReviewedInput,
) {
  const base = reviewedMetadataBase(active, input.draft.baseRevision)
  if (!base || input.command.documentId !== base.id) return null
  const review = automationReviews.getSnapshot()
  return review?.status === "applying" &&
    !assemblyEditorDraftBlock() &&
    surfaceTextureReviewedInputMatches(review, input)
    ? base
    : null
}
async function commitReviewedSurfaceTexture(
  active: PersistentDocumentSession,
  input: SurfaceTextureReviewedInput,
) {
  const base = reviewedSurfaceTextureBase(active, input)
  if (!base)
    return localFailure("stale-revision", "The reviewed texture base is no longer writable.", true)
  const checked =
    base.schemaVersion === 4
      ? applyDocumentV4AuthoredCommand(base, input.command)
      : applyDocumentV3Command(base, input.command)
  if (!checked.ok)
    return localFailure(
      "surface-texture-command-rejected",
      checked.diagnostic.message.slice(0, 512),
    )
  const result = await commitActiveAuthoredCommand(active, input.command)
  return result.ok
    ? {
        ok: true as const,
        value: { documentId: input.command.documentId, revision: result.snapshot.revision },
      }
    : localFailure(
        result.diagnostic.sourceCode ?? result.diagnostic.code,
        result.diagnostic.message.slice(0, 512),
        result.diagnostic.retryable,
      )
}

export async function commitAuthoredTransaction(
  baseRevision: number,
  input: unknown,
): Promise<DocumentMutationResult> {
  const active = session
  if (!active || !canWriteAuthoredMetadata(active) || active.snapshot.revision !== baseRevision)
    return {
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message:
          "The document changed or has an active edit. Inspect the source again before importing.",
        retryable: true,
        sourceCode: null,
      },
    }
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active.commitAuthoredTransaction(input)
  publishAuthoredResult(active, result)
  return result.ok ? { ok: true } : result
}

export async function commitAuthoredMetadata(
  baseRevision: number,
  change: DocumentV2MetadataChange,
): Promise<DocumentMutationResult> {
  const active = session
  if (!active || !canWriteAuthoredMetadata(active))
    return {
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message: "Finish the active edit before changing parts or folders.",
        retryable: true,
        sourceCode: null,
      },
    }
  const result = await commitActiveAuthoredCommand(
    active,
    documentV2MetadataCommandSchema.parse({
      kind: "org.vibeshape.document.metadata-command",
      schemaVersion: 2,
      commandId: browserUuidV7(),
      documentId: active.snapshot.id,
      baseRevision,
      issuedAt: new Date().toISOString(),
      actor: { type: "user", userId: null },
      payload: change,
    }),
  )
  return result.ok ? { ok: true } : result
}

export async function replaceSurfaceTextureLayers(
  baseRevision: number,
  featureId: FeatureId,
  layers: readonly SurfaceTextureLayer[],
): Promise<DocumentMutationResult> {
  const active = session
  const work = getProjectActiveWorkBlock()
  if (
    !active ||
    !canWriteAuthoredState(active) ||
    (work !== null && work !== "surface-texture-draft") ||
    active.snapshot.revision !== baseRevision
  )
    return {
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message: "The texture source revision is no longer writable.",
        retryable: true,
        sourceCode: "stale-revision",
      },
    }
  const command = documentV3MetadataCommandSchema.safeParse({
    kind: "org.vibeshape.document.metadata-command",
    schemaVersion: 3,
    commandId: browserUuidV7(),
    documentId: active.snapshot.id,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { kind: "textures.replace-layers", featureId, layers },
  })
  if (!command.success)
    return {
      ok: false,
      diagnostic: {
        code: "command-rejected",
        message: "The surface texture layers are invalid.",
        retryable: false,
        sourceCode: null,
      },
    }
  const result = await commitActiveAuthoredCommand(active, command.data)
  return result.ok ? { ok: true } : result
}

async function commitActiveAuthoredCommand(
  active: PersistentDocumentSession,
  command: Extract<
    DocumentV2Command | DocumentV3Command,
    { kind: "org.vibeshape.document.metadata-command" }
  >,
) {
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  const result = await active.commitAuthored(command)
  publishAuthoredResult(active, result)
  return result
}

function publishAuthoredResult(
  active: PersistentDocumentSession,
  result: Awaited<ReturnType<PersistentDocumentSession["commitAuthored"]>>,
) {
  if (session !== active) return
  if (!result.ok) {
    publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
    return
  }
  publish({
    ...state,
    report: state.report
      ? {
          ...state.report,
          snapshot: result.snapshot,
          historyItems: active.historyItems,
          rebuild: result.rebuild,
        }
      : null,
    saveStatus: "saved",
    diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
  })
}

async function commitDocumentCommand(
  createCommand: (
    documentId: ReturnType<typeof documentIdSchema.parse>,
  ) => Parameters<NonNullable<typeof session>["commit"]>[0],
): Promise<ApplyVariableTableResult> {
  if (!session || state.status !== "ready" || !state.report || state.saveStatus === "saving") {
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
    report: {
      ...state.report,
      snapshot: result.snapshot,
      historyItems: session.historyItems,
      rebuild: result.rebuild,
    },
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

export async function moveHistoryItem(
  baseRevision: number,
  item: HistoryItemRef,
  historyAfter: HistoryItemRef | null,
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
  const result = await activeSession.moveHistoryItem({
    kind: "org.vibeshape.history.move-item",
    schemaVersion: 1,
    commandId: browserUuidV7(),
    documentId: activeSession.snapshot.id,
    baseRevision,
    issuedAt: new Date().toISOString(),
    actor: { type: "user", userId: null },
    payload: { item, historyAfter },
  })
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
    report: {
      ...state.report,
      snapshot: result.snapshot,
      historyItems: activeSession.historyItems,
      rebuild: result.rebuild,
    },
    saveStatus: "saved",
    diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
  })
  return { ok: true }
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
  partId?: string,
  meshQuality?: MeshExportQuality,
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
  const active = session
  const { revision, name } = active.snapshot
  const prepared = prepareDocumentGeometryExport(
    active.authoredSnapshot,
    state.report,
    format,
    partId,
    meshQuality,
  )
  if (!prepared.ok) return prepared
  const result = await active.exportDocument(format, prepared.options)
  if (session !== active || active.snapshot.revision !== revision) {
    return {
      ok: false,
      diagnostic: {
        code: "export-failed",
        message: "The active project changed during export. Prepare the current revision again.",
        retryable: true,
        sourceCode: "stale-revision",
      },
    }
  }
  return result.ok
    ? {
        ok: true,
        format: result.response.format,
        file: result.response.file,
        bodyCount: result.response.bodyCount,
        documentName: name,
        ...(result.response.printPreparation
          ? { printPreparation: result.response.printPreparation }
          : {}),
      }
    : result
}

export async function materializeActiveDocumentSourceAssets(input: unknown) {
  const document = documentSnapshotSchema.parse(input)
  const active = session
  const repository = activeRepository
  if (!active || !repository || state.status !== "ready")
    throw new Error("The source document session is unavailable.")
  const sourceId = active.snapshot.id
  const revision = active.snapshot.revision
  if (document.revision !== revision) throw new Error("The source document revision changed.")
  const assets = await repository.materializeSourceAssets(sourceId, document.features)
  if (session !== active || active.snapshot.revision !== revision)
    throw new Error("The source document changed during materialization.")
  return assets
}

export async function prepareActiveDocumentPrint(
  settings: PrintPreparationSettings,
  signal: AbortSignal,
  meshQuality?: MeshExportQuality,
): Promise<ActiveDocumentExportResult> {
  const active = session
  if (!active || state.status !== "ready" || !state.report || signal.aborted) {
    return {
      ok: false,
      diagnostic: {
        code: "export-failed",
        message: "Print preparation requires an active document.",
        retryable: true,
        sourceCode: null,
      },
    }
  }
  const snapshot = active.snapshot
  const plan = prepareDocumentGeometryExport(
    active.authoredSnapshot,
    state.report,
    "3mf",
    undefined,
    meshQuality,
  )
  if (!plan.ok) return plan
  return prepareDocumentPrint(
    snapshot,
    settings,
    signal,
    () => session === active && active.snapshot.revision === snapshot.revision,
    plan.options,
    materializeActiveDocumentSourceAssets,
  )
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
  const action = captureProjectAction()
  if (!action) return projectActionUnavailable()
  return exportCapturedProjectBackup(action)
}

async function exportCapturedProjectBackup(
  action: NonNullable<ReturnType<typeof captureProjectAction>>,
): Promise<ActiveProjectBackupResult> {
  if (!action.current()) return projectActionUnavailable()
  const portable = await action.repository.exportPortableProject(action.id)
  if (!portable.ok) return portable
  if (!action.current() || portable.value.project.snapshot.revision !== action.revision)
    return projectActionUnavailable()
  const write = projectBackupWriter(portable.value.version)
  const archived = await write({
    ...portable.value.project,
    exportedAt: new Date().toISOString(),
    createdBy: { application: "VibeShape", version: "0.0.0", build: null },
    engine: null,
  })
  if (!action.current()) return projectActionUnavailable()
  return archived.ok
    ? {
        ok: true,
        file: archived.value,
        documentName: action.active.snapshot.name,
        documentId: action.id,
        revision: action.revision,
      }
    : archived
}

function projectBackupWriter(version: 2 | 3 | 4 | 5) {
  switch (version) {
    case 5:
      return writeVShapeV5
    case 4:
      return writeVShapeV4
    case 3:
      return writeVShapeV3
    default:
      return writeVShapeV2
  }
}

export async function importProjectBackup(
  bytes: Uint8Array,
  formatCopyName: (name: string) => string,
): Promise<ProjectImportResult> {
  const action = captureProjectAction()
  if (!action) return projectActionUnavailable()
  const decoded = await readAuthoredVShape(bytes)
  if (!action.current()) return projectActionUnavailable()
  if (!decoded.ok) return decoded
  const portable = portableProjectFromArchive(decoded.value)
  if (!portable.ok) return portable
  const copiedAt = new Date().toISOString()
  const copied = copyBrowserPortableProject({
    source: portable.value,
    documentId: documentIdSchema.parse(browserUuidV7()),
    name: formatProjectCopyName(portable.value.project.snapshot.name, formatCopyName),
    issuedAt: copiedAt,
    nextCommandId: browserUuidV7,
    nextTransactionId: () => draftIdSchema.parse(browserUuidV7()),
  })
  if (!copied.ok) return copied
  if (!action.current()) return projectActionUnavailable()
  const imported = await action.repository.copyPortableProject(copied.value, copiedAt)
  if (!action.current()) return projectActionUnavailable()
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

type AutomationProjectRequest =
  | {
      kind: "create"
      documentId: ReturnType<typeof documentIdSchema.parse>
      name: string
      actor: CommandActor
    }
  | { kind: "open"; documentId: ReturnType<typeof documentIdSchema.parse> }

function automationProjectFailure(code: string, message: string, retryable = false) {
  return { ok: false as const, diagnostic: { code, message, retryable } }
}

function automationProjectValue(
  active: PersistentDocumentSession,
  requireWritable = false,
): AutomationProjectResult {
  const blocked = projectWriteAccessBlock(
    active,
    state.report?.writeAccessDiagnostic,
    requireWritable,
  )
  if (blocked) return blocked
  const { id, name, revision } = active.snapshot
  return { ok: true, value: { projectId: id, name, revision } }
}

function browserProjectDependencies(
  database: VibeShapeDatabase,
  repository: BrowserProjectRepository,
) {
  return {
    ...dependencies(
      database,
      createAuthorityPersistenceAdapter(repository.versioned, createBrowserPart),
      repository,
    ),
    legacyRepository: repository.legacy,
    versionedRepository: repository.versioned,
    createPart: createBrowserPart,
  }
}

async function openControllerProject(
  database: VibeShapeDatabase,
  repository: BrowserProjectRepository,
  documentId: ReturnType<typeof documentIdSchema.parse>,
) {
  return enableAuthoredDocument(
    await openAuthorityDocumentSession(browserProjectDependencies(database, repository), {
      documentId,
      sessionId: currentSessionId(),
      mesh: PRODUCT_MESH_POLICY,
      storedAt: new Date().toISOString(),
    }),
  )
}

function publishOpenedProject(opened: Extract<PersistentDocumentSessionOpenResult, { ok: true }>) {
  session = opened.session
  publish({
    status: "ready",
    report: opened.report,
    saveStatus: "saved",
    diagnostic: opened.report.writeAccessDiagnostic,
  })
}

async function prepareAutomationTarget(
  transition: AutomationProjectTransition,
  request: AutomationProjectRequest,
): Promise<PersistentDocumentSessionOpenResult> {
  if (request.kind === "open") {
    const projects = await transition.action.repository.listProjects()
    if (!projects.ok)
      return {
        ok: false,
        diagnostic: {
          code: "persistence-failed",
          message: projects.diagnostic.message,
          retryable: projects.diagnostic.retryable,
          sourceCode: projects.diagnostic.code,
        },
      }
    if (!projects.value.some((project) => project.documentId === request.documentId))
      return {
        ok: false,
        diagnostic: {
          code: "persistence-failed",
          message: "The local project does not exist.",
          retryable: false,
          sourceCode: "document-not-found",
        },
      }
    const stopped = projectTransitionInterruption(transition)
    if (stopped)
      return {
        ok: false,
        diagnostic: {
          code: "session-closed",
          message: stopped.diagnostic.message,
          retryable: stopped.diagnostic.retryable,
          sourceCode: stopped.diagnostic.code,
        },
      }
    return openControllerProject(
      transition.database,
      transition.action.repository,
      request.documentId,
    )
  }
  return enableAuthoredDocument(
    await createPersistentDocumentSession(
      browserProjectDependencies(transition.database, transition.action.repository),
      {
        sessionId: currentSessionId(),
        mesh: PRODUCT_MESH_POLICY,
        command: createCommand(request.documentId, request.name, request.actor),
      },
    ),
  )
}

type AutomationProjectTransition = {
  action: NonNullable<ReturnType<typeof captureProjectAction>>
  database: VibeShapeDatabase
  previousState: DocumentControllerState
  prepared: Extract<PersistentDocumentSessionOpenResult, { ok: true }> | null
  sourceClosed: boolean
  selectionChanged: boolean
  signal: AbortSignal | undefined
  requireWritable: boolean
}

function projectTransitionInterruption(transition: AutomationProjectTransition) {
  if (transition.signal?.aborted)
    return automationProjectFailure("cancelled", "The project action was cancelled.")
  if (!transition.action.current("saving"))
    return automationProjectFailure(
      "stale-revision",
      "The active project changed during this action.",
      true,
    )
  return null
}

function automationProjectDiagnostic(diagnostic: {
  code: string
  message: string
  retryable: boolean
  sourceCode?: string | null
}) {
  return automationProjectFailure(
    diagnostic.sourceCode ?? diagnostic.code,
    diagnostic.message,
    diagnostic.retryable,
  )
}

function projectWriteAccessBlock(
  active: PersistentDocumentSession,
  diagnostic: PersistentDocumentSessionDiagnostic | null | undefined,
  requireWritable: boolean,
) {
  if (!requireWritable || active.mode === "read-write") return null
  return diagnostic
    ? automationProjectDiagnostic(diagnostic)
    : automationProjectFailure(
        "write-access-unavailable",
        "The requested project is not available for writing.",
        true,
      )
}

async function activateAutomationTarget(
  transition: AutomationProjectTransition,
  target: Extract<PersistentDocumentSessionOpenResult, { ok: true }>,
): Promise<AutomationProjectResult> {
  const blocked =
    projectTransitionInterruption(transition) ??
    projectWriteAccessBlock(
      target.session,
      target.report.writeAccessDiagnostic,
      transition.requireWritable,
    )
  if (blocked) return blocked
  transition.selectionChanged = true
  if (!writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, target.session.snapshot.id))
    return automationProjectFailure(
      "storage-unavailable",
      "The active project selection could not be stored in this browser.",
      true,
    )
  // Close terminates the source even on failure; rollback must open a new session.
  transition.sourceClosed = true
  const closed = await transition.action.active.close()
  if (!closed.ok)
    return automationProjectFailure(
      closed.diagnostic.code,
      closed.diagnostic.message,
      closed.diagnostic.retryable,
    )
  const cancelled = projectTransitionInterruption(transition)
  if (cancelled) return cancelled
  publishOpenedProject(target)
  transition.prepared = null
  transition.selectionChanged = false
  return automationProjectValue(target.session)
}

async function closePreparedAutomationTarget(transition: AutomationProjectTransition) {
  if (!transition.prepared) return null
  try {
    const closed = await transition.prepared.session.close()
    return closed.ok
      ? null
      : automationProjectFailure(
          closed.diagnostic.code,
          closed.diagnostic.message,
          closed.diagnostic.retryable,
        )
  } catch {
    return automationProjectFailure(
      "close-failed",
      "The requested project could not be closed cleanly.",
      true,
    )
  }
}

function publishProjectRecoveryFailure(
  previousState: DocumentControllerState,
  diagnostic: PersistentDocumentSessionDiagnostic,
) {
  session = null
  publish({ ...previousState, status: "error", diagnostic })
  return automationProjectFailure(
    "project-recovery-failed",
    "The prior project is saved but could not be reopened.",
    true,
  )
}

async function recoverAutomationSource(transition: AutomationProjectTransition) {
  try {
    const restored = await openControllerProject(
      transition.database,
      transition.action.repository,
      transition.action.id,
    )
    if (!restored.ok)
      return publishProjectRecoveryFailure(transition.previousState, restored.diagnostic)
    publishOpenedProject(restored)
    return null
  } catch {
    return publishProjectRecoveryFailure(transition.previousState, {
      code: "persistence-failed",
      message: "The prior project is saved but could not be reopened.",
      retryable: true,
      sourceCode: null,
    })
  }
}

async function rollbackAutomationTransition(
  transition: AutomationProjectTransition,
  failure: Extract<AutomationProjectResult, { ok: false }>,
): Promise<AutomationProjectResult> {
  let result = (await closePreparedAutomationTarget(transition)) ?? failure
  if (
    transition.selectionChanged &&
    !writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, transition.action.id)
  )
    result = automationProjectFailure(
      "storage-unavailable",
      "The prior project selection could not be restored.",
      true,
    )
  if (transition.sourceClosed) result = (await recoverAutomationSource(transition)) ?? result
  else if (session === transition.action.active) publish(transition.previousState)
  return result
}

function captureAutomationProjectAction(
  expectedProject: AutomationProjectExpectation,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    return automationProjectFailure("cancelled", "The project action was cancelled.")
  const action = captureProjectAction()
  const database = activeDatabase
  if (!action || !database)
    return automationProjectFailure(
      "project-action-blocked",
      "Finish the active edit, save, or AI operation before switching projects.",
      true,
    )
  if (action.id !== expectedProject.documentId || action.revision !== expectedProject.revision)
    return automationProjectFailure(
      "stale-revision",
      "The active project changed before this action.",
      true,
    )
  return { ok: true as const, action, database }
}

async function switchAutomationProject(
  request: AutomationProjectRequest,
  expectedProject: AutomationProjectExpectation,
  signal?: AbortSignal,
  requireWritable = true,
): Promise<AutomationProjectResult> {
  const captured = captureAutomationProjectAction(expectedProject, signal)
  if (!captured.ok) return captured
  const { action, database } = captured
  if (request.kind === "open" && request.documentId === action.id)
    return automationProjectValue(action.active, requireWritable)
  const transition: AutomationProjectTransition = {
    action,
    database,
    previousState: state,
    prepared: null,
    sourceClosed: false,
    selectionChanged: false,
    signal,
    requireWritable,
  }
  publish({ ...state, saveStatus: "saving", diagnostic: null })
  let result: AutomationProjectResult
  try {
    const target = await prepareAutomationTarget(transition, request)
    if (target.ok) {
      transition.prepared = target
      result = await activateAutomationTarget(transition, target)
    } else result = automationProjectDiagnostic(target.diagnostic)
  } catch {
    result = automationProjectFailure(
      "persistence-failed",
      "The project action could not be completed.",
      true,
    )
  }
  return result.ok ? result : rollbackAutomationTransition(transition, result)
}

export async function createAutomationProject(
  name: string,
  expectedProject: AutomationProjectExpectation,
  signal?: AbortSignal,
  actor: CommandActor = { type: "user", userId: null },
): Promise<AutomationProjectResult> {
  const parsed = documentNameInputSchema.safeParse(name)
  if (!parsed.success)
    return automationProjectFailure("invalid-input", "The project name is invalid.")
  return switchAutomationProject(
    { kind: "create", documentId: createBrowserDocumentId(), name: parsed.data, actor },
    expectedProject,
    signal,
  )
}

export async function openAutomationProject(
  documentIdInput: string,
  expectedProject: AutomationProjectExpectation,
  signal?: AbortSignal,
): Promise<AutomationProjectResult> {
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (!documentId.success)
    return automationProjectFailure("invalid-input", "The project ID is invalid.")
  return switchAutomationProject(
    { kind: "open", documentId: documentId.data },
    expectedProject,
    signal,
  )
}

export async function activateLocalProject(
  documentIdInput: unknown,
  expectedProject?: AutomationProjectExpectation,
): Promise<ProjectSwitchResult> {
  const action = captureProjectAction()
  if (!action) return projectActionUnavailable()
  const documentId = documentIdSchema.safeParse(documentIdInput)
  if (!documentId.success)
    return {
      ok: false,
      diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
    }
  const result = await switchAutomationProject(
    { kind: "open", documentId: documentId.data },
    expectedProject ?? { documentId: action.id, revision: action.revision },
    undefined,
    false,
  )
  return result.ok ? { ok: true } : result
}

export async function createNewLocalProject(): Promise<ProjectSwitchResult> {
  const action = captureProjectAction()
  if (!action) return projectActionUnavailable()
  const result = await createAutomationProject(defaultProjectName, {
    documentId: action.id,
    revision: action.revision,
  })
  return result.ok ? { ok: true } : result
}

export async function deleteLocalProject(
  documentIdInput: unknown,
  expectedHeadRevision: number,
): Promise<ProjectDeleteResult> {
  if (!session || !activeRepository || getProjectActionBlock()) {
    return projectActionUnavailable()
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
  if (portable.value.project.snapshot.revision !== expectedHeadRevision) {
    return {
      ok: false,
      diagnostic: { code: "stale-revision", message: "The project changed before it was copied." },
    }
  }

  const copiedAt = new Date().toISOString()
  const copied = copyBrowserPortableProject({
    source: portable.value,
    documentId: documentIdSchema.parse(browserUuidV7()),
    name,
    issuedAt: copiedAt,
    nextCommandId: browserUuidV7,
    nextTransactionId: () => draftIdSchema.parse(browserUuidV7()),
  })
  if (!copied.ok) return { ok: false, diagnostic: copied.diagnostic }

  const stored = await activeRepository.copyPortableProject(copied.value, copiedAt)
  if (!stored.ok) return { ok: false, diagnostic: stored.diagnostic }
  await activeRepository.copyProjectThumbnail({
    sourceDocumentId: documentId.data,
    sourceRevision: expectedHeadRevision,
    targetDocumentId: stored.value.documentId,
    targetRevision: stored.value.revision,
    generatedAt: copiedAt,
  })
  return { ok: true, documentId: stored.value.documentId, name: copied.value.project.snapshot.name }
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
