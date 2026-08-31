import type { FeatureId } from "@vibeshape/domain"

export type PrimitivePlacement = readonly [number, number, number]

export type PrimitivePlacementRequest = Readonly<{
  featureId: FeatureId
  position: PrimitivePlacement
  sequence: number
}>

export function finitePrimitivePlacement(
  position: readonly number[],
): position is PrimitivePlacement {
  return position.length === 3 && position.every(Number.isFinite)
}
