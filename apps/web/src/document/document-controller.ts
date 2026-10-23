import { documentIdSchema } from "@vibeshape/domain"
import type { CommandActor } from "@vibeshape/domain/commands"
import { documentNameInputSchema } from "@vibeshape/domain/document"
import { useEffect, useSyncExternalStore } from "react"
import {
  getActiveAutomationReviews,
  setActiveAutomationReviews,
} from "../automation/automation-review-controller"
import {
  type AutomationProjectExpectation,
  type AutomationProjectResult,
  createDocumentControllerRuntime,
  type DocumentControllerRuntime,
  type DocumentRuntimeOptions,
  type ProjectSwitchResult,
} from "./document-controller-runtime"
import { createProjectNavigation } from "./project-navigation"
import { createProjectRuntimeRegistry } from "./project-runtime-registry"
import {
  disposeProjectRuntimeResources,
  isProjectRuntimeResourceBusy,
} from "./project-runtime-resources"

export type * from "./document-controller-runtime"

const initial = createDocumentControllerRuntime({ reviews: getActiveAutomationReviews() })
const runtimes = createProjectRuntimeRegistry(initial)
let defaultProjectName = "Untitled project"
let startPromise: Promise<void> | null = null
let switching = false
let selectionGeneration = 0
let visibleSelection: { source: DocumentControllerRuntime } | null = null
let libraryRuntime: DocumentControllerRuntime | null = null
let navigation: ReturnType<typeof createProjectNavigation> | null = null
const opening = new Map<string, Promise<DocumentControllerRuntime>>()
const closing = new Set<string>()
export function getDocumentControllerState() {
  return runtimes.active().getDocumentControllerState()
}
export function getProjectRuntime(projectId: string) {
  return runtimes.get(projectId)
}
export function getProjectNavigationBlock() {
  return runtimes.active().getProjectNavigationBlock()
}
export function getProjectCloseBlock(projectId: string) {
  const runtime = runtimes.get(projectId)
  if (closing.has(projectId) || isProjectRuntimeResourceBusy(projectId)) return "automation-busy"
  return runtime?.getProjectActionBlock() ?? null
}
export async function closeProjectRuntime(projectId: string): Promise<ProjectSwitchResult> {
  const runtime = runtimes.get(projectId)
  if (!runtime) return { ok: true }
  if (runtime === runtimes.active() || getProjectCloseBlock(projectId)) return unavailable()
  closing.add(projectId)
  try {
    await disposeProjectRuntimeResources(projectId)
    try {
      const result = await runtime.closeRuntime()
      return result.ok ? { ok: true } : result
    } finally {
      runtimes.release(runtime)
    }
  } catch {
    return unavailable("project-close-failed", "The saved project could not be closed cleanly.")
  } finally {
    closing.delete(projectId)
  }
}
function projectNavigation() {
  navigation ??= createProjectNavigation({
    href: () => window.location.href,
    write: (href, mode) => {
      if (mode === "push") window.history.pushState(window.history.state, "", href)
      else window.history.replaceState(window.history.state, "", href)
    },
    subscribe: (listener) => {
      window.addEventListener("popstate", listener)
      return () => window.removeEventListener("popstate", listener)
    },
    activeProjectId: () => getDocumentControllerState().report?.snapshot.id ?? null,
    open: (id, signal) => selectProject({ documentId: id }, undefined, signal),
    library: showProjectLibrary,
    failed: (error) => runtimes.active().setProjectNavigationError(error),
  })
  return navigation
}
function unavailable(
  code = "project-action-blocked",
  message = "Finish the active edit before switching projects.",
  retryable = true,
): Extract<AutomationProjectResult, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable } }
}
function expectationMatches(expected?: AutomationProjectExpectation, strictRevision = true) {
  const snapshot = getDocumentControllerState().report?.snapshot
  return (
    !expected ||
    (snapshot?.id === expected.documentId &&
      (!strictRevision || snapshot.revision === expected.revision))
  )
}
async function prepareRuntime(
  options: NonNullable<DocumentRuntimeOptions["initialProject"]>,
  present?: (runtime: DocumentControllerRuntime) => void,
) {
  const existing = runtimes.get(options.documentId)
  if (existing) {
    present?.(existing)
    await opening.get(options.documentId)
    return existing
  }
  const pending = opening.get(options.documentId)
  if (pending) return pending
  const runtime = createDocumentControllerRuntime({
    initialProject: options,
    progressiveOpening: present !== undefined && !options.create,
  })
  present?.(runtime)
  const ready = runtime
    .startDocumentController(defaultProjectName)
    .then(() => {
      runtimes.retain(runtime)
      return runtime
    })
    .finally(() => opening.delete(options.documentId))
  opening.set(options.documentId, ready)
  return ready
}
function selectionInterruption(
  expected?: AutomationProjectExpectation,
  signal?: AbortSignal,
  strictRevision = true,
) {
  if (!expectationMatches(expected, strictRevision))
    return unavailable("stale-revision", "The active project changed before this action.")
  if (signal?.aborted) return unavailable("cancelled", "The project action was cancelled.")
  return null
}
function projectOpenFailure(
  diagnostic:
    | { code: string; sourceCode?: string | null; message: string; retryable?: boolean }
    | null
    | undefined,
  code: string,
  message: string,
) {
  return unavailable(
    diagnostic?.sourceCode ?? diagnostic?.code ?? code,
    diagnostic?.message ?? message,
    diagnostic?.retryable ?? true,
  )
}
function selectedProject(
  runtime: DocumentControllerRuntime,
  requireWritable: boolean,
): AutomationProjectResult {
  const state = runtime.getDocumentControllerState()
  if (state.status !== "ready" || !state.report)
    return projectOpenFailure(
      state.diagnostic,
      "project-open-failed",
      "The project could not be opened.",
    )
  if (requireWritable && state.report.mode !== "read-write")
    return projectOpenFailure(
      state.report.writeAccessDiagnostic,
      "write-access-unavailable",
      "The project is not available for writing.",
    )
  const { id: projectId, name, revision } = state.report.snapshot
  return { ok: true, value: { projectId, name, revision } }
}
function rememberProject(projectId: string) {
  try {
    window.localStorage.setItem("vibeshape-active-document-id", projectId)
    return null
  } catch {
    return unavailable("storage-unavailable", "The project selection could not be stored.")
  }
}
function selectionBlocked(
  source: DocumentControllerRuntime,
  projectId: string,
  automatedTransition: boolean,
) {
  const sourceBlock = automatedTransition
    ? source.getProjectActionBlock()
    : getProjectNavigationBlock()
  const exclusive = switching && (automatedTransition || visibleSelection === null)
  return exclusive || closing.has(projectId) || (getDocumentControllerState().report && sourceBlock)
    ? unavailable()
    : null
}
function activatePreparedProject(
  runtime: DocumentControllerRuntime,
  authority: {
    generation: number
    projectId: string
    expected: AutomationProjectExpectation | undefined
    signal: AbortSignal | undefined
    strictRevision: boolean
    writable: boolean
  },
): AutomationProjectResult {
  if (authority.generation !== selectionGeneration)
    return unavailable("cancelled", "A newer project selection replaced this request.")
  const result = selectedProject(runtime, authority.writable)
  if (!result.ok) return result
  const blocked =
    selectionInterruption(authority.expected, authority.signal, authority.strictRevision) ??
    (closing.has(authority.projectId) ? unavailable() : null) ??
    rememberProject(authority.projectId)
  if (blocked) return blocked
  setActiveAutomationReviews(runtime.reviews)
  runtimes.activate(runtime)
  projectNavigation().sync(authority.projectId)
  return result
}
async function discardUnselectedRuntime(
  runtime: DocumentControllerRuntime | null,
  retained: boolean,
  projectId: string,
) {
  if (!runtime || retained || runtime === runtimes.active() || closing.has(projectId)) return
  closing.add(projectId)
  try {
    await disposeProjectRuntimeResources(projectId)
    await discardRuntime(runtime)
  } finally {
    closing.delete(projectId)
  }
}
function presentOpeningProject(runtime: DocumentControllerRuntime, projectId: string) {
  if (rememberProject(projectId)) return false
  setActiveAutomationReviews(runtime.reviews)
  runtimes.activate(runtime)
  projectNavigation().sync(projectId)
  return true
}
function restoreUnreadyPresentation(
  source: DocumentControllerRuntime,
  presented: boolean,
  signal?: AbortSignal,
) {
  if (!presented) return
  if (!signal?.aborted && runtimes.active().getDocumentControllerState().status === "ready") return
  setActiveAutomationReviews(source.reviews)
  runtimes.activate(source)
  if (!signal?.aborted) source.setProjectNavigationError("project-open-failed")
  const sourceId = source.getDocumentControllerState().report?.snapshot.id
  if (sourceId) {
    rememberProject(sourceId)
    projectNavigation().sync(sourceId, "replace")
  } else {
    projectNavigation().clear("replace")
  }
}
function beginProjectSelection(
  source: DocumentControllerRuntime,
  automatedTransition: boolean,
  create: boolean | undefined,
) {
  const generation = ++selectionGeneration
  const fallback = visibleSelection?.source ?? source
  const presentImmediately = !automatedTransition && !create
  visibleSelection = presentImmediately ? { source: fallback } : null
  switching = true
  return { generation, fallback, presentImmediately }
}
function finishProjectSelection(generation: number) {
  if (generation !== selectionGeneration) return
  switching = false
  visibleSelection = null
}
async function selectProject(
  options: NonNullable<DocumentRuntimeOptions["initialProject"]>,
  expected?: AutomationProjectExpectation,
  signal?: AbortSignal,
  automatedTransition = false,
  strictRevision = true,
): Promise<AutomationProjectResult> {
  if (["idle", "loading"].includes(getDocumentControllerState().status)) await startPromise
  const source = runtimes.active()
  const blocked =
    selectionBlocked(source, options.documentId, automatedTransition) ??
    selectionInterruption(expected, signal, strictRevision)
  if (blocked) return blocked
  const { generation, fallback, presentImmediately } = beginProjectSelection(
    source,
    automatedTransition,
    options.create,
  )
  const release = automatedTransition ? source.reserveProjectTransition() : () => {}
  const retained = runtimes.get(options.documentId) !== undefined
  let prepared: DocumentControllerRuntime | null = null
  let presented = false
  const present = presentImmediately
    ? (runtime: DocumentControllerRuntime) => {
        presented = presentOpeningProject(runtime, options.documentId)
      }
    : undefined
  try {
    prepared = await prepareRuntime(options, present)
    return activatePreparedProject(prepared, {
      generation,
      projectId: options.documentId,
      expected: presented ? undefined : expected,
      signal,
      strictRevision,
      writable: automatedTransition,
    })
  } catch {
    return unavailable("persistence-failed", "The project could not be selected.")
  } finally {
    try {
      if (generation === selectionGeneration)
        restoreUnreadyPresentation(fallback, presented, signal)
      await discardUnselectedRuntime(prepared, retained, options.documentId)
    } finally {
      release()
      finishProjectSelection(generation)
    }
  }
}
async function discardRuntime(runtime: DocumentControllerRuntime) {
  try {
    await runtime.closeRuntime()
  } catch {
    // A failed close still invalidates this unselected runtime.
  } finally {
    runtimes.release(runtime)
  }
}
export async function activateLocalProject(
  input: unknown,
  expected?: AutomationProjectExpectation,
): Promise<ProjectSwitchResult> {
  const id = documentIdSchema.safeParse(input)
  if (!id.success) return unavailable("invalid-input", "The project ID is invalid.", false)
  const result = await selectProject({ documentId: id.data }, expected)
  return result.ok ? { ok: true } : result
}
/** Tabs may return to a project while its own background work advances the source revision. */
export async function activateProjectTab(
  input: unknown,
  expected?: AutomationProjectExpectation,
): Promise<ProjectSwitchResult> {
  const id = documentIdSchema.safeParse(input)
  if (!id.success) return unavailable("invalid-input", "The project ID is invalid.", false)
  const result = await selectProject({ documentId: id.data }, expected, undefined, false, false)
  return result.ok ? { ok: true } : result
}
export async function createNewLocalProject(): Promise<ProjectSwitchResult> {
  const result = await selectProject({
    documentId: createBrowserDocumentId(),
    create: true,
    name: defaultProjectName,
  })
  return result.ok ? { ok: true } : result
}
export async function showProjectLibrary(signal?: AbortSignal): Promise<ProjectSwitchResult> {
  await startPromise
  if ((switching && visibleSelection === null) || runtimes.active().getProjectNavigationBlock())
    return unavailable()
  if (signal?.aborted) return unavailable("cancelled", "The project action was cancelled.")
  const generation = ++selectionGeneration
  visibleSelection = null
  switching = true
  try {
    libraryRuntime ??= createDocumentControllerRuntime({ initialProject: null })
    await libraryRuntime.startDocumentController(defaultProjectName)
    if (signal?.aborted) return unavailable("cancelled", "The project action was cancelled.")
    const state = libraryRuntime.getDocumentControllerState()
    if (state.status !== "library") {
      const failed = libraryRuntime
      libraryRuntime = null
      await discardRuntime(failed)
      return projectOpenFailure(
        state.diagnostic,
        "persistence-failed",
        "The project library could not be opened.",
      )
    }
    if (!projectNavigation().clear())
      return unavailable("project-url-unavailable", "The project URL could not be cleared.")
    setActiveAutomationReviews(libraryRuntime.reviews)
    runtimes.activate(libraryRuntime)
    return { ok: true }
  } finally {
    finishProjectSelection(generation)
  }
}
export function createAutomationProject(
  name: string,
  expected: AutomationProjectExpectation,
  signal?: AbortSignal,
  actor?: CommandActor,
): Promise<AutomationProjectResult> {
  const parsed = documentNameInputSchema.safeParse(name)
  if (!parsed.success)
    return Promise.resolve(unavailable("invalid-input", "The project name is invalid.", false))
  return selectProject(
    {
      documentId: createBrowserDocumentId(),
      create: true,
      name: parsed.data,
      ...(actor ? { actor } : {}),
    },
    expected,
    signal,
    true,
  )
}
export function openAutomationProject(
  id: unknown,
  expected: AutomationProjectExpectation,
  signal?: AbortSignal,
): Promise<AutomationProjectResult> {
  const parsed = documentIdSchema.safeParse(id)
  return parsed.success
    ? selectProject({ documentId: parsed.data }, expected, signal, true)
    : Promise.resolve(unavailable("invalid-input", "The project ID is invalid.", false))
}
export function deleteLocalProject(
  ...args: Parameters<DocumentControllerRuntime["deleteLocalProject"]>
): ReturnType<DocumentControllerRuntime["deleteLocalProject"]> {
  if (typeof args[0] === "string" && runtimes.get(args[0]))
    return Promise.resolve(
      unavailable("project-action-blocked", "An open project cannot be deleted."),
    )
  return runtimes.active().deleteLocalProject(...args)
}
export function useProjectNavigationPending() {
  const owner = projectNavigation()
  return useSyncExternalStore(owner.subscribePending, owner.getPendingSnapshot, () => false)
}

