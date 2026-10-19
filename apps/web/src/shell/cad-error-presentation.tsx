import type { DocumentSnapshot } from "@vibeshape/domain"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import { useLocale, useTranslations } from "@vibeshape/i18n"

export type CadDiagnosticEntry = ModelDiagnosticsEvidence["entries"][number]
export type CadErrorKind =
  | "missingSketch"
  | "missingSupport"
  | "missingProfile"
  | "ambiguousProfile"
  | "invalidProfile"
  | "solveFailed"
  | "solverUnavailable"
  | "dependencyBlocked"
  | "endCondition"
  | "bodyMissing"
  | "expression"
  | "unknown"

const codeKinds = new Map<string, CadErrorKind>([
  ["org.vibeshape.feature.sketch-missing", "missingSketch"],
  ["org.vibeshape.feature.sketch-support-missing", "missingSupport"],
  ["org.vibeshape.feature.sketch-profile-missing", "missingProfile"],
  ["org.vibeshape.feature.sketch-profile-ambiguous", "ambiguousProfile"],
  ["org.vibeshape.feature.sketch-profile-invalid", "invalidProfile"],
  ["org.vibeshape.feature.sketch-solve-failed", "solveFailed"],
  ["org.vibeshape.feature.sketch-solver-unavailable", "solverUnavailable"],
  ["org.vibeshape.feature.dependency-blocked", "dependencyBlocked"],
  ["org.vibeshape.feature.parameter-expression-failed", "expression"],
])
const reasonKinds = new Map<string, CadErrorKind>([
  ["extrusion-end-support-stale-or-unreachable", "endCondition"],
  ["invalid-extrusion-end", "endCondition"],
  ["missing-feature-dependency", "bodyMissing"],
])

export function cadErrorKind(entry: CadDiagnosticEntry): CadErrorKind {
  const reason = entry.values.reason
  const specific = typeof reason === "string" ? reasonKinds.get(reason) : undefined
  return specific ?? codeKinds.get(entry.code) ?? "unknown"
}

function relatedLabels(diagnostics: readonly CadDiagnosticEntry[], snapshot: DocumentSnapshot) {
  const labels = new Map<string, string>()
  for (const sketch of snapshot.sketches) labels.set(sketch.id, sketch.label)
  for (const feature of snapshot.features) {
    if (feature.label) labels.set(feature.id, feature.label)
  }
  const ids = diagnostics.flatMap((entry) => [
    ...(entry.blockedBy ?? []),
    entry.supportFeatureId,
    entry.values.sketchId,
    entry.values.targetFeatureId,
  ])
  return [
    ...new Set(
      ids.flatMap((id) => {
        const label = typeof id === "string" ? labels.get(id) : undefined
        return label ? [label] : []
      }),
    ),
  ]
}

export function CadErrorPresentation({
  diagnostics,
  snapshot,
  rawDiagnostic,
  contextLabels = [],
}: {
  diagnostics: readonly CadDiagnosticEntry[]
  snapshot: DocumentSnapshot
  rawDiagnostic?: string | undefined
  contextLabels?: readonly string[]
}) {
  const t = useTranslations("app.shell.cadError")
  const locale = useLocale()
  const first = diagnostics[0]
  if (!first) return null
  const kind = cadErrorKind(first)
  const labels = [...new Set([...contextLabels, ...relatedLabels(diagnostics, snapshot)])]
  return (
    <section
      className="mb-3 grid min-w-0 gap-2 rounded-md border border-destructive/40 bg-panel-muted p-3 text-xs text-destructive [overflow-wrap:anywhere]"
      role="alert"
      aria-live="polite"
      aria-label={t("title")}
    >
      <p className="font-medium">{t(`cause.${kind}`)}</p>
      <p>{t(`nextStep.${kind}`)}</p>
      {labels.length > 0 ? (
        <p className="text-muted-foreground">
          {t("related", {
            labels: new Intl.ListFormat(locale, { type: "conjunction" }).format(labels),
          })}
        </p>
      ) : null}
      <details className="min-w-0 text-muted-foreground">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          {t("technicalDetails")}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm border bg-background p-2 font-mono text-[11px]">
          {JSON.stringify(
            { diagnostics, ...(rawDiagnostic ? { message: rawDiagnostic } : {}) },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  )
}
