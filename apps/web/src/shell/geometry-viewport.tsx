import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  defaultViewerOriginPlaneVisibility,
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "@vibeshape/viewer/origin-planes"
import { renderProjectThumbnail } from "@vibeshape/viewer/project-thumbnail"
import type {
  GeometryViewportOptions,
  GeometryViewport as GeometryViewportPort,
  ViewerFrame,
  ViewerMesh,
  ViewerSelection,
  ViewerSketch,
  ViewerSketchReferenceCandidate,
} from "@vibeshape/viewer/three-viewport"
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { OriginPlaneVisibilityControls } from "../components/origin-plane-visibility-controls"
import {
  type DocumentControllerState,
  saveActiveProjectThumbnail,
} from "../document/document-controller"
import { useDocumentDisplayUnits } from "../document/document-display-units"
import { terminalFeatureIds } from "../features/part-design/terminal-features"
import type { FeaturePreviewState } from "../features/preview/use-feature-preview"
import type { SketchProjectionStoreApi } from "../features/sketch/sketch-projection-store"

const EMPTY_IDS = [] as const

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
}

export type GeometryViewportSketchContext = Readonly<{
  frame: ViewerFrame | null
  mode: "normal" | "orbit"
  projectionStore?: SketchProjectionStoreApi
  referenceSelection?: Readonly<{
    candidates: readonly ViewerSketchReferenceCandidate[]
    onSelect: (candidate: ViewerSketchReferenceCandidate) => void
  }>
}>

const ignoreOriginPlaneSelection = () => undefined
const ignoreOriginPlaneVisibilityChange = () => undefined

async function loadGeometryViewport(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas, options)
}

export function viewerMeshes(
  controller: DocumentControllerState,
  hiddenFeatureIds: readonly string[] = [],
  contextualHiddenFeatureIds: readonly string[] = [],
): readonly ViewerMesh[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const contextHiddenIds = new Set(contextualHiddenFeatureIds)
  const visibleContextFeatures = (controller.report?.snapshot.features ?? []).filter(
    ({ id }) => !contextHiddenIds.has(id),
  )
  const terminalIds = terminalFeatureIds(visibleContextFeatures)
  const datumIds = new Set<string>(
    visibleContextFeatures
      .filter((feature) => readDatumPlaneFeatureParameters(feature) !== null)
      .map(({ id }) => id),
  )
  const hiddenIds = new Set([...hiddenFeatureIds, ...contextualHiddenFeatureIds])
  return rebuild.response.geometry
    .filter(
      ({ featureId }) =>
        (terminalIds.has(featureId) || datumIds.has(featureId)) && !hiddenIds.has(featureId),
    )
    .map(({ featureId, geometry }) => ({
      featureId,
      ...geometry.mesh,
      ...(datumIds.has(featureId) ? { appearance: "datum" as const } : {}),
    }))
}

export function viewerSketches(
  controller: DocumentControllerState,
  hiddenSketchIds: readonly string[] = [],
): readonly ViewerSketch[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const hiddenIds = new Set(hiddenSketchIds)
  return (rebuild.response.sketches ?? []).filter(
    (sketch) =>
      !hiddenIds.has(sketch.sketchId) &&
      (sketch.curvePositions.length > 0 ||
        sketch.constructionCurvePositions.length > 0 ||
        sketch.pointPositions.length > 0 ||
        sketch.constructionPointPositions.length > 0),
  )
}

export function withActiveSketchDisplay(
  committed: readonly ViewerSketch[],
  active: ViewerSketch | null | undefined,
  includeActive = true,
): readonly ViewerSketch[] {
  if (!active || !includeActive) return committed
  return [...committed.filter(({ sketchId }) => sketchId !== active.sketchId), active]
}

function viewportMessage(
  controller: DocumentControllerState,
  rendererFailed: boolean,
  meshCount: number,
  originPlaneSelectionActive: boolean,
  copy: {
    loading: string
    loadFailed: string
    rebuildFailed: string
    unavailable: string
    empty: string
  },
) {
  if (rendererFailed && (meshCount > 0 || originPlaneSelectionActive)) {
    return { kind: "error" as const, text: copy.unavailable }
  }
  const documentMessage = documentViewportMessage(controller, copy)
  if (documentMessage) return documentMessage
  if (meshCount === 0 && !originPlaneSelectionActive) {
    return { kind: "status" as const, text: copy.empty }
  }
  return null
}

