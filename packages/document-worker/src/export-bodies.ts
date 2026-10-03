import type { DocumentExportBodies, FeatureEvaluationDependency } from "@vibeshape/protocol"

function bodyKey(body: { featureId: string; outputRole?: string | undefined }) {
  return `${body.featureId}:${body.outputRole ?? "result"}`
}

/** Keep the terminal dependency identity, including legacy aggregate cache keys. */
export function selectExportBodies(
  terminal: readonly FeatureEvaluationDependency[],
  requested?: DocumentExportBodies,
) {
  if (!requested) return { features: terminal, names: new Map<string, string>() }
  const current = new Map(terminal.map((body) => [bodyKey(body), body]))
  const names = new Map<string, string>()
  const features = requested.map((body) => {
    const key = bodyKey(body)
    const exact = current.get(key)
    if (!exact) throw new Error("An export body is no longer a current terminal body.")
    current.delete(key)
    if (body.name) names.set(key, body.name)
    return exact
  })
  return { features, names }
}

export function exportBodyName(
  body: { featureId: string; outputRole?: string | undefined },
  names: ReadonlyMap<string, string>,
) {
  return names.get(bodyKey(body))
}
