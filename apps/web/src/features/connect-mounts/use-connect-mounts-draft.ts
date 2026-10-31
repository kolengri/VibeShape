import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import {
  type ConnectMountsFormMode,
  connectMountsFormCandidate,
  initialConnectMountsValues,
  type ModelMountPoint,
} from "./connect-mounts-form-model"

export type ConnectMountsFormProps = Omit<
  FeatureParameterFormProps<ConnectMountsFormMode, never>,
  "copy"
> & {
  modelPoints: readonly ModelMountPoint[]
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}

export function useConnectMountsDraft(props: ConnectMountsFormProps) {
  const { mode, variables, disabled = false, previewStatus } = props
  const t = useTranslations("app.connectMounts")
  const state = useParameterFormState(variables)
  const [featureId] = useState<FeatureId>(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const [initialValues] = useState(() =>
    initialConnectMountsValues(mode, state.displayUnits.length),
  )
  const copy = {
    title: t(mode.kind === "edit" ? "editTitle" : "title"),
    description: t("description"),
    cancel: t("cancel"),
    invalidExpression: t("invalidExpression"),
    invalidDimension: t("invalidDimension"),
    invalidRange: t("invalidRange"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
  const candidate = (values: typeof initialValues) =>
    connectMountsFormCandidate(mode, featureId, values, variables, state.displayUnits.length, copy)
  const form = useAppForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const { feature } = candidate(value)
      if (!feature) return
      state.setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision: props.baseRevision,
          copy,
          feature,
          onSave: props.onSave,
          onSaved: props.onSaved,
          setMessage: state.setMessage,
        })
      } catch {
        state.setMessage(copy.saveFailed)
      }
    },
  })
  return { form, copy, candidate, state }
}

export type ConnectMountsDraft = ReturnType<typeof useConnectMountsDraft>