function documentViewportMessage(
  controller: DocumentControllerState,
  copy: { loading: string; loadFailed: string; rebuildFailed: string },
) {
  if (controller.status === "idle" || controller.status === "loading") {
    return { kind: "status" as const, text: copy.loading }
  }
  if (controller.status === "error") return { kind: "error" as const, text: copy.loadFailed }
  if (controller.report && !controller.report.rebuild.ok) {
    return { kind: "error" as const, text: copy.rebuildFailed }
  }
  return null
}

async function initializeViewport(
  canvas: HTMLCanvasElement,
  createViewport: ViewportFactory,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
  onSketchReferencePreselectionChange: (candidate: ViewerSketchReferenceCandidate | null) => void,
  onSketchReferenceSelectionChange: (candidate: ViewerSketchReferenceCandidate) => void,
  mount: ViewportMount,
  viewportRef: RefObject<GeometryViewportPort | null>,
  latestMeshesRef: RefObject<readonly ViewerMesh[]>,
  latestSketchesRef: RefObject<readonly ViewerSketch[]>,
  latestOriginPlaneRef: RefObject<ViewerOriginPlane | null>,
  latestOriginPlaneVisibilityRef: RefObject<ViewerOriginPlaneVisibility>,
  latestFeaturePreselectionRef: RefObject<ViewerMesh | null>,
  latestFeatureSelectionRef: RefObject<ViewerMesh | null>,
  latestSketchContextRef: RefObject<GeometryViewportSketchContext | null>,
  setRendererFailed: Dispatch<SetStateAction<boolean>>,
) {
  try {
    const viewport = await createViewport(canvas, {
      onOriginPlanePreselectionChange,
      onOriginPlaneSelectionChange,
      onSelectionChange,
      onSketchReferencePreselectionChange,
      onSketchReferenceSelectionChange,
    })
    if (mount.cancelled) {
      viewport.dispose()
      return
    }
    mount.viewport = viewport
    viewportRef.current = viewport
    viewport.setMeshes(latestMeshesRef.current)
    viewport.setSketches(latestSketchesRef.current)
    viewport.setOriginPlaneVisibility(latestOriginPlaneVisibilityRef.current)
    viewport.setOriginPlaneSelection(latestOriginPlaneRef.current)
    viewport.setFeatureSelection(latestFeatureSelectionRef.current)
    viewport.setFeaturePreselection(latestFeaturePreselectionRef.current)
    viewport.fit()
    synchronizeViewportSketchContext(viewport, latestSketchContextRef.current)
    setRendererFailed(false)
  } catch {
    if (!mount.cancelled) setRendererFailed(true)
  }
}

function synchronizeViewportSketchContext(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  const referenceSelection = orbitReferenceSelection(context)
  viewport.setSketchReferenceCandidates(referenceSelection?.candidates ?? [])
  viewport.setInteractionMode(viewportInteractionMode(context, referenceSelection !== undefined))
  synchronizeViewportSketchProjection(viewport, context)
}

function activeSketchProjection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "normal") return null
  return context.projectionStore?.getState().projection ?? null
}

function synchronizeViewportSketchProjection(
  viewport: GeometryViewportPort,
  context: GeometryViewportSketchContext | null,
) {
  const projection = activeSketchProjection(context)
  if (context?.mode === "normal" && projection) {
    viewport.setSketchProjection(projection.frame, projection.bounds)
    return
  }
  viewport.clearSketchProjection()
  if (context?.mode === "normal" && context.frame) viewport.orientToFrame(context.frame)
}

function orbitReferenceSelection(context: GeometryViewportSketchContext | null) {
  if (context?.mode !== "orbit") return undefined
  return context.referenceSelection
}

function viewportInteractionMode(
  context: GeometryViewportSketchContext | null,
  referenceSelectionActive: boolean,
) {
  if (referenceSelectionActive) return "sketch-reference-select"
  return context ? "camera-only" : "select"
}

