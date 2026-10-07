export type GeometryFeatureKind =
  | "fdm"
  | "boolean"
  | "fillet"
  | "chamfer"
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "pyramid"
  | "torus"
  | "placement"
  | "mirror"
  | "shell"
  | "thread"
  | "imported"
  | "split"
  | "pattern"
  | "loft"
  | "sweep"
  | "compound"
  | "union"
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
  if (kind === "split") return 2
  return kind === "multi-extrusion" ||
    kind === "multi-revolve" ||
    kind === "compound" ||
    kind === "pattern" ||
    kind === "imported"
    ? profileCount
    : 1
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