export function useDocumentController(defaultDocumentName: string) {
  const state = useSyncExternalStore(
    runtimes.subscribe,
    getDocumentControllerState,
    getDocumentControllerState,
  )
  useEffect(() => {
    defaultProjectName = defaultDocumentName
    const stop = projectNavigation().listen()
    startPromise ??= initial.startDocumentController(defaultDocumentName).then(() => {
      runtimes.retain(initial)
      const id = initial.getDocumentControllerState().report?.snapshot.id
      if (id) projectNavigation().sync(id, "replace")
    })
    const close = () => {
      for (const runtime of runtimes.values()) {
        const id = runtime.getDocumentControllerState().report?.snapshot.id
        if (id)
          void disposeProjectRuntimeResources(id)
            .catch(() => undefined)
            .finally(() => runtime.closeRuntime())
            .catch(() => undefined)
        else void runtime.closeRuntime().catch(() => undefined)
      }
    }
    window.addEventListener("pagehide", close)
    return () => {
      stop()
      window.removeEventListener("pagehide", close)
    }
  }, [defaultDocumentName])
  return state
}

export function setHistoryInsertionPoint(
  ...args: Parameters<DocumentControllerRuntime["setHistoryInsertionPoint"]>
): ReturnType<DocumentControllerRuntime["setHistoryInsertionPoint"]> {
  return runtimes.active().setHistoryInsertionPoint(...args)
}