function useLatestViewportInputs({
  featurePreselection,
  featureSelection,
  meshes,
  originPlaneSelection,
  originPlaneVisibility,
  sketchContext,
  sketches,
}: Readonly<{
  featurePreselection: ViewerMesh | null
  featureSelection: ViewerMesh | null
  meshes: readonly ViewerMesh[]
  originPlaneSelection: ViewerOriginPlane | null
  originPlaneVisibility: ViewerOriginPlaneVisibility
  sketchContext: GeometryViewportSketchContext | null
  sketches: readonly ViewerSketch[]
}>) {
  const featurePreselectionRef = useRef(featurePreselection)
  const featureSelectionRef = useRef(featureSelection)
  const meshesRef = useRef(meshes)
  const originPlaneRef = useRef(originPlaneSelection)
  const originPlaneVisibilityRef = useRef(originPlaneVisibility)
  const sketchContextRef = useRef(sketchContext)
  const sketchesRef = useRef(sketches)
  featurePreselectionRef.current = featurePreselection
  featureSelectionRef.current = featureSelection
  meshesRef.current = meshes
  originPlaneRef.current = originPlaneSelection
  originPlaneVisibilityRef.current = originPlaneVisibility
  sketchContextRef.current = sketchContext
  sketchesRef.current = sketches
  return {
    featurePreselectionRef,
    featureSelectionRef,
    meshesRef,
    originPlaneRef,
    originPlaneVisibilityRef,
    sketchContextRef,
    sketchesRef,
  }
}

function useViewportRenderer(
  createViewport: ViewportFactory,
  meshes: readonly ViewerMesh[],
  sketches: readonly ViewerSketch[],
  originPlaneSelection: ViewerOriginPlane | null,
  originPlaneVisibility: ViewerOriginPlaneVisibility,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
  featurePreselection: ViewerMesh | null,
  featureSelection: ViewerMesh | null,
  sketchContext: GeometryViewportSketchContext | null,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  const latest = useLatestViewportInputs({
    featurePreselection,
    featureSelection,
    meshes,
    originPlaneSelection,
    originPlaneVisibility,
    sketchContext,
    sketches,
  })
  const [rendererFailed, setRendererFailed] = useState(false)
  const [sketchPointPreselection, setSketchPointPreselection] =
    useState<ViewerSketchReferenceCandidate | null>(null)
  const shouldInitialize = true

  useEffect(() => {
    const canvas = canvasRef.current
    if (!shouldInitialize || !canvas) return
    const mount: ViewportMount = { cancelled: false, viewport: null }
    void initializeViewport(
      canvas,
      createViewport,
      onOriginPlanePreselectionChange,
      onOriginPlaneSelectionChange,
      onSelectionChange,
      setSketchPointPreselection,
      (candidate) => latest.sketchContextRef.current?.referenceSelection?.onSelect(candidate),
      mount,
      viewportRef,
      latest.meshesRef,
      latest.sketchesRef,
      latest.originPlaneRef,
      latest.originPlaneVisibilityRef,
      latest.featurePreselectionRef,
      latest.featureSelectionRef,
      latest.sketchContextRef,
      setRendererFailed,
    )
    return () => {
      mount.cancelled = true
      if (viewportRef.current === mount.viewport) viewportRef.current = null
      mount.viewport?.dispose()
    }
  }, [
    createViewport,
    onOriginPlanePreselectionChange,
    onOriginPlaneSelectionChange,
    onSelectionChange,
    shouldInitialize,
  ])

  useEffect(() => {
    viewportRef.current?.setMeshes(meshes)
  }, [meshes])

  useEffect(() => {
    viewportRef.current?.setSketches(sketches)
  }, [sketches])

  useEffect(() => {
    viewportRef.current?.setOriginPlaneSelection(originPlaneSelection)
  }, [originPlaneSelection])

  useEffect(() => {
    viewportRef.current?.setOriginPlaneVisibility(originPlaneVisibility)
  }, [originPlaneVisibility])

  useEffect(() => {
    const viewport = viewportRef.current
    viewport?.setFeatureSelection(featureSelection)
    viewport?.setFeaturePreselection(featurePreselection)
  }, [featurePreselection, featureSelection])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) synchronizeViewportSketchContext(viewport, sketchContext)
  }, [sketchContext])

  return { canvasRef, rendererFailed, sketchPointPreselection, viewportRef }
}

