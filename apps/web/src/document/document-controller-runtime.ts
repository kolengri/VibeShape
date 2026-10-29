import { openAuthorityDocumentSession } from "@vibeshape/application/authority-document-session"
import { createAuthorityPersistenceAdapter } from "@vibeshape/application/authority-persistence-adapter"
import { prepareAuthorityMetadataCommand } from "@vibeshape/application/authority-persistence-operations"
import {
  createDisposableDocumentPreview,
  type DisposableDocumentPreview,
} from "@vibeshape/application/disposable-document-preview"
import { createModelBodyTopologyEvidence } from "@vibeshape/application/model-body-topology"
import { createModelDiagnosticsEvidence } from "@vibeshape/application/model-diagnostics"
import { createModelEdgeEvidence } from "@vibeshape/application/model-edges"
import {
  createModelBodyMeasurementEvidence,
  createModelMeasurementEvidence,
} from "@vibeshape/application/model-measurements"
import {
  createPersistentDocumentSession,
  type DocumentHistoryCheckpoint,
  type DocumentHistoryPreview,
  type PersistentDocumentHistoryResult,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSession,
  type PersistentDocumentSessionDiagnostic,
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
  ModelDependenciesQuery,
  ModelEdgeQuery,
  ModelMeasurementQuery,
  ModelVariableUsageQuery,
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
import { prepareAuthoredHistoryMove } from "@vibeshape/automation-host/history-move-proposal"
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
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
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
import { applyDocumentV3Command } from "@vibeshape/domain/document-v3-commands"
import { documentSnapshotV4Schema, promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { applyDocumentV4AuthoredCommand } from "@vibeshape/domain/document-v4-commands"
import {
  historyRemoveRetainingDependentsCommandSchema,
  historyRepairCommandSchema,
} from "@vibeshape/domain/document-v5-command-schemas"
import { applyDocumentV5AuthoredCommand } from "@vibeshape/domain/document-v5-commands"
import { documentV6MetadataCommandSchema } from "@vibeshape/domain/document-v6-command-schemas"
import { applyDocumentV6AuthoredCommand } from "@vibeshape/domain/document-v6-commands"
import type { DocumentDraft, DraftCommitResult } from "@vibeshape/domain/drafts"
import type { MoveHistoryItemCommand } from "@vibeshape/domain/history-document-commands"
import type { DocumentId, FeatureId } from "@vibeshape/domain/identifiers"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import type { SetPartAppearanceChange } from "@vibeshape/domain/part-appearance"
import type { SourceAssetBlob } from "@vibeshape/domain/source-assets"
import type { SurfaceTextureLayer } from "@vibeshape/domain/surface-textures"
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
import {
  assemblyPortFailure,
  createBrowserAssemblyAutomationSession,
} from "../automation/assembly-automation-session"
import { assemblyInspectionView } from "../automation/assembly-inspection-view"
import {
  createAutomationReviewController,
  isImportReview,
  isPlanarImportReview,
} from "../automation/automation-review-state"
import { createBinaryExportSession } from "../automation/binary-export-session"
import { createConnectedAssistantReviews } from "../automation/connected-assistant-reviews"
import { createDocumentAutomationSession } from "../automation/document-automation-session"
import { createBrowserHistoryAutomationSession } from "../automation/history-automation-session"
import {
  createHistoryMoveAutomationSession,
  historyMoveReviewedInputMatches,
} from "../automation/history-move-automation-session"
import { createImportAutomationSession } from "../automation/import-automation-session"
import type { ImportReviewedCommit, ImportReviewInput } from "../automation/import-upload-session"
import { createBrowserLightweightingAutomationSession } from "../automation/lightweighting-automation-session"
import { createMetadataAutomationSession } from "../automation/metadata-automation-session"
import { createNumericalJobSession } from "../automation/numerical-job-session"
import { createPlanarImportAutomationSession } from "../automation/planar-import-automation-session"
import type {
  PlanarImportReviewedCommit,
  PlanarImportReviewInput,
} from "../automation/planar-import-upload-session"
import { createBrowserPrintOptimizationAutomationSession } from "../automation/print-optimization-automation-session"
import { createBrowserQuickLightweightingAutomationSession } from "../automation/quick-lightweighting-automation-session"
import {
  previewOwnedSurfaceTextures,
  surfaceTextureReviewedInputMatches,
} from "../automation/surface-texture-automation-preview"
import { createBrowserSurfaceTextureAutomationSession } from "../automation/surface-texture-automation-session"
import { createAssemblyTransaction } from "../features/assembly/assembly-model"
import { lightweightingSource } from "../features/lightweighting/lightweighting-model"
import { prepareDocumentPrint } from "../printing/prepare-document-print"
import { AssemblyInspectionSession } from "./assembly-inspection-session"
import { AssistantCheckpointBaselines } from "./assistant-checkpoint-baselines"
import type { AssistantCheckpointPresentation } from "./assistant-checkpoint-presentation"
import { createBrowserPart, enableAuthoredDocument } from "./authored-document-session"
import { createAutomationLibraryPort } from "./browser-library-repository"
import { BrowserProjectRepository } from "./browser-project-repository"
import { prepareDocumentGeometryExport } from "./document-geometry-export"
import { PRODUCT_MESH_POLICY } from "./document-worker-settings"
import { reconcileHistoryInsertion } from "./history-insertion"
import { captureLibrarySource } from "./library-source"
import { createProjectActionGuard } from "./project-action-guard"
import { exportProjectBackup } from "./project-backup-client"
import type { ProjectBackupStage } from "./project-backup-contract"
import { prepareProjectDuplicate, prepareProjectImport } from "./project-import-client"
import type { PreparedProjectImport } from "./project-import-contract"
import { type ProjectNavigationError, readProjectUrl } from "./project-navigation"
import { materializeDocumentSourceAssets } from "./source-assets-rebuild"
import { formatProjectCopyName } from "./versioned-project-file"

type ControllerStatus = "idle" | "loading" | "library" | "ready" | "error"
type SaveStatus = "saved" | "saving" | "save-error"

export type DocumentControllerState = Readonly<{
  assistantCheckpointPresentation?: AssistantCheckpointPresentation | null
  status: ControllerStatus
  openingProjectId?: DocumentSnapshot["id"]
  report: PersistentDocumentSessionReport | null
  authoredSnapshot?: DocumentAuthoritySnapshot | null
  saveStatus: SaveStatus
  diagnostic: PersistentDocumentSessionDiagnostic | null
  projectNavigationError?: ProjectNavigationError | null
  history?: Readonly<{ canUndo: boolean; canRedo: boolean }>
  historyInsertion?: Readonly<{
    documentId: DocumentSnapshot["id"]
    baseRevision: number
    historyAfter: HistoryItemRef | null
  }> | null
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

type ProjectImportResult =
  | { ok: true; documentId: ReturnType<typeof documentIdSchema.parse> }
  | { ok: false; diagnostic: { code: string; message: string } }

type LocalProjectListResult =
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
type ProjectThumbnailWriteResult = ProjectSwitchResult

type ProjectDuplicateResult =
  | {
      ok: true
      documentId: ReturnType<typeof documentIdSchema.parse>
      name: string
    }
  | { ok: false; diagnostic: { code: string; message: string } }
export type DocumentRuntimeOptions = Readonly<{
  initialProject?: {
    documentId: DocumentSnapshot["id"]
    create?: boolean
    name?: string
    actor?: CommandActor
  } | null
  progressiveOpening?: boolean
  reviews?: ReturnType<typeof createAutomationReviewController>
}>
export function createDocumentControllerRuntime(options: DocumentRuntimeOptions = {}) {
  const assemblyInspection = new AssemblyInspectionSession((documentId) =>
    createDocumentWorkerSession(documentId, { retryRecoverableFailure: false }),
  )
  const automationReviews = options.reviews ?? createAutomationReviewController()

  const DATABASE_NAME = "vibeshape-product-v0"
  const DOCUMENT_STORAGE_KEY = "vibeshape-active-document-id"
  const SESSION_STORAGE_KEY = "vibeshape-browser-session-id"

  function setHistoryInsertionPoint(historyAfter: HistoryItemRef | null | undefined) {
    const report = state.report
    if (historyAfter === undefined) {
      publish({ ...state, historyInsertion: null })
      return
    }
    if (report?.mode !== "read-write" || state.saveStatus === "saving") return
    publish({
      ...state,
      historyInsertion: {
        documentId: report.snapshot.id,
        baseRevision: report.snapshot.revision,
        historyAfter,
      },
    })
  }

  let state: DocumentControllerState = {
    status: "idle",
    ...(options.initialProject ? { openingProjectId: options.initialProject.documentId } : {}),
    report: null,
    saveStatus: "saved",
    diagnostic: null,
  }
  let openingPreview = options.progressiveOpening === true
  let session: PersistentDocumentSession | null = null
  let activeRepository: BrowserProjectRepository | null = null
  let activeDatabase: VibeShapeDatabase | null = null
  let defaultProjectName = "Untitled project"
  let startPromise: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const projectActionGuard = createProjectActionGuard()
  const registerProjectActionGuard = projectActionGuard.register
  let projectPreparation: { abort: AbortController; current: () => boolean } | null = null
  let checkpointPreview: DisposableDocumentPreview | null = null
  let checkpointPreviewAbort: AbortController | null = null
  let checkpointPreviewEpoch = 0
  let checkpointPreviewBase: {
    documentId: string
    revision: number
    handle: DocumentHistoryCheckpoint
    session: PersistentDocumentSession
  } | null = null
  const checkpointBaselines = new AssistantCheckpointBaselines<PersistentDocumentSession>(
    64 * 1024 * 1024,
    (handle) => checkpointPreviewBase?.handle === handle,
  )

  function invalidateAssistantCheckpointPreview() {
    checkpointPreviewEpoch += 1
    checkpointPreview?.dispose()
    checkpointPreview = null
    checkpointPreviewAbort?.abort()
    checkpointPreviewAbort = null
    checkpointPreviewBase = null
  }

  function clearAssistantCheckpointPreview() {
    invalidateAssistantCheckpointPreview()
    if (state.assistantCheckpointPresentation)
      publish({ ...state, assistantCheckpointPresentation: null })
  }

  function dismissProjectNavigationError() {
    publish({ ...state, projectNavigationError: null })
  }

  function setProjectNavigationError(projectNavigationError: ProjectNavigationError) {
    publish({ ...state, projectNavigationError })
  }

  function getProjectActiveWorkBlock() {
    const review = automationReviews.getSnapshot()
    if (review && review.status !== "error") return "automation-busy" as const
    return projectActionGuard.read()
  }

  function getProjectActionBlock() {
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

  function captureProjectCatalogAction() {
    const active = captureProjectAction()
    if (active) return active
    if (
      state.status !== "library" ||
      state.saveStatus !== "saved" ||
      session ||
      !activeRepository ||
      getProjectActiveWorkBlock()
    )
      return null
    const repository = activeRepository
    return {
      repository,
      current: (saveStatus: SaveStatus = "saved") =>
        state.status === "library" &&
        state.saveStatus === saveStatus &&
        session === null &&
        activeRepository === repository &&
        !getProjectActiveWorkBlock(),
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

  function checkpointPreviewStale(next: DocumentControllerState) {
    const base = checkpointPreviewBase
    if (!base) return false
    return (
      session !== base.session ||
      next.status !== "ready" ||
      next.saveStatus === "saving" ||
      next.report?.snapshot.id !== base.documentId ||
      next.report.snapshot.revision !== base.revision
    )
  }

  function releaseInactiveCheckpointBaselines(next: DocumentControllerState) {
    if (next.status !== "ready") checkpointBaselines.clear()
    else checkpointBaselines.pruneOwner(session)
  }

  function publish(next: DocumentControllerState) {
    releaseInactiveCheckpointBaselines(next)
    if (checkpointPreviewStale(next)) {
      invalidateAssistantCheckpointPreview()
      next = { ...next, assistantCheckpointPresentation: null }
    }
    state = {
      ...next,
      historyInsertion: reconcileHistoryInsertion(state, next),
      authoredSnapshot: session?.authoredSnapshot ?? null,
      history: session?.history ?? { canUndo: false, canRedo: false },
    }
    if (projectPreparation && !projectPreparation.current()) projectPreparation.abort.abort()
    assemblyInspection.retain(state.authoredSnapshot)
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

  function resolveDocumentFeatureParameters(document: DocumentSnapshot) {
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
      createRebuildPort: (documentId: ReturnType<typeof documentIdSchema.parse>) => {
        const worker = createDocumentWorkerSession(documentId, {
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
        })
        const rebuild = worker.rebuild.bind(worker)
        worker.rebuild = (input, requestOptions) =>
          rebuild(
            openingPreview
              ? { ...input, mesh: { chordTolerance: 0.5, angularTolerance: 0.5 } }
              : input,
            requestOptions,
          )
        return worker
      },
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

  function initializeProjectRepository() {
    const database = activeDatabase ?? new VibeShapeDatabase(DATABASE_NAME)
    activeDatabase = database
    const repository = activeRepository ?? new BrowserProjectRepository(database)
    activeRepository = repository
    return { database, repository }
  }

  async function initializeProjectController() {
    const { database, repository } = initializeProjectRepository()
    if (options.initialProject === null) return { ok: true as const, library: true as const }
    if (options.initialProject) {
      const initial = options.initialProject
      if (initial.create)
        return enableAuthoredDocument(
          await createPersistentDocumentSession(browserProjectDependencies(database, repository), {
            sessionId: currentSessionId(),
            mesh: PRODUCT_MESH_POLICY,
            command: createCommand(
              initial.documentId,
              initial.name ?? defaultProjectName,
              initial.actor,
            ),
          }),
        )
      return openControllerProject(database, repository, initial.documentId)
    }
    const requested = readProjectUrl(window.location.href)
    if (requested.kind === "invalid")
      return {
        ok: false as const,
        diagnostic: {
          code: "persistence-failed" as const,
          message: "The project URL must contain exactly one valid project ID.",
          retryable: false,
          sourceCode: "invalid-project-url",
        },
      }
    if (requested.kind === "project") {
      openingPreview = true
      publish({ ...state, openingProjectId: requested.documentId })
      return openControllerProject(database, repository, requested.documentId)
    }
    return { ok: true as const, library: true as const }
  }

  function publishProjectLibrary() {
    session = null
    publish({
      status: "library",
      report: null,
      saveStatus: "saved",
      diagnostic: null,
      historyInsertion: null,
      projectNavigationError: null,
    })
  }

  function openingReportDiagnostic(report: PersistentDocumentSessionReport) {
    if (report.writeAccessDiagnostic) return report.writeAccessDiagnostic
    return report.rebuild && !report.rebuild.ok
      ? report.rebuild.diagnostic
      : report.writeAccessDiagnostic
  }

  async function refineOpeningReport(
    report: PersistentDocumentSessionReport,
    active: PersistentDocumentSession,
  ) {
    const refine = openingPreview && report.rebuild?.ok && report.snapshot.features.length > 0
    openingPreview = false
    if (!refine) return report
    publish({
      status: "loading",
      openingProjectId: report.snapshot.id,
      report,
      saveStatus: "saved",
      diagnostic: report.writeAccessDiagnostic,
    })
    const rebuild = await active.retryRebuild()
    return { ...report, rebuild }
  }

  async function start() {
    publish({ ...state, status: "loading", diagnostic: null })
    try {
      const result = await initializeProjectController()
      if (!result.ok) {
        const requested = readProjectUrl(window.location.href)
        publish({
          status: "error",
          report: null,
          saveStatus: "saved",
          diagnostic: result.diagnostic,
          projectNavigationError:
            requested.kind === "default"
              ? null
              : requested.kind === "invalid"
                ? "invalid-project-url"
                : result.diagnostic.sourceCode === "document-not-found"
                  ? "document-not-found"
                  : "project-open-failed",
        })
        return
      }
      if ("library" in result) {
        publishProjectLibrary()
        return
      }
      session = result.session
      if (!options.initialProject)
        writeStoredId(localStorage, DOCUMENT_STORAGE_KEY, session.snapshot.id)
      const report = await refineOpeningReport(result.report, session)
      publish({
        status: "ready",
        report,
        saveStatus: "saved",
        diagnostic: openingReportDiagnostic(report),
      })
      // The runtime registry owns visible-project navigation.
    } catch {
      publish({
        status: "error",
        report: null,
        saveStatus: "saved",
        diagnostic: {
          code: "persistence-failed",
          message: "The local document session could not be started.",
          retryable: true,
          sourceCode: null,
        },
        projectNavigationError:
          readProjectUrl(window.location.href).kind === "default" ? null : "project-open-failed",
      })
    }
  }

  function startDocumentController(defaultDocumentName: string) {
    defaultProjectName = defaultDocumentName
    startPromise ??= start()
    return startPromise
  }

  function createBrowserVariableId() {
    return variableIdSchema.parse(browserUuidV7())
  }

  function createBrowserDocumentId() {
    return documentIdSchema.parse(browserUuidV7())
  }

  function createBrowserFeatureId() {
    return featureIdSchema.parse(browserUuidV7())
  }

  function createBrowserSketchId(): SketchId {
    return sketchIdSchema.parse(browserUuidV7())
  }

  function createBrowserSketchEntityId(): SketchEntityId {
    return sketchEntityIdSchema.parse(browserUuidV7())
  }

  function createBrowserSketchExternalReferenceId() {
    return sketchExternalReferenceIdSchema.parse(browserUuidV7())
  }

  function createBrowserSketchConstraintId(): SketchConstraintId {
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
  function createActiveDocumentAutomationSession(
    options: Readonly<{ approvalPolicy?: "connected-assistant" }> = {},
  ) {
    const active = session
    const repository = activeRepository
    if (!active || !repository || state.status !== "ready" || !state.report)
      return automationCommitFailure(
        "document-write-unavailable",
        "No local project is open.",
        true,
      )
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
    // This trusted host policy is selected by the built-in chat, never by tool arguments.
    // Exact validation, captured project authority, cancellation and persistence still run.
    const reviews =
      options.approvalPolicy === "connected-assistant"
        ? createConnectedAssistantReviews(automationReviews, sourceSessionAvailable)
        : automationReviews
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
    const factory = createDocumentAutomationSession(
      {
        materializeSourceAssets: materializeAutomationSourceAssets,
        unsupportedPreviewRepresentation(target) {
          const authority = active.authoredSnapshot
          if (!authority || authority.schemaVersion === 1) return null
          if (
            !target &&
            authority.schemaVersion >= 4 &&
            "assembly" in authority &&
            authority.assembly.instances.length
          )
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
          validateDraft: (draft, commands) =>
            validateActiveAutomationDraft(active, draft, commands),
          compareAndCommitDraft: (draft, commands) =>
            commitActiveAutomationDraft(active, draft, commands),
        },
      },
      reviews,
    )
    if (!factory.ok) return factory
    const queryDispatcher = createQueryDispatcher(
      coreRegistries().modules,
      documentCoreQueryHandlers,
    )
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
        | ModelBodyTopologyQuery
        | ModelDependenciesQuery
        | ModelVariableUsageQuery,
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
    const metadata = createMetadataAutomationSession(
      {
        materializeSourceAssets: materializeAutomationSourceAssets,
        documentId: active.snapshot.id,
        queries: queryDispatcher.dispatcher,
        createDraftId: browserUuidV7,
        readSnapshot: () => (currentReport() ? active.authoredSnapshot : null),
        hasCommandId: (commandId) => repository.hasCommandId(commandId),
        isActive: () => currentReport() !== null,
        commit: (command, expected) => commitReviewedMetadata(active, command, expected),
      },
      reviews,
    )
    const historyMoves = createHistoryMoveAutomationSession(
      {
        materializeSourceAssets: materializeAutomationSourceAssets,
        documentId: capturedDocumentId,
        queries: queryDispatcher.dispatcher,
        createDraftId: browserUuidV7,
        readSnapshot: () => (currentReport() ? active.authoredSnapshot : null),
        hasCommandId: (commandId) => repository.hasCommandId(commandId),
        isActive: sourceSessionAvailable,
        commit: (command, expected) =>
          commitReviewedHistoryMove(active, command, expected, reviews),
      },
      reviews,
    )
    function readSourceContext() {
      const snapshot = currentReport() ? active?.authoredSnapshot : null
      return snapshot && snapshot.schemaVersion !== 1
        ? {
            documentId: capturedDocumentId,
            revision: snapshot.revision,
            authorityVersion: snapshot.schemaVersion,
            historyAfter: state.report?.historyItems?.at(-1) ?? null,
            hiddenPartIds: snapshot.parts.filter((part) => !part.visible).map(({ id }) => id),
          }
        : null
    }
    const imports = createImportAutomationSession(
      {
        documentId: capturedDocumentId,
        isActive: sourceSessionAvailable,
        createId: browserUuidV7,
        readContext: readSourceContext,
        async commit(input) {
          if (!sourceSessionAvailable() || !importReviewedInputMatches(input, reviews))
            return localFailure(
              "import-review-mismatch",
              "The captured import review no longer matches.",
            )
          return commitReviewedImport(active, input, reviews)
        },
      },
      reviews,
    )
    const lightweightingConfiguration = {
      documentId: capturedDocumentId,
      isActive: sourceSessionAvailable,
      createId: browserUuidV7,
      readContext: readSourceContext,
      readSource: (partId: string) => lightweightingSource(state, partId, "full"),
      async commit(input: ImportReviewedCommit) {
        if (!sourceSessionAvailable() || !importReviewedInputMatches(input, reviews))
          return localFailure(
            "import-review-mismatch",
            "The captured lightweighting review no longer matches.",
          )
        return commitReviewedImport(active, input, reviews)
      },
    }
    const lightweighting = createBrowserLightweightingAutomationSession(
      lightweightingConfiguration,
      reviews,
    )
    const quickLightweighting = createBrowserQuickLightweightingAutomationSession(
      lightweightingConfiguration,
      reviews,
    )
    const printOptimization = createBrowserPrintOptimizationAutomationSession(
      {
        ...lightweightingConfiguration,
        geometry: { inspectGeometrySource, reconstructPrintOptimization },
      },
      reviews,
    )
    const numericalJobs = createNumericalJobSession({
      documentId: capturedDocumentId,
      createId: browserUuidV7,
      isActive: sourceSessionAvailable,
      execute: (actor, operation, signal) =>
        operation.tool === "analyze_lightweighting" || operation.tool === "request_lightweighting"
          ? lightweighting.execute(actor, operation, signal)
          : operation.tool === "analyze_print_optimization" ||
              operation.tool === "request_print_optimization"
            ? printOptimization.execute(actor, operation, signal)
            : quickLightweighting.execute(actor, operation, signal),
    })
    const planarImports = createPlanarImportAutomationSession(
      {
        documentId: capturedDocumentId,
        isActive: sourceSessionAvailable,
        createId: browserUuidV7,
        readContext: readSourceContext,
        async commit(input) {
          if (!sourceSessionAvailable() || !planarImportReviewedInputMatches(input, reviews))
            return localFailure(
              "planar-import-review-mismatch",
              "The captured planar import review no longer matches.",
            )
          return commitReviewedPlanarImport(active, input, reviews)
        },
      },
      reviews,
    )
    const assembly = createBrowserAssemblyAutomationSession(
      {
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
        commit: (input) => commitReviewedAssembly(active, input, reviews),
      },
      reviews,
    )
    const history = createBrowserHistoryAutomationSession(
      {
        documentId: capturedDocumentId,
        isActive: sourceSessionAvailable,
        readSnapshot: () => (sourceSessionAvailable() ? active.snapshot : null),
        availability: () => active.history,
        readTarget: (direction, targetRevision) =>
          sourceSessionAvailable() ? active.previewHistory(direction, targetRevision) : null,
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
          if (
            target.authority.schemaVersion !== 4 &&
            target.authority.schemaVersion !== 5 &&
            target.authority.schemaVersion !== 6
          )
            return undefined
          const result = await inspectCapturedAssembly(
            { active, repository, authority: promoteDocumentSnapshotV4(target.authority) },
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
        commit: (input) => commitReviewedHistory(active, input, reviews),
      },
      reviews,
    )
    function texturePreviewAvailable(input: SurfaceTextureReviewedInput) {
      if (
        !sourceSessionAvailable() ||
        capturedSession.snapshot.revision !== input.draft.baseRevision ||
        assemblyEditorDraftBlock()
      )
        return false
      const review = reviews.getSnapshot()
      return (
        !review || review.status === "error" || surfaceTextureReviewedInputMatches(review, input)
      )
    }
    const surfaceTextures = createBrowserSurfaceTextureAutomationSession(
      {
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
              return localFailure(
                "stale-revision",
                "The texture source changed during preview.",
                true,
              )
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
            ? commitReviewedSurfaceTexture(active, input, reviews)
            : Promise.resolve(
                localFailure("session-revoked", "The texture source session is unavailable."),
              ),
      },
      reviews,
    )
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
        historyMoves.cancel("stale-revision")
        imports.cancel("stale-revision")
        planarImports.cancel("stale-revision")
        assembly.cancel("stale-revision")
        history.cancel("stale-revision")
        surfaceTextures.cancel("stale-revision")
        numericalJobs.cancel()
        lightweighting.cancel()
        quickLightweighting.cancel()
        printOptimization.cancel()
      }
    })
    function dispose() {
      if (closed) return
      closed = true
      unsubscribe()
      window.removeEventListener("pagehide", dispose)
      const failures: unknown[] = []
      for (const release of [
        closeAutomation,
        () => metadata.dispose(),
        () => historyMoves.dispose(),
        () => imports.dispose(),
        () => planarImports.dispose(),
        () => assembly.dispose(),
        () => history.dispose(),
        () => surfaceTextures.dispose(),
        () => numericalJobs.dispose(),
        () => lightweighting.dispose(),
        () => quickLightweighting.dispose(),
        () => printOptimization.dispose(),
        () => exports.dispose(),
      ]) {
        try {
          release()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) throw failures[0]
    }
    window.addEventListener("pagehide", dispose, { once: true })
    return {
      ok: true as const,
      documentId: active.snapshot.id,
      get revision() {
        return active.snapshot.revision
      },
      host: factory.host,
      faceAlignment: factory.faceAlignment,
      measurements: {
        ...factory.faceAlignment,
        readCommittedContext: () => {
          const report = currentReport()
          return report ? { snapshot: active.snapshot, rebuild: report.rebuild } : null
        },
      },
      metadata,
      historyMoves,
      imports,
      planarImports,
      assembly,
      history,
      surfaceTextures,
      lightweighting,
      quickLightweighting,
      printOptimization,
      numericalJobs,
      exports,
      enableAutoApply: (actor: unknown) =>
        currentReport() !== null && factory.enableAutoApply(actor),
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
        historyMoves.cancel(reason)
        imports.cancel(reason)
        planarImports.cancel(reason)
        assembly.cancel(reason)
        history.cancel(reason)
        surfaceTextures.cancel(reason)
        numericalJobs.cancel()
        lightweighting.cancel()
        quickLightweighting.cancel()
        printOptimization.cancel()
        exports.cancel()
      },
      dispose,
    }
  }

  async function applyVariableTable(
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
    checkpoint?: DocumentHistoryCheckpoint,
  ): Promise<PersistentDocumentHistoryResult> {
    publish({ ...state, saveStatus: "saving", diagnostic: null })
    try {
      const result = checkpoint
        ? await activeSession.restoreHistoryCheckpoint(checkpoint, request)
        : await activeSession.navigateHistory(request)
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

  function undoDocument(baseRevision: number) {
    return navigateDocumentHistory("undo", baseRevision)
  }

  function createAssistantCheckpointPort() {
    if (!session || !activeRepository || state.status !== "ready") return null
    const active = session
    const repository = activeRepository
    const documentId = active.snapshot.id
    const available = () =>
      session === active && state.status === "ready" && active.snapshot.id === documentId
    const matches = (handle: DocumentHistoryCheckpoint, revision: number) => {
      const checkpoint = active.readHistoryCheckpoint(handle)
      return checkpoint?.changed === true && checkpoint.revision === revision
    }
    function previewTarget(handle: DocumentHistoryCheckpoint, revision: number) {
      if (!available() || state.saveStatus === "saving" || assemblySourceCaptureBlock()) return null
      return matches(handle, revision) ? active.previewHistoryCheckpoint(handle) : null
    }
    function createCheckpointPreview(target: DocumentHistoryPreview, current: () => boolean) {
      return createDisposableDocumentPreview({
        mesh: PRODUCT_MESH_POLICY,
        retainRebuild: true,
        createRebuildPort: (id) =>
          createDocumentWorkerSession(id, {
            materializeSourceAssets: async () => {
              if (!current()) throw new Error("The internal checkpoint source changed.")
              const assets = await repository.materializeCapturedSourceAssets(target.authority)
              if (!current()) throw new Error("The internal checkpoint source changed.")
              return assets
            },
          }),
      })
    }
    async function previewCheckpointAssembly(
      target: DocumentHistoryPreview,
      revision: number,
      signal: AbortSignal,
    ) {
      const authority = target.authority
      if (
        authority.schemaVersion !== 4 &&
        authority.schemaVersion !== 5 &&
        authority.schemaVersion !== 6
      )
        return null
      if (!authority.assembly.instances.length) return null
      const result = await inspectCapturedAssembly(
        { active, repository, authority: promoteDocumentSnapshotV4(authority) },
        [],
        [],
        revision,
        signal,
      )
      return result.inspection
    }
    function finishCheckpointPreview(preview: DisposableDocumentPreview | null, epoch: number) {
      preview?.dispose()
      if (checkpointPreview === preview) checkpointPreview = null
      if (epoch === checkpointPreviewEpoch && !state.assistantCheckpointPresentation)
        clearAssistantCheckpointPreview()
    }
    function retainCheckpointBaseline(
      handle: DocumentHistoryCheckpoint,
      report: PersistentDocumentSessionReport,
    ) {
      try {
        if (!report.rebuild.ok) return
        const diagnostics = createModelDiagnosticsEvidence(report.snapshot, report.rebuild)
        if (!diagnostics.ok || diagnostics.evidence.status !== "valid") return
        if (
          !report.rebuild.response.evaluation.records.every(
            (record) => record.status !== "failed" && record.status !== "blocked",
          )
        )
          return
        checkpointBaselines.set(handle, {
          session: active,
          snapshot: canonicalJson(report.snapshot),
          authority: canonicalJson(active.authoredSnapshot ?? report.snapshot),
          // Cache admission owns the copy; budget misses retain the cold-worker fallback.
          rebuild: report.rebuild.response,
        })
      } catch {
        // A baseline without retainable exact evidence still uses the isolated worker fallback.
      }
    }
    function captureCheckpoint(acceptsActor: (actor: CommandActor) => boolean) {
      if (!available() || state.saveStatus === "saving" || active.hasPendingOperations) return null
      const handle = active.captureHistoryCheckpoint(acceptsActor)
      const report = state.report
      if (handle && report?.snapshot === active.snapshot) retainCheckpointBaseline(handle, report)
      return handle
    }
    function retainedCheckpointRebuild(
      handle: DocumentHistoryCheckpoint,
      target: DocumentHistoryPreview,
    ) {
      const baseline = checkpointBaselines.get(handle)
      return baseline?.session === active &&
        baseline.snapshot === canonicalJson(target.snapshot) &&
        baseline.authority === canonicalJson(target.authority)
        ? baseline.rebuild
        : null
    }
    return {
      subscribe: subscribeDocumentController,
      isSettled: () => available() && state.saveStatus !== "saving" && !active.hasPendingOperations,
      settleAccepted: async () => {
        const revision = await active.settleAcceptedOperations()
        return available() ? revision : null
      },
      capture: captureCheckpoint,
      read: (handle: DocumentHistoryCheckpoint) =>
        available() ? active.readHistoryCheckpoint(handle) : null,
      release: (handle: DocumentHistoryCheckpoint) => {
        checkpointBaselines.delete(handle)
        active.releaseHistoryCheckpoint(handle)
        if (checkpointPreviewBase?.handle === handle) clearAssistantCheckpointPreview()
      },
      seal: (handle: DocumentHistoryCheckpoint, revision: number) =>
        available() && active.sealHistoryCheckpoint(handle, revision),
      clearPreview: clearAssistantCheckpointPreview,
      isViewingBefore: (handle: DocumentHistoryCheckpoint) =>
        checkpointPreviewBase?.handle === handle &&
        state.assistantCheckpointPresentation !== null &&
        state.assistantCheckpointPresentation !== undefined,
      async viewBefore(handle: DocumentHistoryCheckpoint, revision: number) {
        const target = previewTarget(handle, revision)
        if (!target) return false
        clearAssistantCheckpointPreview()
        checkpointPreviewBase = { documentId, revision, handle, session: active }
        const epoch = checkpointPreviewEpoch,
          abort = new AbortController()
        checkpointPreviewAbort = abort
        const current = () =>
          epoch === checkpointPreviewEpoch &&
          available() &&
          active.snapshot.revision === revision &&
          matches(handle, revision)
        let preview: DisposableDocumentPreview | null = null
        try {
          let rebuild = retainedCheckpointRebuild(handle, target)
          if (!rebuild) {
            preview = createCheckpointPreview(target, current)
            checkpointPreview = preview
            const result = await preview.preview(target.snapshot)
            if (!result.ok || !result.valid || !result.rebuild) return false
            rebuild = result.rebuild
          }
          if (!current()) return false
          const assembly = await previewCheckpointAssembly(target, revision, abort.signal)
          if (!current()) return false
          publish({
            ...state,
            assistantCheckpointPresentation: {
              kind: "assistant-checkpoint",
              documentId,
              baseRevision: revision,
              target,
              rebuild,
              assembly,
            },
          })
          return true
        } catch {
          return false
        } finally {
          finishCheckpointPreview(preview, epoch)
        }
      },
      async restore(handle: DocumentHistoryCheckpoint, revision: number) {
        const review = automationReviews.getSnapshot()
        if (
          !available() ||
          state.saveStatus === "saving" ||
          assemblyEditorDraftBlock() ||
          (review && review.status !== "error")
        )
          return false
        const checkpoint = active.readHistoryCheckpoint(handle)
        if (!checkpoint?.changed || checkpoint.revision !== revision) return false
        clearAssistantCheckpointPreview()
        const result = await publishHistoryNavigation(
          active,
          historyRequestSchema.parse({
            direction: "undo",
            commandId: browserUuidV7(),
            documentId,
            baseRevision: revision,
            issuedAt: new Date().toISOString(),
            actor: { type: "user", userId: null },
          }),
          handle,
        )
        return result.ok
      },
    }
  }

  function redoDocument(baseRevision: number) {
    return navigateDocumentHistory("redo", baseRevision)
  }

  function canWriteAuthoredMetadata(active: PersistentDocumentSession | null) {
    return authoredMetadataWriteBlock(active) === null
  }

  function authoredMetadataWriteBlock(active: PersistentDocumentSession | null) {
    if (!active || state.status !== "ready" || state.report === null)
      return "document-unavailable" as const
    if (active.mode !== "read-write") return "read-only" as const
    if (state.saveStatus === "saving") return "save-in-progress" as const
    return getProjectActiveWorkBlock()
  }

  function authoredMetadataBlockedResult(
    sourceCode: NonNullable<ReturnType<typeof authoredMetadataWriteBlock>>,
  ) {
    const messages = {
      "document-unavailable": "Reopen the project before changing parts or folders.",
      "read-only": "Open the document with write access before changing parts or folders.",
      "save-in-progress": "Wait for saving to finish before changing parts or folders.",
      "editor-draft": "Finish or cancel the active edit before changing parts or folders.",
      "surface-texture-draft":
        "Finish or cancel the surface texture edit before changing parts or folders.",
      "automation-busy":
        "Wait for the AI operation or review to finish before changing parts or folders.",
    }
    return {
      ok: false as const,
      diagnostic: {
        code: "command-rejected" as const,
        message: messages[sourceCode],
        retryable: true,
        sourceCode,
      },
    }
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

  function planarImportReviewedInputMatches(
    input: PlanarImportReviewedCommit,
    reviews = automationReviews,
  ) {
    const review = reviews.getSnapshot()
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
    reviews = automationReviews,
  ) {
    if (
      !reviewedMetadataBase(active, input.draft.baseRevision) ||
      active.snapshot.id !== input.draft.documentId ||
      projectActionGuard.read((block) => block !== "automation-busy") ||
      !planarImportReviewedInputMatches(input, reviews)
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

  function importReviewedInputMatches(input: ImportReviewedCommit, reviews = automationReviews) {
    const review = reviews.getSnapshot()
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
      lightweighting: input.lightweighting ?? null,
      quickLightweighting: input.quickLightweighting ?? null,
      printOptimization: input.printOptimization ?? null,
      transaction: input.transaction,
    })
  }

  async function commitReviewedImport(
    active: PersistentDocumentSession,
    input: ImportReviewedCommit,
    reviews = automationReviews,
  ) {
    if (
      !reviewedMetadataBase(active, input.draft.baseRevision) ||
      active.snapshot.id !== input.draft.documentId ||
      projectActionGuard.read((block) => block !== "automation-busy") ||
      !importReviewedInputMatches(input, reviews)
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

  async function commitReviewedHistoryMove(
    active: PersistentDocumentSession,
    command: MoveHistoryItemCommand,
    expected: AuthoredDocumentSnapshot,
    reviews = automationReviews,
  ) {
    const base = reviewedMetadataBase(active, command.baseRevision)
    if (
      !base ||
      command.documentId !== base.id ||
      projectActionGuard.read((block) => block !== "automation-busy") ||
      !historyMoveReviewedInputMatches(reviews.getSnapshot(), command, expected)
    )
      return localFailure(
        "stale-revision",
        "The exact History move review or writable base is no longer current.",
        true,
      )
    const replayed = prepareAuthoredHistoryMove(base, command)
    if (!replayed.ok || canonicalJson(replayed.snapshot) !== canonicalJson(expected))
      return localFailure(
        "draft-commit-intent-mismatch",
        "The reviewed History move does not match its authored target.",
      )
    publish({ ...state, saveStatus: "saving", diagnostic: null })
    const result = await active.moveHistoryItem(command)
    publishAuthoredResult(active, result)
    return result.ok
      ? {
          documentId: command.documentId,
          commandId: command.commandId,
          baseRevision: command.baseRevision,
          revision: result.snapshot.revision,
          ...command.payload,
        }
      : localFailure(
          result.diagnostic.sourceCode ?? result.diagnostic.code,
          result.diagnostic.message,
          result.diagnostic.retryable,
        )
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
    const replayed = prepareAuthorityMetadataCommand(base, command)
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

  async function inspectGeometrySource(input: unknown) {
    const active = session
    if (!active) throw new Error("The document session is unavailable.")
    const result = await active.inspectSourceImport(input)
    if (!result.ok) throw new Error(result.diagnostic.message)
    return result.value
  }

  async function reconstructPrintOptimization(input: unknown) {
    const active = session
    const revision = active?.authoredSnapshot?.revision
    if (!active || revision === undefined) throw new Error("The document session is unavailable.")
    const result = await active.reconstructPrintOptimization(input)
    assertAuthorityCurrent(active, revision)
    if (!result.ok) throw new Error(result.diagnostic.message)
    return result.value
  }

  async function inspectTriangleMeshSource(input: unknown) {
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

  async function inspectActiveAssembly(
    pairs: readonly { leftInstanceId: string; rightInstanceId: string }[] = [],
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; inspection: AssemblyInspection }
    | { ok: false; diagnostic: { code: string; message: string; retryable: boolean } }
  > {
    try {
      return await inspectCapturedAssembly(captureAssemblyContext(), pairs, [], undefined, signal)
    } catch (error) {
      return assemblyFailure(error, "Assembly inspection")
    }
  }

  /** Validates disposable mate geometry before a revision-safe authored transaction. */
  async function previewAssemblyChanges(
    changes: readonly AssemblyMutation[],
    revision: number,
    ownedBlobs: readonly SourceAssetBlob[] = [],
    signal?: AbortSignal,
  ) {
    try {
      if (signal?.aborted) throw new Error("Assembly preview was cancelled.")
      const context = captureAssemblyContext()
      if (context.authority.revision !== revision)
        throw new Error("The assembly preview revision is stale.")
      const captured = captureAssemblyMutations(
        context.authority,
        context.authority.assembly,
        changes,
      )
      const assembly = applyCapturedAssemblyMutations(context.authority.assembly, captured, {
        allowNoop: true,
      })
      const authority = documentSnapshotV4Schema.parse({
        ...context.authority,
        assets: mergeCapturedAssemblyAssets(context.authority, captured),
        assembly,
      })
      return await inspectCapturedAssembly(
        { ...context, authority },
        [],
        ownedBlobs,
        revision,
        signal,
      )
    } catch (error) {
      return assemblyFailure(error, "Assembly preview")
    }
  }

  async function inspectCapturedAssembly(
    context: ReturnType<typeof captureAssemblyContext>,
    pairs: readonly { leftInstanceId: string; rightInstanceId: string }[],
    ownedBlobs: readonly SourceAssetBlob[] = [],
    baseRevision = context.authority.revision,
    signal?: AbortSignal,
  ) {
    const { active, repository, authority } = context
    if (signal?.aborted) throw new Error("Assembly inspection was cancelled.")
    const sourceAssets = await repository.materializeAssemblySourceAssets(authority, ownedBlobs)
    if (signal?.aborted) throw new Error("Assembly inspection was cancelled.")
    assertAuthorityCurrent(active, baseRevision)
    const result = await assemblyInspection.inspect(
      authority.id,
      authority.revision,
      {
        authorityJson: canonicalJson(authority),
        sourceAssets: [...sourceAssets],
        mesh: PRODUCT_MESH_POLICY,
        interferencePairs: [...pairs],
      },
      signal,
    )
    if (signal?.aborted) throw new Error("Assembly inspection was cancelled.")
    assertAuthorityCurrent(active, baseRevision)
    return { ok: true as const, inspection: result.inspection }
  }

  async function exportActiveAssembly(
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
  async function verifyActiveFrozenDefinition(input: unknown) {
    return verifyCapturedFrozenDefinition(input, captureLibrarySourceContext())
  }

  async function verifyCapturedFrozenDefinition(
    input: unknown,
    context: ReturnType<typeof captureLibrarySourceContext>,
  ) {
    const definition = pinnedAssemblyDefinitionSchema.parse(input)
    const { active, repository, authority } = context
    const frozen = documentSnapshotV4Schema.parse({
      ...promoteDocumentSnapshotV4(authority),
      schemaVersion: 4,
      surfaceTextures: authority.schemaVersion === 2 ? [] : authority.surfaceTextures,
      assets: "assets" in authority ? authority.assets : [],
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
  function applyingHistoryReview(input: HistoryCommitInput, reviews: typeof automationReviews) {
    const visible = reviews.getSnapshot()
    return (
      visible?.status === "applying" &&
      "kind" in visible.input &&
      visible.input.kind === "history" &&
      canonicalJson(visible.input) === canonicalJson(input.review) &&
      Date.now() < Date.parse(input.review.draft.expiresAt)
    )
  }
  async function historyReviewMatches(input: HistoryCommitInput, reviews = automationReviews) {
    if (!applyingHistoryReview(input, reviews)) return false
    const target = await session?.previewHistory(
      input.review.request.direction,
      input.review.request.targetRevision,
    )
    return (
      applyingHistoryReview(input, reviews) &&
      !!target &&
      canonicalJson(target) === canonicalJson(input.target)
    )
  }

  async function commitReviewedHistory(
    active: PersistentDocumentSession,
    input: HistoryCommitInput,
    reviews = automationReviews,
  ) {
    const request = input.review.request
    if (!historyBaseWritable(active, request) || !(await historyReviewMatches(input, reviews)))
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
    reviews = automationReviews,
  ) {
    const review = reviews.getSnapshot()
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
    reviews = automationReviews,
  ) {
    const base = reviewedMetadataBase(active, input.baseRevision)
    if (!base || assemblyEditorDraftBlock() || !assemblyReviewedInputMatches(input, reviews))
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
    reviews = automationReviews,
  ) {
    const base = reviewedMetadataBase(active, input.draft.baseRevision)
    if (!base || input.command.documentId !== base.id) return null
    const review = reviews.getSnapshot()
    return review?.status === "applying" &&
      !assemblyEditorDraftBlock() &&
      surfaceTextureReviewedInputMatches(review, input)
      ? base
      : null
  }
  async function commitReviewedSurfaceTexture(
    active: PersistentDocumentSession,
    input: SurfaceTextureReviewedInput,
    reviews = automationReviews,
  ) {
    const base = reviewedSurfaceTextureBase(active, input, reviews)
    if (!base)
      return localFailure(
        "stale-revision",
        "The reviewed texture base is no longer writable.",
        true,
      )
    const checked =
      base.schemaVersion === 6
        ? applyDocumentV6AuthoredCommand(base, input.command)
        : base.schemaVersion === 5
          ? applyDocumentV5AuthoredCommand(base, input.command)
          : base.schemaVersion === 4
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

  async function commitAuthoredTransaction(
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
    publishAuthoredResult(active, result, true)
    return result.ok ? { ok: true } : result
  }

  async function commitAuthoredMetadata(
    baseRevision: number,
    change: DocumentV2MetadataChange | SetPartAppearanceChange,
  ): Promise<DocumentMutationResult> {
    const active = session
    const blocked = authoredMetadataWriteBlock(active)
    if (!active || blocked) return authoredMetadataBlockedResult(blocked ?? "document-unavailable")
    const result = await commitActiveAuthoredCommand(
      active,
      (change.kind === "part.set-appearance"
        ? documentV6MetadataCommandSchema
        : documentV2MetadataCommandSchema
      ).parse({
        kind: "org.vibeshape.document.metadata-command",
        schemaVersion: change.kind === "part.set-appearance" ? 6 : 2,
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

  async function replaceSurfaceTextureLayers(
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
    command:
      | Extract<
          DocumentV2Command | DocumentV3Command,
          { kind: "org.vibeshape.document.metadata-command" }
        >
      | ReturnType<typeof documentV6MetadataCommandSchema.parse>
      | ReturnType<typeof historyRemoveRetainingDependentsCommandSchema.parse>
      | ReturnType<typeof historyRepairCommandSchema.parse>,
  ) {
    publish({ ...state, saveStatus: "saving", diagnostic: null })
    const result = await active.commitAuthored(command)
    publishAuthoredResult(active, result)
    return result
  }

  function publishAuthoredResult(
    active: PersistentDocumentSession,
    result: Awaited<ReturnType<PersistentDocumentSession["commitAuthored"]>>,
    advanceInsertion = false,
  ) {
    if (session !== active) return
    if (!result.ok) {
      publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
      return
    }
    const next: DocumentControllerState = {
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
    }
    publish({ ...next, historyInsertion: reconcileHistoryInsertion(state, next, advanceInsertion) })
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

  function addFeature(baseRevision: number, feature: FeatureRecord) {
    if (state.historyInsertion)
      return insertHistoryRecord(baseRevision, { kind: "feature", feature })
    return commitFeatureMutation("org.vibeshape.feature.add", baseRevision, feature)
  }

  function updateFeature(baseRevision: number, feature: FeatureRecord) {
    return commitFeatureMutation("org.vibeshape.feature.update", baseRevision, feature)
  }

  /** Editing can explicitly repair an item; metadata-only updates preserve its retained recipe. */
  function saveFeatureEdits(baseRevision: number, feature: FeatureRecord) {
    return saveHistoryEdits(baseRevision, { kind: "feature", feature })
  }

  function saveSketchEdits(baseRevision: number, sketch: SketchRecord) {
    return saveHistoryEdits(baseRevision, { kind: "sketch", sketch })
  }

  function historyItemNeedsRepair(
    item: ReturnType<typeof historyRepairCommandSchema.parse>["payload"]["item"],
  ) {
    const id = item.kind === "feature" ? item.feature.id : item.sketch.id
    const authority = state.authoredSnapshot
    return (
      (authority?.schemaVersion === 5 || authority?.schemaVersion === 6) &&
      authority.repairIntents.some(
        (intent) => intent.kind === item.kind && intent.authored.id === id,
      )
    )
  }

  function editorCanWriteAuthored(active: PersistentDocumentSession | null) {
    const work = getProjectActiveWorkBlock()
    return canWriteAuthoredState(active) && (work === null || work === "editor-draft")
  }

  async function saveHistoryEdits(
    baseRevision: number,
    item: ReturnType<typeof historyRepairCommandSchema.parse>["payload"]["item"],
  ): Promise<DocumentMutationResult> {
    if (!historyItemNeedsRepair(item))
      return item.kind === "feature"
        ? updateFeature(baseRevision, item.feature)
        : updateSketch(baseRevision, item.sketch)
    const active = session
    if (!active || !editorCanWriteAuthored(active))
      return {
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "Wait for the active document operation before repairing History.",
          retryable: true,
          sourceCode: null,
        },
      }
    const result = await commitActiveAuthoredCommand(
      active,
      historyRepairCommandSchema.parse({
        kind: "org.vibeshape.history.repair",
        schemaVersion: 5,
        commandId: browserUuidV7(),
        documentId: active.snapshot.id,
        baseRevision,
        issuedAt: new Date().toISOString(),
        actor: { type: "user", userId: null },
        payload: { item },
      }),
    )
    return result.ok ? { ok: true } : result
  }

  function setFeatureSuppressed(
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

  async function moveHistoryItem(
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

  function captureHistoryInsertion(baseRevision: number) {
    const cursor = state.historyInsertion
    const active = session
    if (
      !active ||
      !cursor ||
      !state.report ||
      state.status !== "ready" ||
      state.saveStatus === "saving"
    )
      return {
        ok: false as const,
        diagnostic: {
          code: "command-rejected" as const,
          message: "History insertion is unavailable.",
          retryable: true,
          sourceCode: null,
        },
      }
    if (
      cursor.documentId !== active.snapshot.id ||
      cursor.baseRevision !== baseRevision ||
      active.snapshot.revision !== baseRevision
    )
      return {
        ok: false as const,
        diagnostic: {
          code: "command-rejected" as const,
          message: "The History insertion point is stale. Select it again.",
          retryable: false,
          sourceCode: "stale-revision",
        },
      }
    return { ok: true as const, active, cursor, report: state.report }
  }

  async function insertHistoryRecord(
    baseRevision: number,
    record: { kind: "feature"; feature: FeatureRecord } | { kind: "sketch"; sketch: SketchRecord },
  ): Promise<DocumentMutationResult> {
    const boundary = captureHistoryInsertion(baseRevision)
    if (!boundary.ok) return boundary
    const { active, cursor, report } = boundary
    publish({ ...state, saveStatus: "saving", diagnostic: null })
    const result = await active.insertHistoryItem({
      kind:
        record.kind === "feature"
          ? "org.vibeshape.history.insert-feature"
          : "org.vibeshape.history.insert-sketch",
      schemaVersion: 1,
      commandId: browserUuidV7(),
      documentId: active.snapshot.id,
      baseRevision,
      issuedAt: new Date().toISOString(),
      actor: { type: "user", userId: null },
      payload: {
        ...(record.kind === "feature" ? { feature: record.feature } : { sketch: record.sketch }),
        historyAfter: cursor.historyAfter,
      },
    })
    if (!result.ok) {
      publish({ ...state, saveStatus: "save-error", diagnostic: result.diagnostic })
      return result
    }
    publish({
      ...state,
      report: {
        ...report,
        snapshot: result.snapshot,
        historyItems: active.historyItems,
        rebuild: result.rebuild,
      },
      historyInsertion: {
        documentId: result.snapshot.id,
        baseRevision: result.snapshot.revision,
        historyAfter:
          record.kind === "feature"
            ? { kind: "feature", id: record.feature.id }
            : { kind: "sketch", id: record.sketch.id },
      },
      saveStatus: "saved",
      diagnostic: result.rebuild.ok ? null : result.rebuild.diagnostic,
    })
    return { ok: true }
  }

  async function removeHistoryRecord(
    baseRevision: number,
    target: HistoryItemRef,
  ): Promise<DocumentMutationResult> {
    const active = session
    const work = getProjectActiveWorkBlock()
    if (!active || !canWriteAuthoredState(active) || (work !== null && work !== "editor-draft"))
      return {
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "Finish the active edit before removing History items.",
          retryable: true,
          sourceCode: null,
        },
      }
    const result = await commitActiveAuthoredCommand(
      active,
      historyRemoveRetainingDependentsCommandSchema.parse({
        kind: "org.vibeshape.history.remove-retaining-dependents",
        schemaVersion: 5,
        commandId: browserUuidV7(),
        documentId: active.snapshot.id,
        baseRevision,
        issuedAt: new Date().toISOString(),
        actor: { type: "user", userId: null },
        payload: { target },
      }),
    )
    return result.ok ? { ok: true } : result
  }

  function historyRemovalAuthority(
    baseRevision: number,
    expectedDocumentId: DocumentSnapshot["id"],
  ) {
    const active = session
    if (!active || !canWriteAuthoredMetadata(active) || getProjectActionBlock() !== null)
      return null
    const authority = reviewedMetadataBase(active, baseRevision)
    if (!authority || authority.id !== expectedDocumentId) return null
    return active.snapshot.id === expectedDocumentId && active.snapshot.revision === baseRevision
      ? authority
      : null
  }

  /** Removes one selection through the existing atomic authored transaction and undo boundary. */
  async function removeHistoryItems(
    baseRevision: number,
    targets: readonly HistoryItemRef[],
    expectedDocumentId: DocumentSnapshot["id"],
  ): Promise<DocumentMutationResult> {
    const parsed = historyItemRefSchema.array().min(1).max(256).safeParse(targets)
    const active = session
    const authority = historyRemovalAuthority(baseRevision, expectedDocumentId)
    if (!parsed.success || !authority)
      return {
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "Select up to 256 current History items in a writable, idle document.",
          retryable: true,
          sourceCode: "stale-revision",
        },
      }
    const selected = new Set(parsed.data.map((item) => `${item.kind}:${item.id}`))
    const ordered = authority.history
      .filter((item) => selected.has(`${item.kind}:${item.id}`))
      .reverse()
    if (ordered.length !== selected.size)
      return {
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "The selection contains an unavailable History item.",
          retryable: true,
          sourceCode: "invalid-input",
        },
      }
    const issuedAt = new Date().toISOString()
    try {
      return await commitAuthoredTransaction(baseRevision, {
        transactionId: browserUuidV7(),
        commands: ordered.map((target, index) =>
          historyRemoveRetainingDependentsCommandSchema.parse({
            kind: "org.vibeshape.history.remove-retaining-dependents",
            schemaVersion: 5,
            commandId: browserUuidV7(),
            documentId: authority.id,
            baseRevision: baseRevision + index,
            issuedAt,
            actor: { type: "user", userId: null },
            payload: { target },
          }),
        ),
      })
    } catch {
      const diagnostic = {
        code: "command-rejected" as const,
        message: "The selected History items could not be saved.",
        retryable: true,
        sourceCode: null,
      }
      if (session === active) publish({ ...state, saveStatus: "save-error", diagnostic })
      return { ok: false, diagnostic }
    }
  }

  function removeFeature(baseRevision: number, featureId: FeatureRecord["id"]) {
    return removeHistoryRecord(baseRevision, { kind: "feature", id: featureId })
  }

  function removeFeaturePreservingModelReferenceIntent(
    baseRevision: number,
    featureId: FeatureRecord["id"],
  ) {
    return removeHistoryRecord(baseRevision, { kind: "feature", id: featureId })
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

  function addSketch(baseRevision: number, sketch: SketchRecord) {
    if (state.historyInsertion) return insertHistoryRecord(baseRevision, { kind: "sketch", sketch })
    return commitSketchMutation("org.vibeshape.sketch.add", baseRevision, sketch)
  }

  function updateSketch(baseRevision: number, sketch: SketchRecord) {
    return commitSketchMutation("org.vibeshape.sketch.update", baseRevision, sketch)
  }

  function removeSketch(baseRevision: number, sketchId: SketchId) {
    return removeHistoryRecord(baseRevision, { kind: "sketch", id: sketchId })
  }

  async function solveActiveSketch(
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
    if (
      state.report.snapshot.revision !== baseRevision ||
      (!draftSketch && !committedSketchExists)
    ) {
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

  async function exportActiveDocument(
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

  async function materializeActiveDocumentSourceAssets(input: unknown) {
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

  async function prepareActiveDocumentPrint(
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

  async function exportActiveProjectBackup(
    onProgress?: (stage: ProjectBackupStage) => void,
  ): Promise<ActiveProjectBackupResult> {
    const action = captureProjectAction()
    if (!action) return projectActionUnavailable()
    return exportCapturedProjectBackup(action, onProgress)
  }

  async function exportCapturedProjectBackup(
    action: NonNullable<ReturnType<typeof captureProjectAction>>,
    onProgress?: (stage: ProjectBackupStage) => void,
  ): Promise<ActiveProjectBackupResult> {
    const database = activeDatabase
    if (!database || !action.current()) return projectActionUnavailable()
    const archived = await exportProjectBackup(
      {
        databaseName: database.name,
        documentId: action.id,
        revision: action.revision,
      },
      undefined,
      onProgress,
    )
    if (!action.current()) return projectActionUnavailable()
    return archived
  }

  async function importProjectBackup(
    bytes: Uint8Array,
    formatCopyName: (name: string) => string,
  ): Promise<ProjectImportResult> {
    const action = captureProjectCatalogAction()
    if (!action) return projectActionUnavailable()
    const job = startProjectPreparation(action.current)
    const copiedAt = new Date().toISOString()
    try {
      const copied = await prepareProjectImport({
        bytes,
        documentId: documentIdSchema.parse(browserUuidV7()),
        issuedAt: copiedAt,
        signal: job.abort.signal,
        resolveName: (name) => {
          if (!job.current()) {
            job.abort.abort()
            return name
          }
          return formatProjectCopyName(name, formatCopyName)
        },
      })
      if (!job.current()) return projectActionUnavailable()
      if (!copied.ok) return copied
      projectPreparation = null
      const imported = await action.repository.copyPortableProject(copied.value, copiedAt)
      if (!job.current()) return projectActionUnavailable()
      return imported.ok
        ? { ok: true, documentId: imported.value.documentId }
        : { ok: false, diagnostic: imported.diagnostic }
    } catch (error) {
      if (!job.current()) return projectActionUnavailable()
      throw error
    } finally {
      if (projectPreparation === job) projectPreparation = null
    }
  }

  function startProjectPreparation(current: () => boolean) {
    projectPreparation?.abort.abort()
    const abort = new AbortController()
    const job = { abort, current: () => !abort.signal.aborted && current() }
    projectPreparation = job
    return job
  }

  async function listLocalProjects(
    options?: Parameters<BrowserProjectRepository["listProjects"]>[0],
  ): Promise<LocalProjectListResult> {
    if (!activeRepository || (state.status !== "ready" && state.status !== "library"))
      return unavailableProjectFileResult()
    const result = await activeRepository.listProjects(options)
    return result.ok
      ? { ok: true, projects: result.value }
      : { ok: false, diagnostic: result.diagnostic }
  }

  async function saveActiveProjectThumbnail(
    documentIdInput: unknown,
    revision: number,
    thumbnail: Readonly<{ mediaType: "image/svg+xml" | "image/png"; bytes: Uint8Array }>,
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

  async function deleteLocalProject(
    documentIdInput: unknown,
    expectedHeadRevision: number,
  ): Promise<ProjectDeleteResult> {
    const action = captureProjectCatalogAction()
    if (!action) return projectActionUnavailable()
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success) {
      return {
        ok: false,
        diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
      }
    }
    if (session?.snapshot.id === documentId.data) {
      return {
        ok: false,
        diagnostic: { code: "invalid-input", message: "The active project cannot be deleted." },
      }
    }
    const deleted = await action.repository.deleteProject({
      documentId: documentId.data,
      expectedHeadRevision,
      nowMs: Date.now(),
    })
    if (!action.current()) return projectActionUnavailable()
    return deleted.ok ? { ok: true } : { ok: false, diagnostic: deleted.diagnostic }
  }

  async function duplicateLocalProject(
    documentIdInput: unknown,
    expectedHeadRevision: number,
    name: string,
  ): Promise<ProjectDuplicateResult> {
    const action = captureProjectCatalogAction()
    const database = activeDatabase
    if (!action || !database) return projectActionUnavailable()
    const documentId = documentIdSchema.safeParse(documentIdInput)
    if (!documentId.success) {
      return {
        ok: false,
        diagnostic: { code: "invalid-input", message: "The project ID is invalid." },
      }
    }
    const job = startProjectPreparation(action.current)
    const copiedAt = new Date().toISOString()
    try {
      const copied = await prepareProjectDuplicate({
        databaseName: database.name,
        sourceDocumentId: documentId.data,
        expectedHeadRevision,
        documentId: documentIdSchema.parse(browserUuidV7()),
        name,
        issuedAt: copiedAt,
        signal: job.abort.signal,
      })
      if (!job.current()) return projectActionUnavailable()
      if (!copied.ok) return copied
      projectPreparation = null
      return await storeProjectDuplicate(action.repository, copied.value, {
        sourceDocumentId: documentId.data,
        sourceRevision: expectedHeadRevision,
        copiedAt,
        name,
        current: job.current,
      })
    } catch (error) {
      if (!job.current()) return projectActionUnavailable()
      throw error
    } finally {
      if (projectPreparation === job) projectPreparation = null
    }
  }

  async function storeProjectDuplicate(
    repository: BrowserProjectRepository,
    prepared: PreparedProjectImport,
    source: {
      sourceDocumentId: DocumentId
      sourceRevision: number
      copiedAt: string
      name: string
      current: () => boolean
    },
  ): Promise<ProjectDuplicateResult> {
    const stored = await repository.copyPortableProject(prepared, source.copiedAt)
    if (!stored.ok) return { ok: false, diagnostic: stored.diagnostic }
    await repository.copyProjectThumbnail({
      sourceDocumentId: source.sourceDocumentId,
      sourceRevision: source.sourceRevision,
      targetDocumentId: stored.value.documentId,
      targetRevision: stored.value.revision,
      generatedAt: source.copiedAt,
    })
    return source.current()
      ? { ok: true, documentId: stored.value.documentId, name: source.name }
      : projectActionUnavailable()
  }

  function renameVariable(baseRevision: number, variableId: VariableId, name: string) {
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

  function renameActiveProject(
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

  function setActiveProjectDisplayUnits(
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
  async function closeRuntime() {
    projectPreparation?.abort.abort()
    assemblyInspection.dispose()
    const active = session
    if (!active) return { ok: true as const }
    try {
      return await active.close()
    } finally {
      session = null
      publish({ ...state, status: "idle", report: null })
    }
  }
  function reserveProjectTransition() {
    publish({ ...state, saveStatus: "saving" })
    return () => publish({ ...state, saveStatus: "saved" })
  }
  function getProjectNavigationBlock() {
    if (state.saveStatus === "save-error") return "save-error" as const
    return projectActionGuard.read((block) => block !== "automation-busy")
  }
  return {
    setHistoryInsertionPoint,
    registerProjectActionGuard,
    dismissProjectNavigationError,
    setProjectNavigationError,
    getProjectActiveWorkBlock,
    getProjectActionBlock,
    resolveDocumentFeatureParameters,
    createBrowserVariableId,
    createBrowserDocumentId,
    createBrowserFeatureId,
    createBrowserSketchId,
    createBrowserSketchEntityId,
    createBrowserSketchExternalReferenceId,
    createBrowserSketchConstraintId,
    getDocumentControllerState,
    createActiveDocumentAutomationSession,
    createAssistantCheckpointPort,
    clearAssistantCheckpointPreview,
    applyVariableTable,
    undoDocument,
    redoDocument,
    inspectGeometrySource,
    reconstructPrintOptimization,
    inspectTriangleMeshSource,
    inspectActiveAssembly,
    previewAssemblyChanges,
    exportActiveAssembly,
    verifyActiveFrozenDefinition,
    commitAuthoredTransaction,
    commitAuthoredMetadata,
    replaceSurfaceTextureLayers,
    addFeature,
    updateFeature,
    saveFeatureEdits,
    saveSketchEdits,
    setFeatureSuppressed,
    moveHistoryItem,
    removeHistoryItems,
    removeFeature,
    removeFeaturePreservingModelReferenceIntent,
    addSketch,
    updateSketch,
    removeSketch,
    solveActiveSketch,
    exportActiveDocument,
    materializeActiveDocumentSourceAssets,
    prepareActiveDocumentPrint,
    exportActiveProjectBackup,
    importProjectBackup,
    listLocalProjects,
    saveActiveProjectThumbnail,
    deleteLocalProject,
    duplicateLocalProject,
    renameVariable,
    renameActiveProject,
    setActiveProjectDisplayUnits,
    startDocumentController,
    subscribeDocumentController,
    reviews: automationReviews,
    closeRuntime,
    reserveProjectTransition,
    getProjectNavigationBlock,
  }
}
export type DocumentControllerRuntime = ReturnType<typeof createDocumentControllerRuntime>