export function registerProjectActionGuard(
  ...args: Parameters<DocumentControllerRuntime["registerProjectActionGuard"]>
): ReturnType<DocumentControllerRuntime["registerProjectActionGuard"]> {
  return runtimes.active().registerProjectActionGuard(...args)
}

export function dismissProjectNavigationError(
  ...args: Parameters<DocumentControllerRuntime["dismissProjectNavigationError"]>
): ReturnType<DocumentControllerRuntime["dismissProjectNavigationError"]> {
  return runtimes.active().dismissProjectNavigationError(...args)
}

export function getProjectActiveWorkBlock(
  ...args: Parameters<DocumentControllerRuntime["getProjectActiveWorkBlock"]>
): ReturnType<DocumentControllerRuntime["getProjectActiveWorkBlock"]> {
  return runtimes.active().getProjectActiveWorkBlock(...args)
}

export function getProjectActionBlock(
  ...args: Parameters<DocumentControllerRuntime["getProjectActionBlock"]>
): ReturnType<DocumentControllerRuntime["getProjectActionBlock"]> {
  return runtimes.active().getProjectActionBlock(...args)
}

export function resolveDocumentFeatureParameters(
  ...args: Parameters<DocumentControllerRuntime["resolveDocumentFeatureParameters"]>
): ReturnType<DocumentControllerRuntime["resolveDocumentFeatureParameters"]> {
  return runtimes.active().resolveDocumentFeatureParameters(...args)
}

