import { useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useCallback, useState } from "react"
import {
  defaultAngleExpression,
  defaultLengthExpression,
} from "../../document/document-display-units"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { PlacementFormCopy } from "./placement-form"
import {
  type PlacementFormMode,
  parsePlacementForm,
  placementAxes,
  placementFeatureRecord,
  placementFieldName,
  placementFormValues,
} from "./placement-form-model"
import type { PlacementManipulationAxis, PlacementSourceBounds } from "./placement-manipulator"

type PlacementDraftInput = FeatureParameterFormProps<PlacementFormMode, PlacementFormCopy> & {
  sourceBounds?: PlacementSourceBounds | null | undefined
}
type Vector = readonly [number, number, number]

/** Owns draft expressions, preview/gesture lifetime, and the single feature submission. */
export function usePlacementDraft(input: PlacementDraftInput) {
  const state = useParameterFormState(input.variables)
  const [previewEnabled, setPreviewEnabled] = useState(true)
  const [interactive, setInteractive] = useState(true)
  const [manipulationAxis, setManipulationAxis] = useState<PlacementManipulationAxis>("translation")
  const [featureId] = useState(() =>
    input.mode.kind === "edit" ? input.mode.feature.id : input.mode.createFeatureId(),
  )
  const form = useAppForm({
    defaultValues: placementFormValues(input.mode, state.displayUnits),
    onSubmit: async ({ value }) => {
      if (input.sourceBounds === null) return
      const parsed = parsePlacementForm(value, input.variables, state.displayUnits, input.copy)
      if (!parsed.ok) {
        state.setIssues(parsed.issues)
        state.setMessage(input.copy.validationSummary)
        return
      }
      state.setIssues({})
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision: input.baseRevision,
          copy: input.copy,
          feature: placementFeatureRecord(input.mode, featureId, parsed),
          onSave: input.onSave,
          onSaved: () => {
            setInteractive(false)
            input.onSaved()
          },
          setMessage: state.setMessage,
        })
      } catch {
        state.setMessage(input.copy.saveFailed)
      }
    },
  })
  const changeTranslation = useCallback(
    (translation: Vector) => {
      state.clearSubmissionErrors()
      for (const [index, axis] of placementAxes.entries())
        form.setFieldValue(
          placementFieldName("translation", axis),
          defaultLengthExpression(translation[index] as number, state.displayUnits.length),
        )
    },
    [form, state.clearSubmissionErrors, state.displayUnits.length],
  )
  const changeRotation = useCallback(
    (axis: "x" | "y" | "z", angle: number) => {
      state.clearSubmissionErrors()
      form.setFieldValue(
        placementFieldName("rotation", axis),
        defaultAngleExpression(angle, state.displayUnits.angle),
      )
    },
    [form, state.clearSubmissionErrors, state.displayUnits.angle],
  )
  function beforeEdit() {
    setPreviewEnabled(true)
    state.clearSubmissionErrors()
  }
  function align({ translation, rotation }: { translation: Vector; rotation: Vector }) {
    beforeEdit()
    changeTranslation(translation)
    for (const [index, axis] of placementAxes.entries())
      changeRotation(axis, rotation[index] as number)
  }
  return {
    form,
    state,
    featureId,
    previewEnabled,
    interactive,
    manipulationAxis,
    changeTranslation,
    changeRotation,
    beforeEdit,
    align,
    pickFaces: () => setPreviewEnabled(false),
    selectAxis: (axis: PlacementManipulationAxis) => {
      setPreviewEnabled(true)
      setManipulationAxis(axis)
    },
    cancel: () => {
      setInteractive(false)
      input.onCancel()
    },
  }
}
