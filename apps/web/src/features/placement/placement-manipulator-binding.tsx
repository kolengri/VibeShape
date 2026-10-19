import type { DocumentDisplayUnits, FeatureId, VariableDefinition } from "@vibeshape/domain"
import { useEffect, useMemo } from "react"
import type { PlacementFormCopy } from "./placement-form"
import { type PlacementFormValues, parsePlacementForm } from "./placement-form-model"
import {
  type PlacementManipulationAxis,
  type PlacementManipulator,
  type PlacementSourceBounds,
  placementManipulatorFrame,
} from "./placement-manipulator"

export function PlacementManipulatorBinding({
  values,
  variables,
  units,
  copy,
  featureId,
  sourceBounds,
  disabled,
  axis,
  onManipulatorChange,
  onTranslationChange,
  onRotationChange,
}: {
  values: PlacementFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: PlacementFormCopy
  featureId: FeatureId
  sourceBounds: PlacementSourceBounds | null | undefined
  disabled: boolean
  axis: PlacementManipulationAxis
  onManipulatorChange: (value: PlacementManipulator | null) => void
  onTranslationChange: (value: readonly [number, number, number]) => void
  onRotationChange: (axis: "x" | "y" | "z", angle: number) => void
}) {
  const frame = useMemo(() => {
    const parsed = parsePlacementForm(values, variables, units, copy)
    return parsed.ok && sourceBounds ? placementManipulatorFrame(parsed, sourceBounds) : null
  }, [values, variables, units, copy, sourceBounds])
  useEffect(() => {
    if (disabled || !frame) {
      onManipulatorChange(null)
      return
    }
    let active = true
    onManipulatorChange(
      axis === "translation"
        ? {
            translationGizmo: {
              featureId,
              position: frame.position,
              onPositionChange(position) {
                if (!active) return
                const translation = frame.translationForPosition(position)
                if (translation) onTranslationChange(translation)
              },
            },
          }
        : {
            angularGizmo: {
              ...frame.rotation(axis),
              featureId,
              onAngleChange(angle) {
                if (active && Number.isFinite(angle) && Math.abs(angle) <= 2 * Math.PI)
                  onRotationChange(axis, angle)
              },
            },
          },
    )
    return () => {
      active = false
      onManipulatorChange(null)
    }
  }, [axis, disabled, featureId, frame, onManipulatorChange, onRotationChange, onTranslationChange])
  return null
}
