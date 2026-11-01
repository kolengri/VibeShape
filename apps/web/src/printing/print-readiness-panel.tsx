import { useFormatter, useTranslations } from "@vibeshape/i18n"
import { analyzePrintReadiness, type PrintReadinessResult } from "@vibeshape/print-analysis"
import type { PrintPreparationResult } from "@vibeshape/protocol"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { useId } from "react"
import { usePrintReadinessAnalysis } from "./use-print-readiness-analysis"

function PrintReadinessReport({ report }: { report: PrintReadinessResult }) {
  const t = useTranslations("app.printReadiness")
  const formatter = useFormatter()
  const thin = report.bodies.reduce((sum, body) => sum + body.thinTriangles.length, 0)
  const overhang = report.bodies.reduce((sum, body) => sum + body.overhangTriangles.length, 0)
  const unknown = report.bodies.reduce((sum, body) => sum + body.unknownTriangles, 0)
  return (
    <div role="status" className="grid gap-1 text-xs">
      <p className="font-medium">{t(report.status)}</p>
      <p>{t("counts", { thin, overhang, unknown })}</p>
      <ul className="grid gap-1">
        {report.bodies.map((body, index) => (
          <li key={`${index}:${body.name}`}>
            <span className="font-medium">{body.name}: </span>
            {body.minimumThicknessMm === null
              ? t("unknownMinimum")
              : t("minimum", {
                  value: formatter.number(body.minimumThicknessMm, {
                    maximumFractionDigits: 3,
                  }),
                })}
            <span className="block text-muted-foreground">
              {t("areas", {
                thin: formatter.number(body.thinAreaMm2, { maximumFractionDigits: 2 }),
                overhang: formatter.number(body.overhangAreaMm2, { maximumFractionDigits: 2 }),
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t("legend")}</p>
    </div>
  )
}

export function PrintReadinessPanel({
  result,
  onResult,
  analyze = analyzePrintReadiness,
}: {
  result: PrintPreparationResult
  onResult: (result: PrintReadinessResult | null) => void
  analyze?: typeof analyzePrintReadiness
}) {
  const t = useTranslations("app.printReadiness")
  const id = useId()
  const { wall, setWall, angle, setAngle, pending, progress, report, error, run, cancel } =
    usePrintReadinessAnalysis(result, onResult, analyze)
  return (
    <section
      className="grid gap-3 rounded-md border p-3"
      aria-label={t("title")}
      aria-busy={pending}
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs" htmlFor={`${id}-wall`}>
          {t("wall")}
          <Input
            id={`${id}-wall`}
            type="number"
            min="0.01"
            step="0.1"
            value={wall}
            onChange={(event) => setWall(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs" htmlFor={`${id}-angle`}>
          {t("angle")}
          <Input
            id={`${id}-angle`}
            type="number"
            min="0"
            max="90"
            value={angle}
            onChange={(event) => setAngle(event.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !wall.trim() || !angle.trim()}
          onClick={() => void run()}
        >
          {t("analyze")}
        </Button>
        {pending ? (
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
      {pending ? (
        <div role="status" className="grid gap-1 text-xs">
          <span>{t("pending")}</span>
          <progress aria-label={t("pending")} max={1} value={progress} className="w-full" />
        </div>
      ) : null}
      {error ? <Alert>{t("failed")}</Alert> : null}
      {report ? <PrintReadinessReport report={report} /> : null}
      <p className="text-xs text-muted-foreground">{t("limits")}</p>
    </section>
  )
}