export function createBrowserVariableId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserVariableId"]>
): ReturnType<DocumentControllerRuntime["createBrowserVariableId"]> {
  return runtimes.active().createBrowserVariableId(...args)
}

export function createBrowserDocumentId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserDocumentId"]>
): ReturnType<DocumentControllerRuntime["createBrowserDocumentId"]> {
  return runtimes.active().createBrowserDocumentId(...args)
}

export function createBrowserFeatureId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserFeatureId"]>
): ReturnType<DocumentControllerRuntime["createBrowserFeatureId"]> {
  return runtimes.active().createBrowserFeatureId(...args)
}

export function createBrowserSketchId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserSketchId"]>
): ReturnType<DocumentControllerRuntime["createBrowserSketchId"]> {
  return runtimes.active().createBrowserSketchId(...args)
}

export function createBrowserSketchEntityId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserSketchEntityId"]>
): ReturnType<DocumentControllerRuntime["createBrowserSketchEntityId"]> {
  return runtimes.active().createBrowserSketchEntityId(...args)
}

export function createBrowserSketchExternalReferenceId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserSketchExternalReferenceId"]>
): ReturnType<DocumentControllerRuntime["createBrowserSketchExternalReferenceId"]> {
  return runtimes.active().createBrowserSketchExternalReferenceId(...args)
}

