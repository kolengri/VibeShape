import { readSplitFeatureParametersV2 } from "@vibeshape/domain/part-design-split"
import type { ReferencePlane } from "@vibeshape/domain/reference-frame"
import { useCallback, useState } from "react"
import { defaultLengthExpression } from "../../document/document-display-units"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { SplitFormCopy } from "./split-form"
import {
  parseSplitForm,
  type SplitBounds,
  type SplitFormMode,
  splitFeatureRecord,
  splitFormValues,
  splitMidpointExpression,
} from "./split-form-model"
import { type SplitPlaneResolver, splitSupportPlane } from "./split-manipulator"

type SplitDraftInput = FeatureParameterFormProps<SplitFormMode, SplitFormCopy> & {
  sourceBounds: SplitBounds | null
  resolvePlane?: SplitPlaneResolver | undefined
}

/** Owns support selection, exact offset expressions, gesture lifetime, and Apply. */
export function useSplitDraft(input: SplitDraftInput) {
  const state = useParameterFormState(input.variables)
  const [interactive, setInteractive] = useState(true)
  const [referencePlane, setReference] = useState<ReferencePlane | null | undefined>(() =>
    input.mode.kind === "edit"
      ? readSplitFeatureParametersV2(input.mode.feature)?.plane
      : undefined,
  )
  const [featureId] = useState(() =>
    input.mode.kind === "edit" ? input.mode.feature.id : input.mode.createFeatureId(),
  )
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: splitFormValues(input.mode, input.sourceBounds, state.displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseSplitForm(value, input.variables, state.displayUnits, input.copy)
        return parsed.ok ? undefined : { form: input.copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      if (
        !input.sourceBounds ||
        referencePlane === null ||
        !splitSupportPlane(referencePlane, value.plane, input.resolvePlane)
      )
        return
      const parsed = parseSplitForm(value, input.variables, state.displayUnits, input.copy)
      if (!parsed.ok) return

      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision: input.baseRevision,
          copy: input.copy,
          feature: splitFeatureRecord(input.mode, featureId, parsed, referencePlane),
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
  const changeOffset = useCallback(
    (offset: number) => {
      state.clearSubmissionErrors()
      form.setFieldValue("offset", defaultLengthExpression(offset, state.displayUnits.length))
    },
    [form, state.clearSubmissionErrors, state.displayUnits.length],
  )
  return {
    form,
    state,
    interactive,
    featureId,
    referencePlane,
    setReference,
    changeOffset,
    referenceAvailable: Boolean(
      splitSupportPlane(referencePlane, form.state.values.plane, input.resolvePlane),
    ),
    midpoint: () => {
      if (!input.sourceBounds) return
      state.clearSubmissionErrors()
      form.setFieldValue(
        "offset",
        splitMidpointExpression(input.sourceBounds, form.state.values.plane, state.displayUnits),
      )
    },
    cancel: () => {
      setInteractive(false)
      input.onCancel()
    },
  }
}
