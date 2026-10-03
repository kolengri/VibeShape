import type { DocumentDisplayUnits, FeatureId } from "@vibeshape/domain"
import { useEffect } from "react"
import { defaultLengthExpression } from "../../document/document-display-units"
import type { PrimitiveOriginField } from "./primitive-form"

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

export function usePrimitivePlacementRequest({
  disabled,
  displayUnit,
  featureId,
  form,
  onBeforeChange,
  placementRequest,
}: Readonly<{
  disabled: boolean
  displayUnit: DocumentDisplayUnits["length"]
  featureId: FeatureId
  form: Readonly<{ setFieldValue: (field: PrimitiveOriginField, value: string) => void }>
  onBeforeChange: () => void
  placementRequest: PrimitivePlacementRequest | null | undefined
}>) {
  useEffect(() => {
    if (disabled || !placementRequest || placementRequest.featureId !== featureId) return
    const [x, y, z] = placementRequest.position
    onBeforeChange()
    form.setFieldValue("originX", defaultLengthExpression(x, displayUnit))
    form.setFieldValue("originY", defaultLengthExpression(y, displayUnit))
    form.setFieldValue("originZ", defaultLengthExpression(z, displayUnit))
  }, [disabled, displayUnit, featureId, form, onBeforeChange, placementRequest])
}
