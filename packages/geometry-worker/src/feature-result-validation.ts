export type GeometryFeatureKind =
  | "boolean"
  | "box"
  | "cylinder"
  | "datum-plane"
  | "extrusion"
  | "multi-extrusion"
  | "multi-extrusion-modifying"
  | "revolve"
  | "multi-revolve"
  | "multi-revolve-modifying"

type FeatureResultMetrics = Readonly<{
  valid: boolean
  volume: number
  solidCount: number
}>

type DisposableShape = Readonly<{ delete(): unknown }>

export function featureSolidCountLimit(kind: GeometryFeatureKind, profileCount: number) {
  return kind === "multi-extrusion" || kind === "multi-revolve" ? profileCount : 1
}

export function featureResultMetricsAreValid(
  metrics: FeatureResultMetrics,
  maximumSolidCount: number,
) {
  return (
    metrics.valid &&
    metrics.solidCount >= 1 &&
    metrics.solidCount <= maximumSolidCount &&
    metrics.volume > 0
  )
}

export function disposeTemporaryShape(shape: DisposableShape | null) {
  if (!shape) return true
  try {
    shape.delete()
    return true
  } catch {
    return false
  }
}
