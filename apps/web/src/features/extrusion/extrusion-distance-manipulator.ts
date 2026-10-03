import type { FeatureId } from "@vibeshape/domain"

export type ExtrusionDistanceRequest = Readonly<{
  distance: number
  featureId: FeatureId
  sequence: number
  side?: "first" | "second"
}>

export function finiteExtrusionDistance(distance: number): boolean {
  return Number.isFinite(distance) && distance > 0
}
