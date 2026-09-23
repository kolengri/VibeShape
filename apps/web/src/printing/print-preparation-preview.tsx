import { useTranslations } from "@vibeshape/i18n"
import type { PrintPreparationResult } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import type { GeometryViewport, ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useRef, useState } from "react"

function previewMeshes(result: PrintPreparationResult): ViewerMesh[] {
  return result.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.vertices)
    const indices = new Uint32Array(mesh.triangles)
    const sourceNormals = result.normals[index]
    if (!sourceNormals) throw new Error("Prepared print normals are missing.")
    const normals = new Float32Array(sourceNormals)
    return {
      featureId: `print-${index}`,
      appearance: index < result.report.bodyCount ? "model" : "preview",
      positions,
      normals,
      indices,
      triangleFaceIds: new Uint32Array(indices.length / 3),
    }
  })
}

export function PrintPreparationPreview({ result }: { result: PrintPreparationResult }) {
  const t = useTranslations("app.printPreparation")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewport | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    const canvas = canvasRef.current
    if (!canvas) return
    void import("@vibeshape/viewer/three-viewport")
      .then(({ createGeometryViewport }) => {
        if (disposed) return
        const viewport = createGeometryViewport(canvas, {})
        viewportRef.current = viewport
        viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
        viewport.setMeshes(previewMeshes(result))
        viewport.fit()
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      viewportRef.current?.dispose()
      viewportRef.current = null
    }
  }, [result])
  return (
    <div className="grid gap-2">
      <div className="relative h-72 min-w-0 overflow-hidden rounded-md border bg-background">
        <canvas ref={canvasRef} className="h-full w-full" aria-label={t("previewLabel")} />
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("previewFailed")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => viewportRef.current?.fit()}
        >
          {t("fit")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("navigation")}</p>
      </div>
    </div>
  )
}
