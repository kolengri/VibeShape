import type { DocumentDisplayUnits, FeatureId, VariableDefinition } from "@vibeshape/domain"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { useEffect, useMemo } from "react"
import type { SplitFormCopy } from "./split-form"
import { parseSplitForm, type SplitBounds, type SplitFormValues } from "./split-form-model"
import {
  type SplitManipulator,
  type SplitPlaneResolver,
  splitManipulatorFrame,
  splitSupportPlane,
} from "./split-manipulator"

export function SplitManipulatorBinding({
  values,
  variables,
  units,
  copy,
  featureId,
  sourceBounds,
  referencePlane,
  resolvePlane,
  disabled,
  onManipulatorChange,
  onOffsetChange,
}: {
  values: SplitFormValues
  variables: readonly VariableDefinition[]
  units: DocumentDisplayUnits
  copy: SplitFormCopy
  featureId: FeatureId
  sourceBounds: SplitBounds | null
  referencePlane: ReferencePlane | null | undefined
  resolvePlane: SplitPlaneResolver | undefined
  disabled: boolean
  onManipulatorChange: (value: SplitManipulator | null) => void
  onOffsetChange: (offset: number) => void
}) {
  const frame = useMemo(() => {
    const parsed = parseSplitForm(values, variables, units, copy)
    const plane = splitSupportPlane(referencePlane, values.plane, resolvePlane)
    return parsed.ok && plane && sourceBounds
      ? splitManipulatorFrame(plane, sourceBounds, parsed.offset.value)
      : null
  }, [values, variables, units, copy, sourceBounds, referencePlane, resolvePlane])
  useEffect(() => {
    if (disabled || !frame) {
      onManipulatorChange(null)
      return
    }
    let active = true
    onManipulatorChange({
      toolPlane: frame.toolPlane,
      axialGizmo: {
        origin: frame.origin,
        direction: frame.direction,
        distance: frame.distance,
        distanceRange: { min: -100_000, max: 100_000 },
        featureId,
        onDistanceChange(offset) {
          if (active && Number.isFinite(offset) && Math.abs(offset) <= 100_000)
            onOffsetChange(offset)
        },
      },
    })
    return () => {
      active = false
      onManipulatorChange(null)
    }
  }, [disabled, featureId, frame, onManipulatorChange, onOffsetChange])
  return null
}