function useProjectThumbnail(controller: DocumentControllerState, meshes: readonly ViewerMesh[]) {
  const completedRevisionRef = useRef<string | null>(null)
  const inFlightRevisionRef = useRef<string | null>(null)
  const retryCountRef = useRef(new Map<string, number>())
  const [retryAttempt, requestRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const snapshot = controller.report?.snapshot
    if (controller.status !== "ready" || !snapshot || meshes.length === 0) return
    const revisionKey = `${snapshot.id}:${snapshot.revision}`
    if (
      completedRevisionRef.current === revisionKey ||
      inFlightRevisionRef.current === revisionKey
    ) {
      return
    }

    const retry = () => {
      const retryCount = retryCountRef.current.get(revisionKey) ?? 0
      if (cancelled || retryCount >= 1) return
      retryCountRef.current.set(revisionKey, retryCount + 1)
      window.setTimeout(() => {
        if (!cancelled) requestRetry((attempt) => attempt + 1)
      }, 250)
    }

    let thumbnail: ReturnType<typeof renderProjectThumbnail>
    try {
      thumbnail = renderProjectThumbnail(meshes)
    } catch {
      // A derived preview must never block the authoritative geometry viewport.
      return
    }

    if (!thumbnail) {
      completedRevisionRef.current = revisionKey
      return
    }

    inFlightRevisionRef.current = revisionKey
    void saveActiveProjectThumbnail(snapshot.id, snapshot.revision, thumbnail)
      .then((result) => {
        if (result.ok) {
          completedRevisionRef.current = revisionKey
          retryCountRef.current.delete(revisionKey)
          return
        }
        retry()
      })
      .catch(retry)
      .finally(() => {
        if (inFlightRevisionRef.current === revisionKey) inFlightRevisionRef.current = null
      })

    return () => {
      cancelled = true
    }
  }, [controller.report?.snapshot, controller.status, meshes, retryAttempt])
}

function ViewportMessage({
  message,
  title,
}: {
  message: ReturnType<typeof viewportMessage>
  title: string
}) {
  if (!message) return null
  const className =
    message.kind === "error"
      ? "mt-2 text-sm text-destructive"
      : "mt-2 text-sm text-muted-foreground"
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
      <div className="max-w-sm rounded-md bg-background/85 p-3 shadow-sm backdrop-blur-sm">
        <p className="text-sm font-medium">{title}</p>
        <p className={className} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      </div>
    </div>
  )
}

