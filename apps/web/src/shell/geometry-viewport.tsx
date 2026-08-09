import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
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
import type { DocumentControllerState } from "../document/document-controller"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewportPort | Promise<GeometryViewportPort>

type ViewportMount = {
  cancelled: boolean
  viewport: GeometryViewportPort | null
}

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
  copy: {
    loading: string
    loadFailed: string
    rebuildFailed: string
    unavailable: string
    empty: string
  },
) {
  if (rendererFailed && meshCount > 0) {
    return { kind: "error" as const, text: copy.unavailable }
  }
  if (controller.status === "idle" || controller.status === "loading") {
    return { kind: "status" as const, text: copy.loading }
  }
  if (controller.status === "error") return { kind: "error" as const, text: copy.loadFailed }
  if (controller.report && !controller.report.rebuild.ok) {
    return { kind: "error" as const, text: copy.rebuildFailed }
  }
  if (meshCount === 0) return { kind: "status" as const, text: copy.empty }
  return null
}

async function initializeViewport(
  canvas: HTMLCanvasElement,
  createViewport: ViewportFactory,
  onSelectionChange: (selection: ViewerSelection | null) => void,
  mount: ViewportMount,
  viewportRef: RefObject<GeometryViewportPort | null>,
  latestMeshesRef: RefObject<readonly ViewerMesh[]>,
  setRendererFailed: Dispatch<SetStateAction<boolean>>,
) {
  try {
    const viewport = await createViewport(canvas, { onSelectionChange })
    if (mount.cancelled) {
      viewport.dispose()
      return
    }
    mount.viewport = viewport
    viewportRef.current = viewport
    viewport.setMeshes(latestMeshesRef.current)
    setRendererFailed(false)
  } catch {
    if (!mount.cancelled) setRendererFailed(true)
  }
}

function useViewportRenderer(
  createViewport: ViewportFactory,
  meshes: readonly ViewerMesh[],
  onSelectionChange: (selection: ViewerSelection | null) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  const latestMeshesRef = useRef(meshes)
  const [rendererFailed, setRendererFailed] = useState(false)
  latestMeshesRef.current = meshes
  const hasGeometry = meshes.length > 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!hasGeometry || !canvas) return
    const mount: ViewportMount = { cancelled: false, viewport: null }
    void initializeViewport(
      canvas,
      createViewport,
      onSelectionChange,
      mount,
      viewportRef,
      latestMeshesRef,
      setRendererFailed,
    )
    return () => {
      mount.cancelled = true
      if (viewportRef.current === mount.viewport) viewportRef.current = null
      mount.viewport?.dispose()
    }
  }, [createViewport, hasGeometry, onSelectionChange])

  useEffect(() => {
    viewportRef.current?.setMeshes(meshes)
  }, [meshes])

  return { canvasRef, rendererFailed, viewportRef }
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

export function GeometryViewport({
  controller,
  createViewport = loadGeometryViewport,
  onSelectionChange,
  selection,
}: {
  controller: DocumentControllerState
  createViewport?: ViewportFactory
  onSelectionChange: (selection: ViewerSelection | null) => void
  selection: ViewerSelection | null
}) {
  const t = useTranslations("app.shell.viewport")
  const meshes = useMemo(() => viewerMeshes(controller), [controller])
  const { canvasRef, rendererFailed, viewportRef } = useViewportRenderer(
    createViewport,
    meshes,
    onSelectionChange,
  )

  const message = viewportMessage(controller, rendererFailed, meshes.length, {
    loading: t("loading"),
    loadFailed: t("loadFailed"),
    rebuildFailed: t("rebuildFailed"),
    unavailable: t("unavailable"),
    empty: t("empty"),
  })

  return (
    <section
      aria-label={t("ariaLabel")}
      className="relative min-h-0 overflow-hidden bg-viewport-background"
      data-rendered-feature-count={meshes.length}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
      <ViewportMessage message={message} title={t("title")} />
      {meshes.length > 0 ? (
        <ViewportControls
          clearLabel={t("clearSelection")}
          fitLabel={t("fit")}
          selection={selection}
          viewportRef={viewportRef}
        />
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XY" })}
      </div>
    </section>
  )
}
