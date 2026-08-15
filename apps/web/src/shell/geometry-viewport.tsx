import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { renderProjectThumbnail } from "@vibeshape/viewer/project-thumbnail"
import type {
  GeometryViewportOptions,
  GeometryViewport as GeometryViewportPort,
  ViewerMesh,
  ViewerOriginPlane,
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
import {
  type DocumentControllerState,
  saveActiveProjectThumbnail,
} from "../document/document-controller"
import { useDocumentDisplayUnits } from "../document/document-display-units"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
}

const ignoreOriginPlaneSelection = () => undefined

async function loadGeometryViewport(canvas: HTMLCanvasElement, options: GeometryViewportOptions) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas, options)
}

function terminalFeatureIds(controller: DocumentControllerState) {
  const features = controller.report?.snapshot.features ?? []
  const dependencyIds = new Set(features.flatMap(({ dependencies }) => dependencies))
  return new Set<string>(features.filter(({ id }) => !dependencyIds.has(id)).map(({ id }) => id))
}

export function viewerMeshes(controller: DocumentControllerState): readonly ViewerMesh[] {
  const rebuild = controller.report?.rebuild
  if (!rebuild?.ok) return []
  const terminalIds = terminalFeatureIds(controller)
  return rebuild.response.geometry
    .filter(({ featureId }) => terminalIds.has(featureId))
    .map(({ featureId, geometry }) => ({ featureId, ...geometry.mesh }))
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
    viewport.setOriginPlaneSelection(latestOriginPlaneRef.current)
    setRendererFailed(false)
  } catch {
    if (!mount.cancelled) setRendererFailed(true)
  }
}

function useViewportRenderer(
  createViewport: ViewportFactory,
  meshes: readonly ViewerMesh[],
  originPlaneSelection: ViewerOriginPlane | null,
  originPlaneSelectionActive: boolean,
  onOriginPlanePreselectionChange: (plane: ViewerOriginPlane | null) => void,
  onOriginPlaneSelectionChange: (plane: ViewerOriginPlane) => void,
  onSelectionChange: (selection: ViewerSelection | null) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  const latestMeshesRef = useRef(meshes)
  const latestOriginPlaneRef = useRef(originPlaneSelection)
  const [rendererFailed, setRendererFailed] = useState(false)
  latestMeshesRef.current = meshes
  latestOriginPlaneRef.current = originPlaneSelection
  const shouldInitialize = meshes.length > 0 || originPlaneSelectionActive

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

  return { canvasRef, rendererFailed, viewportRef }
}

function useProjectThumbnail(controller: DocumentControllerState, meshes: readonly ViewerMesh[]) {
  const attemptedRevisionRef = useRef<string | null>(null)

  useEffect(() => {
    const snapshot = controller.report?.snapshot
    if (controller.status !== "ready" || !snapshot || meshes.length === 0) return
    const revisionKey = `${snapshot.id}:${snapshot.revision}`
    if (attemptedRevisionRef.current === revisionKey) return
    attemptedRevisionRef.current = revisionKey
    try {
      const thumbnail = renderProjectThumbnail(meshes)
      if (thumbnail) {
        void saveActiveProjectThumbnail(snapshot.id, snapshot.revision, thumbnail)
      }
    } catch {
      // A derived preview must never block the authoritative geometry viewport.
    }
  }, [controller.report?.snapshot, controller.status, meshes])
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

export function GeometryViewport({
  controller,
  createViewport = loadGeometryViewport,
  originPlaneSelection,
  onSelectionChange,
  selection,
}: {
  controller: DocumentControllerState
  createViewport?: ViewportFactory
  originPlaneSelection?: Readonly<{
    selectedPlane: ViewerOriginPlane
    onSelect: (plane: ViewerOriginPlane) => void
  }>
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
}) {
  const displayUnits = useDocumentDisplayUnits()
  const t = useTranslations("app.shell.viewport")
  const meshes = useMemo(() => viewerMeshes(controller), [controller])
  const [originPlanePreselection, setOriginPlanePreselection] = useState<ViewerOriginPlane | null>(
    null,
  )
  const { canvasRef, rendererFailed, viewportRef } = useViewportRenderer(
    createViewport,
    meshes,
    originPlaneSelection?.selectedPlane ?? null,
    originPlaneSelection !== undefined,
    setOriginPlanePreselection,
    originPlaneSelection?.onSelect ?? ignoreOriginPlaneSelection,
    onSelectionChange,
  )
  useProjectThumbnail(controller, meshes)

  useEffect(() => {
    if (selection && !meshes.some(({ featureId }) => featureId === selection.featureId)) {
      onSelectionChange(null)
    }
  }, [meshes, onSelectionChange, selection])

  const message = viewportMessage(
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
  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
      data-rendered-feature-count={meshes.length}
      data-origin-plane-selection={originPlaneSelection?.selectedPlane}
      data-origin-plane-preselection={originPlanePreselection ?? undefined}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <ViewportMessage message={message} title={t("title")} />
      {meshes.length > 0 || originPlaneSelection ? (
        <ViewportControls
          clearLabel={t("clearSelection")}
          fitLabel={t("fit")}
          selection={selection}
          viewportRef={viewportRef}
        />
      ) : null}
      <OriginPlaneSelectionOverlay
        preselectedPlane={originPlanePreselection}
        selection={originPlaneSelection}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XY", unit: displayUnits.length })}
      </div>
    </section>
  )
}
