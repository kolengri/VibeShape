import { useTranslations } from "@vibeshape/i18n"
import type { PrintVolumeResult } from "@vibeshape/print-analysis"
import type { PrinterProfile } from "@vibeshape/protocol"
import { cn } from "@vibeshape/ui/lib/cn"

export function PrintVolumeStatus({
  profile,
  report,
  compact = false,
}: {
  profile: PrinterProfile
  report: PrintVolumeResult | null
  compact?: boolean
}) {
  const t = useTranslations("app.printer")
  return (
    <div
      role="status"
      className={cn("grid gap-1 text-xs", {
        "text-destructive": report !== null && !report.fits,
      })}
    >
      <p>
        {t("dimensions", {
          name: profile.name,
          width: profile.width,
          depth: profile.depth,
          height: profile.height,
        })}
      </p>
      <p>{t(report === null ? "unknown" : report.fits ? "fits" : "exceeds")}</p>
      {report?.overruns.map((overrun) => (
        <p key={`${overrun.axis}-${overrun.side}`}>
          {t("overrun", {
            axis: overrun.axis.toUpperCase(),
            side: t(overrun.side),
            distance: overrun.millimeters.toFixed(2),
          })}
        </p>
      ))}
      {!compact ? <p className="text-muted-foreground">{t("advisory")}</p> : null}
    </div>
  )
}