function ViewportControls({
  clearLabel,
  fitLabel,
  selection,
  viewportRef,
}: {
  clearLabel: string
  fitLabel: string
  selection: ViewerSelection | null
  viewportRef: RefObject<GeometryViewportPort | null>
}) {
  return (
    <div className="absolute right-3 top-3 flex items-center gap-1">
      {selection ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={() => viewportRef.current?.clearSelection()}
        >
          {clearLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="secondary"
        onClick={() => viewportRef.current?.fit()}
      >
        {fitLabel}
      </Button>
    </div>
  )
}

function OriginPlaneSelectionOverlay({
  preselectedPlane,
  selection,
}: {
  preselectedPlane: ViewerOriginPlane | null
  selection: Readonly<{ selectedPlane: ViewerOriginPlane }> | undefined
}) {
  const t = useTranslations("app.shell.viewport")
  if (!selection) return null
  const planeLabels: Record<ViewerOriginPlane, string> = {
    xy: t("planeXy"),
    xz: t("planeXz"),
    yz: t("planeYz"),
  }
  const status = preselectedPlane
    ? t("preselectedSketchPlane", { plane: planeLabels[preselectedPlane] })
    : t("selectedSketchPlane", { plane: planeLabels[selection.selectedPlane] })

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur-sm">
      <p className="text-xs font-medium">{t("selectSketchPlane")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
        {status}
      </p>
    </div>
  )
}

type ActivePreviewStatus = Exclude<FeaturePreviewState["status"], "idle">
type PreviewMessageKey =
  | "datumPreviewFailed"
  | "datumPreviewLoading"
  | "datumPreviewReady"
  | "previewFailed"
  | "previewLoading"
  | "previewReady"

const PREVIEW_MESSAGE_KEYS: Readonly<
  Record<"datum-plane" | "extrusion", Record<ActivePreviewStatus, PreviewMessageKey>>
> = {
  "datum-plane": {
    error: "datumPreviewFailed",
    loading: "datumPreviewLoading",
    ready: "datumPreviewReady",
  },
  extrusion: {
    error: "previewFailed",
    loading: "previewLoading",
    ready: "previewReady",
  },
}

function previewMessageKey(preview: FeaturePreviewState | undefined) {
  if (!preview || preview.status === "idle") return null
  return PREVIEW_MESSAGE_KEYS[preview.kind ?? "extrusion"][preview.status]
}

function PreviewStatus({ preview }: { preview: FeaturePreviewState | undefined }) {
  const t = useTranslations("app.shell.viewport")
  const messageKey = previewMessageKey(preview)
  if (!messageKey) return null
  const failed = preview?.status === "error"
  return (
    <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm">
      <p
        className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        role={failed ? "alert" : "status"}
        aria-live="polite"
      >
        {t(messageKey)}
      </p>
    </div>
  )
}

type GeometryViewportProps = Readonly<{
  activeSketchDisplay?: ViewerSketch | null
  controller: DocumentControllerState
  createViewport?: ViewportFactory
  contextualHiddenFeatureIds?: readonly string[]
  featurePreview?: FeaturePreviewState
  hiddenFeatureIds?: readonly string[]
  hiddenSketchIds?: readonly string[]
  originPlaneSelection?: Readonly<{
    selectedPlane: ViewerOriginPlane
    onSelect: (plane: ViewerOriginPlane) => void
  }>
  originPlaneVisibility?: Readonly<{
    onChange: (plane: ViewerOriginPlane, visible: boolean) => void
    visibility: ViewerOriginPlaneVisibility
  }>
  preselectedFeatureId?: string | null
  selectedFeatureId?: string | null
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
  sketchContext?: GeometryViewportSketchContext
}>

function viewerFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
) {
  if (!featureId || !controller.report?.rebuild.ok) return null
  const result = controller.report.rebuild.response.geometry.find(
    (candidate) => candidate.featureId === featureId,
  )
  return result ? ({ featureId, ...result.geometry.mesh } satisfies ViewerMesh) : null
}

function highlightedFeatureMesh(
  controller: DocumentControllerState,
  featureId: string | null | undefined,
  hiddenFeatureIds: readonly string[],
  preview: FeaturePreviewState | undefined,
) {
  if (!featureId || hiddenFeatureIds.includes(featureId)) return null
  if (preview?.status === "ready" && preview.candidateMesh?.featureId === featureId) {
    return preview.candidateMesh
  }
  return viewerFeatureMesh(controller, featureId)
}

function previewMeshes(
  preview: FeaturePreviewState | undefined,
  committedMeshes: readonly ViewerMesh[],
) {
  return preview?.status === "ready" ? preview.meshes : committedMeshes
}

function selectedOriginPlane(selection: GeometryViewportProps["originPlaneSelection"]) {
  return selection?.selectedPlane ?? null
}

function selectOriginPlaneHandler(selection: GeometryViewportProps["originPlaneSelection"]) {
  return selection?.onSelect ?? ignoreOriginPlaneSelection
}

function visibleOriginPlanes(
  originPlaneVisibility: GeometryViewportProps["originPlaneVisibility"],
) {
  return originPlaneVisibility?.visibility ?? defaultViewerOriginPlaneVisibility
}

function changeOriginPlaneVisibilityHandler(
  originPlaneVisibility: GeometryViewportProps["originPlaneVisibility"],
) {
  return originPlaneVisibility?.onChange ?? ignoreOriginPlaneVisibilityChange
}

function previewAllowsViewportMessage(preview: FeaturePreviewState | undefined) {
  return preview?.status !== "loading" && preview?.status !== "error"
}

function useClearInvalidSelection(
  meshes: readonly ViewerMesh[],
  selection: ViewerSelection | null,
  onSelectionChange: GeometryViewportProps["onSelectionChange"],
) {
  useEffect(() => {
    if (selection && !meshes.some(({ featureId }) => featureId === selection.featureId)) {
      onSelectionChange(null)
    }
  }, [meshes, onSelectionChange, selection])
}

function translatedViewportMessage(
  controller: DocumentControllerState,
  rendererFailed: boolean,
  meshes: readonly ViewerMesh[],
  sketches: readonly ViewerSketch[],
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"],
  preview: FeaturePreviewState | undefined,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
) {
  if (!previewAllowsViewportMessage(preview)) return null
  return viewportMessage(
    controller,
    rendererFailed,
    meshes.length + sketches.length,
    originPlaneSelection !== undefined,
    {
      loading: t("loading"),
      loadFailed: t("loadFailed"),
      rebuildFailed: t("rebuildFailed"),
      unavailable: t("unavailable"),
      empty: t("empty"),
    },
  )
}

function useSketchProjectionSynchronization(
  viewportRef: RefObject<GeometryViewportPort | null>,
  sketchContext: GeometryViewportSketchContext | undefined,
) {
  const frameRequestRef = useRef<number | null>(null)
  useEffect(() => {
    const store = sketchContext?.projectionStore
    if (!store || sketchContext.mode !== "normal") return
    const unsubscribe = store.subscribe(() => {
      if (frameRequestRef.current !== null) return
      frameRequestRef.current = window.requestAnimationFrame(() => {
        frameRequestRef.current = null
        const viewport = viewportRef.current
        if (viewport) synchronizeViewportSketchProjection(viewport, sketchContext)
      })
    })
    return () => {
      unsubscribe()
      if (frameRequestRef.current === null) return
      window.cancelAnimationFrame(frameRequestRef.current)
      frameRequestRef.current = null
    }
  }, [sketchContext, viewportRef])
}

function useViewportMeshPresentation({
  contextualHiddenFeatureIds,
  controller,
  featurePreview,
  hiddenFeatureIds,
}: Pick<
  GeometryViewportProps,
  "contextualHiddenFeatureIds" | "controller" | "featurePreview" | "hiddenFeatureIds"
>) {
  const contextualIds = contextualHiddenFeatureIds ?? EMPTY_IDS
  const hiddenIds = hiddenFeatureIds ?? EMPTY_IDS
  const allCommittedMeshes = useMemo(
    () => viewerMeshes(controller).filter(({ appearance }) => appearance !== "datum"),
    [controller],
  )
  const allHiddenFeatureIds = useMemo(
    () => [...new Set([...hiddenIds, ...contextualIds])],
    [contextualIds, hiddenIds],
  )
  const committedMeshes = useMemo(
    () => viewerMeshes(controller, hiddenIds, contextualIds),
    [contextualIds, controller, hiddenIds],
  )
  const meshes = useMemo(() => {
    const hidden = new Set(allHiddenFeatureIds)
    return previewMeshes(featurePreview, committedMeshes).filter(
      ({ featureId }) => !hidden.has(featureId),
    )
  }, [allHiddenFeatureIds, committedMeshes, featurePreview])
  return { allCommittedMeshes, allHiddenFeatureIds, meshes }
}

function useViewportSketchPresentation({
  activeSketchDisplay,
  controller,
  hiddenSketchIds,
  sketchContext,
}: Pick<
  GeometryViewportProps,
  "activeSketchDisplay" | "controller" | "hiddenSketchIds" | "sketchContext"
>) {
  const hiddenIds = hiddenSketchIds ?? EMPTY_IDS
  return useMemo(() => {
    const committed = viewerSketches(controller, hiddenIds)
    return withActiveSketchDisplay(committed, activeSketchDisplay, sketchContext?.mode === "orbit")
  }, [activeSketchDisplay, controller, hiddenIds, sketchContext?.mode])
}

function useGeometryViewportModel(props: GeometryViewportProps) {
  const {
    controller,
    createViewport = loadGeometryViewport,
    featurePreview,
    originPlaneSelection,
    originPlaneVisibility,
    onSelectionChange,
    preselectedFeatureId,
    selectedFeatureId,
    selection,
    sketchContext,
  } = props
  const t = useTranslations("app.shell.viewport")
  const { allCommittedMeshes, allHiddenFeatureIds, meshes } = useViewportMeshPresentation(props)
  const sketches = useViewportSketchPresentation(props)
  const featurePreselection = useMemo(
    () =>
      highlightedFeatureMesh(controller, preselectedFeatureId, allHiddenFeatureIds, featurePreview),
    [allHiddenFeatureIds, controller, featurePreview, preselectedFeatureId],
  )
  const featureSelection = useMemo(
    () =>
      highlightedFeatureMesh(controller, selectedFeatureId, allHiddenFeatureIds, featurePreview),
    [allHiddenFeatureIds, controller, featurePreview, selectedFeatureId],
  )
  const [originPlanePreselection, setOriginPlanePreselection] = useState<ViewerOriginPlane | null>(
    null,
  )
  const { canvasRef, rendererFailed, sketchPointPreselection, viewportRef } = useViewportRenderer(
    createViewport,
    meshes,
    sketches,
    selectedOriginPlane(originPlaneSelection),
    visibleOriginPlanes(originPlaneVisibility),
    setOriginPlanePreselection,
    selectOriginPlaneHandler(originPlaneSelection),
    onSelectionChange,
    featurePreselection,
    featureSelection,
    sketchContext ?? null,
  )
  useProjectThumbnail(controller, allCommittedMeshes)
  useClearInvalidSelection(meshes, selection, onSelectionChange)
  useSketchProjectionSynchronization(viewportRef, sketchContext)
  const message = translatedViewportMessage(
    controller,
    rendererFailed,
    meshes,
    sketches,
    originPlaneSelection,
    featurePreview,
    t,
  )
  return {
    canvasRef,
    preselectedFeatureId: featurePreselection?.featureId ?? null,
    meshes,
    sketches,
    message,
    originPlanePreselection,
    sketchPointPreselection,
    originPlaneVisibility: visibleOriginPlanes(originPlaneVisibility),
    onOriginPlaneVisibilityChange: changeOriginPlaneVisibilityHandler(originPlaneVisibility),
    viewportRef,
    selectedFeatureId: featureSelection?.featureId ?? null,
  }
}

function ViewportControlsSlot({
  meshes,
  sketches,
  originPlaneSelection,
  originPlaneVisibility,
  onOriginPlaneVisibilityChange,
  selection,
  viewportRef,
}: Readonly<{
  meshes: readonly ViewerMesh[]
  sketches: readonly ViewerSketch[]
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  selection: GeometryViewportProps["selection"]
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <div className="flex items-center gap-1">
      <OriginPlaneVisibilityControls
        onChange={onOriginPlaneVisibilityChange}
        visibility={originPlaneVisibility}
      />
      {meshes.length > 0 || sketches.length > 0 || originPlaneSelection ? (
        <ViewportControls
          clearLabel={t("clearSelection")}
          fitLabel={t("fit")}
          selection={selection}
          viewportRef={viewportRef}
        />
      ) : null}
    </div>
  )
}

function WorldAxesLegend() {
  const t = useTranslations("app.shell.viewport")
  return (
    <div
      aria-label={t("worldAxes")}
      className="pointer-events-none absolute bottom-2 left-2 size-20 rounded-md border border-border/70 bg-background/10 shadow-inner"
      role="img"
    >
      <div className="absolute bottom-1 right-1 flex gap-1 rounded-sm bg-background/75 px-1 font-mono text-[10px] font-semibold">
        <span className="text-axis-x">X</span>
        <span className="text-axis-y">Y</span>
        <span className="text-axis-z">Z</span>
      </div>
    </div>
  )
}

function ModelViewportChrome({
  displayUnit,
  featurePreview,
  message,
  meshes,
  onOriginPlaneVisibilityChange,
  originPlanePreselection,
  originPlaneSelection,
  originPlaneVisibility,
  selection,
  sketches,
  viewportRef,
}: Readonly<{
  displayUnit: string
  featurePreview: FeaturePreviewState | undefined
  message: ReturnType<typeof translatedViewportMessage>
  meshes: readonly ViewerMesh[]
  onOriginPlaneVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  originPlanePreselection: ViewerOriginPlane | null
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"]
  originPlaneVisibility: ViewerOriginPlaneVisibility
  selection: ViewerSelection | null
  sketches: readonly ViewerSketch[]
  viewportRef: RefObject<GeometryViewportPort | null>
}>) {
  const t = useTranslations("app.shell.viewport")
  return (
    <>
      <ViewportMessage message={message} title={t("title")} />
      <PreviewStatus preview={featurePreview} />
      <ViewportControlsSlot
        meshes={meshes}
        sketches={sketches}
        originPlaneSelection={originPlaneSelection}
        originPlaneVisibility={originPlaneVisibility}
        onOriginPlaneVisibilityChange={onOriginPlaneVisibilityChange}
        selection={selection}
        viewportRef={viewportRef}
      />
      <OriginPlaneSelectionOverlay
        preselectedPlane={originPlanePreselection}
        selection={originPlaneSelection}
      />
      <WorldAxesLegend />
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XYZ", unit: displayUnit })}
      </div>
    </>
  )
}

function SketchContextChrome({
  context,
  preselection,
}: Readonly<{
  context: GeometryViewportSketchContext
  preselection: ViewerSketchReferenceCandidate | null
}>) {
  const t = useTranslations("app.shell.viewport")
  if (context.mode !== "orbit") return null
  const candidates = context.referenceSelection?.candidates ?? []
  return (
    <>
      <WorldAxesLegend />
      {context.referenceSelection ? (
        <div
          className="pointer-events-none absolute left-3 top-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
          role="status"
        >
          {t("sketchReferenceSelection")}
        </div>
      ) : null}
      {preselection ? (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
          role="status"
        >
          {t("sketchReferenceCandidate", { label: preselection.label })}
        </div>
      ) : null}
      {context.referenceSelection && candidates.length > 0 ? (
        <div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-10 focus-within:grid focus-within:gap-1 focus-within:rounded-md focus-within:border focus-within:bg-background focus-within:p-2 focus-within:shadow-sm">
          <span className="text-xs font-medium">{t("sketchReferenceKeyboardSelection")}</span>
          <NativeSelect
            aria-label={t("sketchReferenceKeyboardSelection")}
            className="h-8 max-w-72 text-xs"
            defaultValue=""
            onChange={(event) => {
              const candidate = candidates[Number(event.currentTarget.value)]
              if (candidate) context.referenceSelection?.onSelect(candidate)
              event.currentTarget.value = ""
            }}
          >
            <option value="">{t("sketchReferenceKeyboardPlaceholder")}</option>
            {candidates.map((candidate, index) => (
              <option key={`${candidate.kind}:${candidate.label}:${index}`} value={index}>
                {candidate.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </>
  )
}

export function GeometryViewport(props: GeometryViewportProps) {
  const { featurePreview, originPlaneSelection, selection, sketchContext } = props
  const passive = sketchContext?.mode === "normal"
  const displayUnits = useDocumentDisplayUnits()
  const t = useTranslations("app.shell.viewport")
  const {
    canvasRef,
    meshes,
    sketches,
    message,
    onOriginPlaneVisibilityChange,
    originPlanePreselection,
    originPlaneVisibility,
    preselectedFeatureId,
    sketchPointPreselection,
    selectedFeatureId,
    viewportRef,
  } = useGeometryViewportModel(props)
  return (
    <section
      aria-label={t("ariaLabel")}
      aria-hidden={passive ? true : undefined}
      className={cn(
        "relative min-h-0 overflow-hidden bg-viewport-background",
        passive && "pointer-events-none",
      )}
      data-passive={passive ? "true" : undefined}
      data-sketch-context-mode={sketchContext?.mode}
      data-rendered-feature-count={meshes.length}
      data-rendered-sketch-count={sketches.length}
      data-sketch-reference-candidate-count={
        sketchContext?.referenceSelection?.candidates.length ?? 0
      }
      data-preview-feature-count={
        meshes.filter(({ appearance }) => appearance === "preview").length
      }
      data-preview-status={featurePreview?.status ?? "idle"}
      data-preselected-feature={preselectedFeatureId ?? undefined}
      data-selected-feature={selectedFeatureId ?? undefined}
      data-origin-plane-selection={originPlaneSelection?.selectedPlane}
      data-origin-plane-preselection={originPlanePreselection ?? undefined}
      data-origin-plane-visibility={viewerOriginPlanes
        .filter((plane) => originPlaneVisibility[plane])
        .join(",")}
    >
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 size-full touch-none", passive && "pointer-events-none")}
      />
      {sketchContext ? (
        <SketchContextChrome context={sketchContext} preselection={sketchPointPreselection} />
      ) : (
        <ModelViewportChrome
          displayUnit={displayUnits.length}
          featurePreview={featurePreview}
          message={message}
          meshes={meshes}
          onOriginPlaneVisibilityChange={onOriginPlaneVisibilityChange}
          originPlanePreselection={originPlanePreselection}
          originPlaneSelection={originPlaneSelection}
          originPlaneVisibility={originPlaneVisibility}
          selection={selection}
          sketches={sketches}
          viewportRef={viewportRef}
        />
      )}
    </section>
  )
}
