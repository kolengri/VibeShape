import type { DocumentExportBodies, FeatureEvaluationDependency } from "@vibeshape/protocol"

type ExportAppearance = NonNullable<DocumentExportBodies[number]["appearance"]>

function bodyKey(body: { featureId: string; outputRole?: string | undefined }) {
  return `${body.featureId}:${body.outputRole ?? "result"}`
}

/** Keep the terminal dependency identity, including legacy aggregate cache keys. */
export function selectExportBodies(
  terminal: readonly FeatureEvaluationDependency[],
  requested?: DocumentExportBodies,
) {
  const names = new Map<string, string>()
  const appearances = new Map<string, ExportAppearance>()
  if (!requested) return { features: terminal, names, appearances }
  const current = new Map(terminal.map((body) => [bodyKey(body), body]))
  const features = requested.map((body) => {
    const key = bodyKey(body)
    const exact = current.get(key)
    if (!exact) throw new Error("An export body is no longer a current terminal body.")
    current.delete(key)
    if (body.name) names.set(key, body.name)
    if (body.appearance) appearances.set(key, body.appearance)
    return exact
  })
  return { features, names, appearances }
}

export function exportBodyName(
  body: { featureId: string; outputRole?: string | undefined },
  names: ReadonlyMap<string, string>,
) {
  return names.get(bodyKey(body))
}

export function exportBodyAppearance(
  body: { featureId: string; outputRole?: string | undefined },
  appearances: ReadonlyMap<string, ExportAppearance>,
) {
  return appearances.get(bodyKey(body))
}
