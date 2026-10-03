import { useTranslations } from "@vibeshape/i18n"
import { checkPrintVolume } from "@vibeshape/print-analysis"
import type { PrinterProfile, PrintPreparationResult } from "@vibeshape/protocol"
import { PrintPreparationPreview } from "./print-preparation-preview"
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
  const report =
    profile && result.meshes.length > 0 ? checkPrintVolume(result.meshes, profile) : null
  return (
    <>
      <PrintPreparationPreview
        result={result}
        profile={profile}
        onLayFace={onLayFace}
        disabled={disabled}
      />
      {profile ? (
        <PrintVolumeStatus profile={profile} report={report} />
      ) : (
        <p className="text-xs text-muted-foreground">{t("printerHint")}</p>
      )}
    </>
  )
}
