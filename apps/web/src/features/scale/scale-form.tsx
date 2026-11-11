import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import {
  PreviewedParameterPanel,
  type PreviewedParameterPanelCopy,
} from "../part-design/previewed-parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureOrReport,
} from "../part-design/primitive-form"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import {
  parseScaleForm,
  type ScaleCenterKind,
  type ScaleFormMode,
  type ScaleValidationCopy,
  scaleFeatureRecord,
  scaleFormValues,
} from "./scale-form-model"

const centerKinds = ["bounding-box-center", "origin", "point"] as const satisfies ScaleCenterKind[]
const pointFields = ["centerX", "centerY", "centerZ"] as const

export type ScaleFormCopy = PreviewedParameterPanelCopy &
  ScaleValidationCopy & {
    factor: string
    factorDescription: string
    center: string
    centerDescription: string
    centerKinds: Readonly<Record<ScaleCenterKind, string>>
    centerX: string
    centerY: string
    centerZ: string
    coordinateDescription: string
    validationSummary: string
    staleRevision: string
    saveFailed: string
  }
type ScaleFormProps = FeatureParameterFormProps<ScaleFormMode, ScaleFormCopy> & {
  onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
}

function ScalePreview(props: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ onPreviewChange: props.onPreviewChange, preview: props.feature })
  return null
}

export function ScaleForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
  variables,
}: ScaleFormProps) {
  const state = useParameterFormState(variables)
  const [featureId] = useState<FeatureId>(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const parse = (values: Parameters<typeof parseScaleForm>[0]) =>
    parseScaleForm(values, variables, state.displayUnits, copy)
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: scaleFormValues(mode, state.displayUnits),
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parse(value)
        return parsed.ok ? undefined : { form: copy.validationSummary, fields: parsed.issues }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = parse(value)
      if (disabled || !isFeaturePreviewReady(previewStatus) || !parsed.ok) return
      await submitFeatureOrReport({
        baseRevision,
        copy,
        feature: scaleFeatureRecord(mode, featureId, parsed),
        onSave,
        onSaved,
        setMessage: state.setMessage,
        saveFailed: copy.saveFailed,
      })
    },
  })
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        {onPreviewChange && (
          <form.Subscribe selector={(formState) => formState.values}>
            {(values) => {
              const parsed = parse(values)
              return (
                <ScalePreview
                  feature={parsed.ok ? scaleFeatureRecord(mode, featureId, parsed) : null}
                  onPreviewChange={onPreviewChange}
                />
              )
            }}
          </form.Subscribe>
        )}
        <form.Subscribe
          selector={(formState) => [formState.isSubmitting, formState.values.center] as const}
        >
          {([pending, center]) => (
            <PreviewedParameterPanel
              copy={copy}
              previewStatus={previewStatus}
              disabled={disabled}
              pending={pending}
              message={state.message}
              onCancel={onCancel}
            >
              <form.AppField name="factor">
                {(field) => (
                  <field.LengthExpressionField
                    id="scale-factor"
                    label={copy.factor}
                    description={copy.factorDescription}
                    suggestions={state.suggestions}
                    onValueChange={state.clearSubmissionErrors}
                  />
                )}
              </form.AppField>
              <form.AppField name="center">
                {(field) => (
                  <field.ChoiceField
                    className="[&>fieldset]:grid [&>fieldset]:grid-cols-1"
                    label={copy.center}
                    description={copy.centerDescription}
                    onValueChange={state.clearSubmissionErrors}
                    options={centerKinds.map((kind) => ({
                      value: kind,
                      label: copy.centerKinds[kind],
                    }))}
                  />
                )}
              </form.AppField>
              {center === "point" &&
                pointFields.map((name) => (
                  <form.AppField name={name} key={name}>
                    {(field) => (
                      <field.LengthExpressionField
                        id={`scale-${name}`}
                        label={copy[name]}
                        description={copy.coordinateDescription}
                        suggestions={state.suggestions}
                        onValueChange={state.clearSubmissionErrors}
                      />
                    )}
                  </form.AppField>
                ))}
            </PreviewedParameterPanel>
          )}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}
