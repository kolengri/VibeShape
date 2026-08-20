import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
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
  ViewerMesh,
  ViewerSelection,
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

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
}

const ignoreOriginPlaneSelection = () => undefined
const ignoreOriginPlaneVisibilityChange = () => undefined

async function loadGeometryViewport(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas, options)
}

export function viewerMeshes(
  controller: DocumentControllerState,
  hiddenFeatureIds: readonly string[] = [],
): readonly ViewerMesh[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const terminalIds = terminalFeatureIds(controller.report?.snapshot.features ?? [])
  const datumIds = new Set<string>(
    (controller.report?.snapshot.features ?? [])
      .filter((feature) => readDatumPlaneFeatureParameters(feature) !== null)
      .map(({ id }) => id),
  )
  const hiddenIds = new Set(hiddenFeatureIds)
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
  mount: ViewportMount,
  viewportRef: RefObject<GeometryViewportPort | null>,
  latestMeshesRef: RefObject<readonly ViewerMesh[]>,
  latestOriginPlaneRef: RefObject<ViewerOriginPlane | null>,
  latestOriginPlaneVisibilityRef: RefObject<ViewerOriginPlaneVisibility>,
  setRendererFailed: Dispatch<SetStateAction<boolean>>,
) {
  try {
    const viewport = await createViewport(canvas, {
      onOriginPlanePreselectionChange,
      onOriginPlaneSelectionChange,
      onSelectionChange,
    })
    if (mount.cancelled) {
      viewport.dispose()
      return
    }
    mount.viewport = viewport
    viewportRef.current = viewport
    viewport.setMeshes(latestMeshesRef.current)
    viewport.setOriginPlaneVisibility(latestOriginPlaneVisibilityRef.current)
    viewport.setOriginPlaneSelection(latestOriginPlaneRef.current)
    viewport.fit()
    setRendererFailed(false)
  } catch {
    if (!mount.cancelled) setRendererFailed(true)
  }
}

function useViewportRenderer(
  createViewport: ViewportFactory,
  meshes: readonly ViewerMesh[],
  originPlaneSelection: ViewerOriginPlane | null,
  originPlaneVisibility: ViewerOriginPlaneVisibility,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  const latestMeshesRef = useRef(meshes)
  const latestOriginPlaneRef = useRef(originPlaneSelection)
  const latestOriginPlaneVisibilityRef = useRef(originPlaneVisibility)
  const [rendererFailed, setRendererFailed] = useState(false)
  latestMeshesRef.current = meshes
  latestOriginPlaneRef.current = originPlaneSelection
  latestOriginPlaneVisibilityRef.current = originPlaneVisibility
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
      mount,
      viewportRef,
      latestMeshesRef,
      latestOriginPlaneRef,
      latestOriginPlaneVisibilityRef,
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
    viewportRef.current?.setOriginPlaneSelection(originPlaneSelection)
  }, [originPlaneSelection])

  useEffect(() => {
    viewportRef.current?.setOriginPlaneVisibility(originPlaneVisibility)
  }, [originPlaneVisibility])

  return { canvasRef, rendererFailed, viewportRef }
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
  controller: DocumentControllerState
  createViewport?: ViewportFactory
  featurePreview?: FeaturePreviewState
  hiddenFeatureIds?: readonly string[]
  originPlaneSelection?: Readonly<{
    selectedPlane: ViewerOriginPlane
    onSelect: (plane: ViewerOriginPlane) => void
  }>
  originPlaneVisibility?: Readonly<{
    onChange: (plane: ViewerOriginPlane, visible: boolean) => void
    visibility: ViewerOriginPlaneVisibility
  }>
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
}>

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
  originPlaneSelection: GeometryViewportProps["originPlaneSelection"],
  preview: FeaturePreviewState | undefined,
  t: ReturnType<typeof useTranslations<"app.shell.viewport">>,
) {
  if (!previewAllowsViewportMessage(preview)) return null
  return viewportMessage(
    controller,
    rendererFailed,
    meshes.length,
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

function useGeometryViewportModel(props: GeometryViewportProps) {
  const {
    controller,
    createViewport = loadGeometryViewport,
    featurePreview,
    hiddenFeatureIds = [],
    originPlaneSelection,
    originPlaneVisibility,
    onSelectionChange,
    selection,
  } = props
  const t = useTranslations("app.shell.viewport")
  const allCommittedMeshes = useMemo(
    () => viewerMeshes(controller).filter(({ appearance }) => appearance !== "datum"),
    [controller],
  )
  const committedMeshes = useMemo(
    () => viewerMeshes(controller, hiddenFeatureIds),
    [controller, hiddenFeatureIds],
  )
  const meshes = useMemo(() => {
    const hiddenIds = new Set(hiddenFeatureIds)
    return previewMeshes(featurePreview, committedMeshes).filter(
      ({ featureId }) => !hiddenIds.has(featureId),
    )
  }, [committedMeshes, featurePreview, hiddenFeatureIds])
  const [originPlanePreselection, setOriginPlanePreselection] = useState<ViewerOriginPlane | null>(
    null,
  )
  const { canvasRef, rendererFailed, viewportRef } = useViewportRenderer(
    createViewport,
    meshes,
    selectedOriginPlane(originPlaneSelection),
    visibleOriginPlanes(originPlaneVisibility),
    setOriginPlanePreselection,
    selectOriginPlaneHandler(originPlaneSelection),
    onSelectionChange,
  )
  useProjectThumbnail(controller, allCommittedMeshes)
  useClearInvalidSelection(meshes, selection, onSelectionChange)
  const message = translatedViewportMessage(
    controller,
    rendererFailed,
    meshes,
    originPlaneSelection,
    featurePreview,
    t,
  )
  return {
    canvasRef,
    meshes,
    message,
    originPlanePreselection,
    originPlaneVisibility: visibleOriginPlanes(originPlaneVisibility),
    onOriginPlaneVisibilityChange: changeOriginPlaneVisibilityHandler(originPlaneVisibility),
    viewportRef,
  }
}

function ViewportControlsSlot({
  meshes,
  originPlaneSelection,
  originPlaneVisibility,
  onOriginPlaneVisibilityChange,
  selection,
  viewportRef,
}: Readonly<{
  meshes: readonly ViewerMesh[]
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
      {meshes.length > 0 || originPlaneSelection ? (
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

export function GeometryViewport(props: GeometryViewportProps) {
  const { featurePreview, originPlaneSelection, selection } = props
  const displayUnits = useDocumentDisplayUnits()
  const t = useTranslations("app.shell.viewport")
  const {
    canvasRef,
    meshes,
    message,
    onOriginPlaneVisibilityChange,
    originPlanePreselection,
    originPlaneVisibility,
    viewportRef,
  } = useGeometryViewportModel(props)
  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
      data-rendered-feature-count={meshes.length}
      data-preview-feature-count={
        meshes.filter(({ appearance }) => appearance === "preview").length
      }
      data-preview-status={featurePreview?.status ?? "idle"}
      data-origin-plane-selection={originPlaneSelection?.selectedPlane}
      data-origin-plane-preselection={originPlanePreselection ?? undefined}
      data-origin-plane-visibility={viewerOriginPlanes
        .filter((plane) => originPlaneVisibility[plane])
        .join(",")}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <ViewportMessage message={message} title={t("title")} />
      <PreviewStatus preview={featurePreview} />
      <ViewportControlsSlot
        meshes={meshes}
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
        {t("orientation", { plane: "XYZ", unit: displayUnits.length })}
      </div>
    </section>
  )
}
