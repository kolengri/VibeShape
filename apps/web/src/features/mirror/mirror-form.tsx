import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import {
  type MirrorFormMode,
  type MirrorPlane,
  mirrorFeatureRecord,
  mirrorInitialPlane,
} from "./mirror-form-model"

export type MirrorFormCopy = ParameterPanelCopy & {
  parameters: string
  plane: string
  submit: string
  staleRevision: string
  saveFailed: string
}
type MirrorFormProps = FeatureParameterFormProps<MirrorFormMode, MirrorFormCopy> & {
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}
function MirrorPreview({
  plane,
  mode,
  featureId,
  onPreviewChange,
}: {
  plane: MirrorPlane
  mode: MirrorFormMode
  featureId: FeatureId
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({
    onPreviewChange,
    preview: mirrorFeatureRecord(mode, featureId, plane),
  })
  return null
}
export function MirrorForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
}: MirrorFormProps) {
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const [message, setMessage] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: { plane: mirrorInitialPlane(mode) },
    onSubmit: async ({ value }) => {
      setMessage(null)
      try {
        await submitFeatureMutation({
          baseRevision,
          copy,
          feature: mirrorFeatureRecord(mode, featureId, value.plane),
          onSave,
          onSaved,
          setMessage,
        })
      } catch {
        setMessage(copy.saveFailed)
      }
    },
  })
  return (
    <Form form={form} aria-label={copy.title} className="gap-0">
      {onPreviewChange && (
        <form.Subscribe selector={(state) => state.values.plane}>
          {(plane) => (
            <MirrorPreview
              plane={plane}
              mode={mode}
              featureId={featureId}
              onPreviewChange={onPreviewChange}
            />
          )}
        </form.Subscribe>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <ParameterPanel
            copy={copy}
            legend={copy.parameters}
            disabled={disabled || pending}
            message={message}
            actions={
              <TaskPanelFormActions
                acceptLabel={copy.submit}
                ariaLabel={copy.title}
                cancelLabel={copy.cancel}
                disabled={disabled}
                onCancel={onCancel}
                previewStatus={previewStatus}
              />
            }
          >
            <form.Field name="plane">
              {(field) => (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-xs font-medium">{copy.plane}</legend>
                  {(["XY", "XZ", "YZ"] as const).map((plane) => (
                    <label key={plane} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="plane"
                        value={plane}
                        checked={field.state.value === plane}
                        onBlur={field.handleBlur}
                        onChange={() => {
                          setMessage(null)
                          field.handleChange(plane)
                        }}
                      />
                      {plane}
                    </label>
                  ))}
                </fieldset>
              )}
            </form.Field>
          </ParameterPanel>
        )}
      </form.Subscribe>
    </Form>
  )
}