export function createBrowserSketchConstraintId(
  ...args: Parameters<DocumentControllerRuntime["createBrowserSketchConstraintId"]>
): ReturnType<DocumentControllerRuntime["createBrowserSketchConstraintId"]> {
  return runtimes.active().createBrowserSketchConstraintId(...args)
}

export function createActiveDocumentAutomationSession(
  ...args: Parameters<DocumentControllerRuntime["createActiveDocumentAutomationSession"]>
): ReturnType<DocumentControllerRuntime["createActiveDocumentAutomationSession"]> {
  const runtime = runtimes.active()
  const created = runtime.createActiveDocumentAutomationSession(...args)
  if (!created.ok) return created
  const unsubscribe = runtimes.subscribe(() => {
    if (runtimes.active() === runtime) return
    unsubscribe()
    try {
      created.dispose()
    } catch {
      // Authority is revoked before individual adapter cleanup runs.
    }
  })
  return {
    ...created,
    get revision() {
      return created.revision
    },
    dispose() {
      unsubscribe()
      created.dispose()
    },
  }
}

export function applyVariableTable(
  ...args: Parameters<DocumentControllerRuntime["applyVariableTable"]>
): ReturnType<DocumentControllerRuntime["applyVariableTable"]> {
  return runtimes.active().applyVariableTable(...args)
}

export function undoDocument(
  ...args: Parameters<DocumentControllerRuntime["undoDocument"]>
): ReturnType<DocumentControllerRuntime["undoDocument"]> {
  return runtimes.active().undoDocument(...args)
}

export function redoDocument(
  ...args: Parameters<DocumentControllerRuntime["redoDocument"]>
): ReturnType<DocumentControllerRuntime["redoDocument"]> {
  return runtimes.active().redoDocument(...args)
}

export function inspectGeometrySource(
  ...args: Parameters<DocumentControllerRuntime["inspectGeometrySource"]>
): ReturnType<DocumentControllerRuntime["inspectGeometrySource"]> {
  return runtimes.active().inspectGeometrySource(...args)
}

