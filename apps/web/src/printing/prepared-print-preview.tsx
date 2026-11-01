import { useTranslations } from "@vibeshape/i18n"
import { checkPrintVolume, type PrintReadinessResult } from "@vibeshape/print-analysis"
import type { PrinterProfile, PrintPreparationResult } from "@vibeshape/protocol"
import { useCallback, useState } from "react"
import { PrintPreparationPreview } from "./print-preparation-preview"
import { PrintReadinessPanel } from "./print-readiness-panel"
import { PrintVolumeStatus } from "./print-volume-status"

export function PreparedPrintPreview({
  result,
  profile,
  onLayFace,
  disabled,
}: {
  result: PrintPreparationResult
  disabled: boolean
  profile: PrinterProfile | null
  onLayFace: (meshIndex: number, triangleIndex: number) => Promise<void>
}) {
  const t = useTranslations("app.printPreparation")
  const [analysis, setAnalysis] = useState<{
    source: PrintPreparationResult
    report: PrintReadinessResult | null
  } | null>(null)
  const setReadiness = useCallback(
    (report: PrintReadinessResult | null) => setAnalysis({ source: result, report }),
    [result],
  )
  const readiness = analysis?.source === result ? analysis.report : null
  const report =
    profile && result.meshes.length > 0 ? checkPrintVolume(result.meshes, profile) : null
  return (
    <>
      <PrintPreparationPreview
        result={result}
        profile={profile}
        onLayFace={onLayFace}
        disabled={disabled}
        readiness={readiness}
      />
      <PrintReadinessPanel result={result} onResult={setReadiness} />
      {profile ? (
        <PrintVolumeStatus profile={profile} report={report} />
      ) : (
        <p className="text-xs text-muted-foreground">{t("printerHint")}</p>
      )}
    </>
  )
}
