import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
import type {
  GeometryViewport as GeometryViewportPort,
  ViewerMesh,
} from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useRef, useState } from "react"
import type { DocumentControllerState } from "../document/document-controller"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
) => GeometryViewportPort | Promise<GeometryViewportPort>

async function loadGeometryViewport(canvas: HTMLCanvasElement) {
  const { createGeometryViewport } = await import("@vibeshape/viewer/three-viewport")
  return createGeometryViewport(canvas)
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

export function GeometryViewport({
  controller,
  createViewport = loadGeometryViewport,
}: {
  controller: DocumentControllerState
  createViewport?: ViewportFactory
}) {
  const t = useTranslations("app.shell.viewport")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewportPort | null>(null)
  const meshes = useMemo(() => viewerMeshes(controller), [controller])
  const latestMeshesRef = useRef(meshes)
  latestMeshesRef.current = meshes
  const [rendererFailed, setRendererFailed] = useState(false)
  const hasGeometry = meshes.length > 0

  useEffect(() => {
    if (!hasGeometry) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let ownedViewport: GeometryViewportPort | null = null
    void Promise.resolve()
      .then(() => createViewport(canvas))
      .then((viewport) => {
        if (cancelled) {
          viewport.dispose()
          return
        }
        ownedViewport = viewport
        viewportRef.current = viewport
        viewport.setMeshes(latestMeshesRef.current)
        setRendererFailed(false)
      })
      .catch(() => {
        if (!cancelled) setRendererFailed(true)
      })
    return () => {
      cancelled = true
      if (viewportRef.current === ownedViewport) {
        viewportRef.current = null
      }
      ownedViewport?.dispose()
    }
  }, [createViewport, hasGeometry])

  useEffect(() => {
    viewportRef.current?.setMeshes(meshes)
  }, [meshes])

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
      {message ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <div className="max-w-sm rounded-md bg-background/85 p-3 shadow-sm backdrop-blur-sm">
            <p className="text-sm font-medium">{t("title")}</p>
            <p
              className={
                message.kind === "error"
                  ? "mt-2 text-sm text-destructive"
                  : "mt-2 text-sm text-muted-foreground"
              }
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          </div>
        </div>
      ) : null}
      {meshes.length > 0 ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="absolute right-3 top-3"
          onClick={() => viewportRef.current?.fit()}
        >
          {t("fit")}
        </Button>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm border bg-background/90 px-2 py-1 font-mono text-xs text-muted-foreground">
        {t("orientation", { plane: "XY" })}
      </div>
    </section>
  )
}