export function inspectTriangleMeshSource(
  ...args: Parameters<DocumentControllerRuntime["inspectTriangleMeshSource"]>
): ReturnType<DocumentControllerRuntime["inspectTriangleMeshSource"]> {
  return runtimes.active().inspectTriangleMeshSource(...args)
}

export function inspectActiveAssembly(
  ...args: Parameters<DocumentControllerRuntime["inspectActiveAssembly"]>
): ReturnType<DocumentControllerRuntime["inspectActiveAssembly"]> {
  return runtimes.active().inspectActiveAssembly(...args)
}

export function previewAssemblyChanges(
  ...args: Parameters<DocumentControllerRuntime["previewAssemblyChanges"]>
): ReturnType<DocumentControllerRuntime["previewAssemblyChanges"]> {
  return runtimes.active().previewAssemblyChanges(...args)
}

export function exportActiveAssembly(
  ...args: Parameters<DocumentControllerRuntime["exportActiveAssembly"]>
): ReturnType<DocumentControllerRuntime["exportActiveAssembly"]> {
  return runtimes.active().exportActiveAssembly(...args)
}

export function verifyActiveFrozenDefinition(
  ...args: Parameters<DocumentControllerRuntime["verifyActiveFrozenDefinition"]>
): ReturnType<DocumentControllerRuntime["verifyActiveFrozenDefinition"]> {
  return runtimes.active().verifyActiveFrozenDefinition(...args)
}

export function commitAuthoredTransaction(
  ...args: Parameters<DocumentControllerRuntime["commitAuthoredTransaction"]>
): ReturnType<DocumentControllerRuntime["commitAuthoredTransaction"]> {
  return runtimes.active().commitAuthoredTransaction(...args)
}

export function commitAuthoredMetadata(
  ...args: Parameters<DocumentControllerRuntime["commitAuthoredMetadata"]>
): ReturnType<DocumentControllerRuntime["commitAuthoredMetadata"]> {
  return runtimes.active().commitAuthoredMetadata(...args)
}

export function replaceSurfaceTextureLayers(
  ...args: Parameters<DocumentControllerRuntime["replaceSurfaceTextureLayers"]>
): ReturnType<DocumentControllerRuntime["replaceSurfaceTextureLayers"]> {
  return runtimes.active().replaceSurfaceTextureLayers(...args)
}

export function addFeature(
  ...args: Parameters<DocumentControllerRuntime["addFeature"]>
): ReturnType<DocumentControllerRuntime["addFeature"]> {
  return runtimes.active().addFeature(...args)
}

export function updateFeature(
  ...args: Parameters<DocumentControllerRuntime["updateFeature"]>
): ReturnType<DocumentControllerRuntime["updateFeature"]> {
  return runtimes.active().updateFeature(...args)
}

export function saveFeatureEdits(
  ...args: Parameters<DocumentControllerRuntime["saveFeatureEdits"]>
): ReturnType<DocumentControllerRuntime["saveFeatureEdits"]> {
  return runtimes.active().saveFeatureEdits(...args)
}

export function saveSketchEdits(
  ...args: Parameters<DocumentControllerRuntime["saveSketchEdits"]>
): ReturnType<DocumentControllerRuntime["saveSketchEdits"]> {
  return runtimes.active().saveSketchEdits(...args)
}

export function setFeatureSuppressed(
  ...args: Parameters<DocumentControllerRuntime["setFeatureSuppressed"]>
): ReturnType<DocumentControllerRuntime["setFeatureSuppressed"]> {
  return runtimes.active().setFeatureSuppressed(...args)
}

export function moveHistoryItem(
  ...args: Parameters<DocumentControllerRuntime["moveHistoryItem"]>
): ReturnType<DocumentControllerRuntime["moveHistoryItem"]> {
  return runtimes.active().moveHistoryItem(...args)
}

export function removeHistoryItems(
  ...args: Parameters<DocumentControllerRuntime["removeHistoryItems"]>
): ReturnType<DocumentControllerRuntime["removeHistoryItems"]> {
  return runtimes.active().removeHistoryItems(...args)
}

export function removeFeature(
  ...args: Parameters<DocumentControllerRuntime["removeFeature"]>
): ReturnType<DocumentControllerRuntime["removeFeature"]> {
  return runtimes.active().removeFeature(...args)
}

