import { useTranslations } from "@vibeshape/i18n"
import { checkPrintVolume } from "@vibeshape/print-analysis"
import type { PrinterProfile, PrintPreparationResult } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import type { GeometryViewport, ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useRef, useState } from "react"

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
      triangleFaceIds: Uint32Array.from(
        { length: indices.length / 3 },
        (_, triangle) => triangle + 1,
      ),
    }
  })
}

export function PrintPreparationPreview({
  result,
  profile = null,
  onLayFace,
  disabled = false,
}: {
  result: PrintPreparationResult
  disabled?: boolean
  profile?: PrinterProfile | null
  onLayFace?: (meshIndex: number, triangleIndex: number) => Promise<void>
}) {
  const t = useTranslations("app.printPreparation")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<GeometryViewport | null>(null)
  const [failed, setFailed] = useState(false)
  const [facet, setFacet] = useState<{ meshIndex: number; triangleIndex: number } | null>(null)
  const bed = useMemo(
    () =>
      profile ? { ...profile, exceeded: !checkPrintVolume(result.meshes, profile).fits } : null,
    [profile, result],
  )
  const bedRef = useRef(bed)
  bedRef.current = bed
  useEffect(() => {
    let disposed = false
    setFailed(false)
    setFacet(null)
    const canvas = canvasRef.current
    if (!canvas) return
    void import("@vibeshape/viewer/three-viewport")
      .then(({ createGeometryViewport }) => {
        if (disposed) return
        const viewport = createGeometryViewport(canvas, {
          onSelectionChange: (selection) => {
            const meshIndex = selection ? Number(selection.featureId.slice("print-".length)) : -1
            const triangleIndex = selection ? selection.faceId - 1 : -1
            setFacet(
              Number.isInteger(meshIndex) &&
                meshIndex >= 0 &&
                meshIndex < result.report.bodyCount &&
                triangleIndex >= 0
                ? { meshIndex, triangleIndex }
                : null,
            )
          },
        })
        viewportRef.current = viewport
        viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
        viewport.setMeshes(previewMeshes(result))
        viewport.setPrintBed(bedRef.current)
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
  useEffect(() => {
    viewportRef.current?.setPrintBed(bed)
  }, [bed])
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
        {onLayFace ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !facet}
            onClick={() =>
              !disabled && facet ? onLayFace(facet.meshIndex, facet.triangleIndex) : undefined
            }
          >
            {t("layFace")}
          </Button>
        ) : null}
      </div>
      {onLayFace ? <p className="text-xs text-muted-foreground">{t("selectFace")}</p> : null}
    </div>
  )
}
