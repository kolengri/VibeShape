import type { FeatureId } from "@vibeshape/domain"

export type RevolveAngleRequest = Readonly<{
  angle: number
  featureId: FeatureId
  sequence: number
}>

export function finiteRevolveAngle(angle: number) {
  return Number.isFinite(angle) && angle > 0 && angle <= Math.PI * 2
}