export function removeFeaturePreservingModelReferenceIntent(
  ...args: Parameters<DocumentControllerRuntime["removeFeaturePreservingModelReferenceIntent"]>
): ReturnType<DocumentControllerRuntime["removeFeaturePreservingModelReferenceIntent"]> {
  return runtimes.active().removeFeaturePreservingModelReferenceIntent(...args)
}

export function addSketch(
  ...args: Parameters<DocumentControllerRuntime["addSketch"]>
): ReturnType<DocumentControllerRuntime["addSketch"]> {
  return runtimes.active().addSketch(...args)
}

export function updateSketch(
  ...args: Parameters<DocumentControllerRuntime["updateSketch"]>
): ReturnType<DocumentControllerRuntime["updateSketch"]> {
  return runtimes.active().updateSketch(...args)
}

export function removeSketch(
  ...args: Parameters<DocumentControllerRuntime["removeSketch"]>
): ReturnType<DocumentControllerRuntime["removeSketch"]> {
  return runtimes.active().removeSketch(...args)
}

export function solveActiveSketch(
  ...args: Parameters<DocumentControllerRuntime["solveActiveSketch"]>
): ReturnType<DocumentControllerRuntime["solveActiveSketch"]> {
  return runtimes.active().solveActiveSketch(...args)
}

export function exportActiveDocument(
  ...args: Parameters<DocumentControllerRuntime["exportActiveDocument"]>
): ReturnType<DocumentControllerRuntime["exportActiveDocument"]> {
  return runtimes.active().exportActiveDocument(...args)
}

export function materializeActiveDocumentSourceAssets(
  ...args: Parameters<DocumentControllerRuntime["materializeActiveDocumentSourceAssets"]>
): ReturnType<DocumentControllerRuntime["materializeActiveDocumentSourceAssets"]> {
  return runtimes.active().materializeActiveDocumentSourceAssets(...args)
}

export function prepareActiveDocumentPrint(
  ...args: Parameters<DocumentControllerRuntime["prepareActiveDocumentPrint"]>
): ReturnType<DocumentControllerRuntime["prepareActiveDocumentPrint"]> {
  return runtimes.active().prepareActiveDocumentPrint(...args)
}

export function exportActiveProjectBackup(
  ...args: Parameters<DocumentControllerRuntime["exportActiveProjectBackup"]>
): ReturnType<DocumentControllerRuntime["exportActiveProjectBackup"]> {
  return runtimes.active().exportActiveProjectBackup(...args)
}

export function importProjectBackup(
  ...args: Parameters<DocumentControllerRuntime["importProjectBackup"]>
): ReturnType<DocumentControllerRuntime["importProjectBackup"]> {
  return runtimes.active().importProjectBackup(...args)
}

export function listLocalProjects(
  ...args: Parameters<DocumentControllerRuntime["listLocalProjects"]>
): ReturnType<DocumentControllerRuntime["listLocalProjects"]> {
  return runtimes.active().listLocalProjects(...args)
}

export function saveActiveProjectThumbnail(
  ...args: Parameters<DocumentControllerRuntime["saveActiveProjectThumbnail"]>
): ReturnType<DocumentControllerRuntime["saveActiveProjectThumbnail"]> {
  return runtimes.active().saveActiveProjectThumbnail(...args)
}

export function duplicateLocalProject(
  ...args: Parameters<DocumentControllerRuntime["duplicateLocalProject"]>
): ReturnType<DocumentControllerRuntime["duplicateLocalProject"]> {
  return runtimes.active().duplicateLocalProject(...args)
}

export function renameVariable(
  ...args: Parameters<DocumentControllerRuntime["renameVariable"]>
): ReturnType<DocumentControllerRuntime["renameVariable"]> {
  return runtimes.active().renameVariable(...args)
}

export function renameActiveProject(
  ...args: Parameters<DocumentControllerRuntime["renameActiveProject"]>
): ReturnType<DocumentControllerRuntime["renameActiveProject"]> {
  return runtimes.active().renameActiveProject(...args)
}

export function setActiveProjectDisplayUnits(
  ...args: Parameters<DocumentControllerRuntime["setActiveProjectDisplayUnits"]>
): ReturnType<DocumentControllerRuntime["setActiveProjectDisplayUnits"]> {
  return runtimes.active().setActiveProjectDisplayUnits(...args)
}
