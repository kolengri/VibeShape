import { useTranslations } from "@vibeshape/i18n"
import { checkPrintVolume, type PrintReadinessResult } from "@vibeshape/print-analysis"
import type { PrinterProfile, PrintPreparationResult } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import type { GeometryViewport, ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useRef, useState } from "react"
import { printReadinessPreviewMeshes } from "./print-readiness-preview-meshes"

function selectedPrintFacet(selection: ViewerSelection | null, bodyCount: number) {
  if (!selection) return null
  const meshIndex = Number(selection.featureId.slice("print-".length))
  const triangleIndex = selection.faceId - 1
  return Number.isInteger(meshIndex) &&
    meshIndex >= 0 &&
    meshIndex < bodyCount &&
    triangleIndex >= 0
    ? { meshIndex, triangleIndex }
    : null
}

export function PrintPreparationPreview({
  result,
  profile = null,
  onLayFace,
  disabled = false,
  readiness = null,
}: {
  result: PrintPreparationResult
  disabled?: boolean
  readiness?: PrintReadinessResult | null
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
  const readinessRef = useRef(readiness)
  readinessRef.current = readiness
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
            setFacet(selectedPrintFacet(selection, result.report.bodyCount))
          },
        })
        viewportRef.current = viewport
        viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
        viewport.setMeshes(printReadinessPreviewMeshes(result, readinessRef.current))
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
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.setPrintBed(bed)
    viewport.setMeshes(printReadinessPreviewMeshes(result, readiness))
  }, [bed, result, readiness])
  return (
    <div className="grid gap-2">
      <div className="relative h-72 min-w-0 overflow-hidden rounded-md border bg-background">
        <canvas ref={canvasRef} className="h-full w-full" aria-label={t("previewLabel")} />
      </div>
      {failed ? <Alert>{t("previewFailed")}</Alert> : null}
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
