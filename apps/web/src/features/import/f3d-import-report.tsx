import type { F3dReport } from "@vibeshape/formats/f3d"
import { useTranslations } from "@vibeshape/i18n"

export function F3dImportReport({
  report,
  editableExtrusion,
}: {
  report: F3dReport
  editableExtrusion: boolean
}) {
  const t = useTranslations("app.import")
  return (
    <section className="grid gap-2 text-xs" aria-label={t("f3dReport")}>
      <p>
        {t("f3dSummary", {
          bodies: report.recoveredBodies,
          sketches: report.editableSketches,
          parameters: report.numericParameters,
        })}
      </p>
      <p>{t(editableExtrusion ? "f3dEditableExtrusion" : "f3dExactFallback")}</p>
      {report.unsupported.length > 0 && (
        <details>
          <summary>{t("f3dUnsupported", { count: report.unsupported.length })}</summary>
          <ul className="grid gap-1 pt-2">
            {report.unsupported.map((entry, index) => (
              <li key={`${index}.${entry.name}`}>
                <strong>{entry.name}</strong>: {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
