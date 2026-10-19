import type { PartId } from "@vibeshape/domain/identifiers"

export type PartVisibilityOverrides = Readonly<Partial<Record<PartId, boolean>>>
export type PartVisibilityControl = Readonly<{
  overrides: PartVisibilityOverrides
  setOverride: (partId: PartId, visible: boolean) => void
  clearOverride: (partId: PartId) => void
}>

export function effectivePartVisibility(
  part: Readonly<{ id: PartId; visible: boolean }>,
  overrides?: PartVisibilityOverrides,
) {
  return overrides?.[part.id] ?? part.visible
}
