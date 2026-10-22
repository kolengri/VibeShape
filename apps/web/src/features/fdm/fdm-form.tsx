import type { FeatureRecord, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { type Ref, useState } from "react"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import type { ExactBodyOption } from "../part-design/exact-body-options"
import { ParameterPanel } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferencePlaneSelection } from "../reference-geometry/reference-support-fields"
import {
  type FdmField,
  type FdmToolKind,
  fdmFieldDefinitions,
  fdmToolKinds,
} from "./fdm-form-fields"
import {
  activeFdmFields,
  type FdmFormMode,
  type FdmFormValues,
  fdmFormFeature,
  fdmFormValues,
  parseFdmForm,
} from "./fdm-form-model"
import { FdmToolIcon } from "./fdm-tool-icon"

type Props = FeatureParameterFormProps<FdmFormMode, never> & {
  kind: FdmToolKind
  onKindChange: (kind: FdmToolKind) => void
  kindControlRef?: Ref<HTMLButtonElement>
  options: readonly ExactBodyOption[]
  sketches: readonly SketchRecord[]
  frameOptions: ReferenceFrameOptions
  onPreviewChange: (feature: FeatureRecord | null) => void
}
type FdmFormProps = Omit<Props, "copy">

function Preview({
  feature,
  onChange,
}: {
  feature: FeatureRecord | null
  onChange: Props["onPreviewChange"]
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange: onChange })
  return null
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean | undefined
  onChange: (checked: boolean) => void
}) {
  return (
    <BooleanParameterField
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

export function FdmForm(props: FdmFormProps) {
  const { kind, mode } = props
  const t = useTranslations("app.fdm")
  const state = useParameterFormState(props.variables)
  const title = t(mode.kind === "edit" ? "editTitle" : "title")
  const acceptLabel = t(mode.kind === "edit" ? "update" : "create")
  const message = state.message ?? (props.previewStatus === "error" ? t("previewFailed") : null)
  const copy = {
    invalidExpression: t("invalidExpression"),
    invalidRange: t("invalidRange"),
    unavailable: t("unavailable"),
    staleRevision: t("staleRevision"),
    saveFailed: t("saveFailed"),
  }
  const defaults = fdmFormValues(kind, mode)
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  // The owning task boundary keeps the identity stable across candidate previews.
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: defaults,
    validators: {
      onDynamic: ({ value }) => {
        const parsed = parseFdmForm(
          kind,
          value,
          props.options,
          props.sketches,
          props.variables,
          state.displayUnits,
          copy,
        )
        return parsed.ok
          ? undefined
          : {
              form: t("validationSummary"),
              fields: Object.fromEntries(
                Object.entries(parsed.issues).map(([name, error]) => [
                  name in fdmFieldDefinitions ? `fields.${name}` : name,
                  error,
                ]),
              ),
            }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = parseFdmForm(
        kind,
        value,
        props.options,
        props.sketches,
        props.variables,
        state.displayUnits,
        copy,
      )
      if (!parsed.ok) return
      state.clearSubmissionErrors()
      await submitFeatureMutation({
        baseRevision: props.baseRevision,
        copy,
        feature: fdmFormFeature(mode, featureId, parsed),
        onSave: props.onSave,
        onSaved: props.onSaved,
        setMessage: state.setMessage,
      }).catch(() => state.setMessage(copy.saveFailed))
    },
  })
  function webFields(values: FdmFormValues, issues: Readonly<Record<string, string | undefined>>) {
    const sketch = props.sketches.find(({ id }) => id === values.sketchId)
    const lines =
      sketch?.entities.filter((entity) => entity.type === "line" && !entity.construction) ?? []
    return (
      <>
        <form.AppField name="style">
          {(field) => (
            <field.ChoiceField
              label={t("style")}
              onValueChange={(value) => {
                form.setFieldValue("stopPlane", null)
                if (value === "rib") form.setFieldValue("extendToWalls", false)
              }}
              options={[
                { value: "web", label: t("web") },
                { value: "rib", label: t("rib") },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="sketchId">
          {(field) => (
            <field.SearchableSelectField
              label={t("sketch")}
              onValueChange={() => {
                form.setFieldValue("lineIds", [])
              }}
              placeholder={t("chooseSketch")}
              options={[
                { value: "", label: t("chooseSketch") },
                ...props.sketches.map((sketch) => ({
                  value: sketch.id,
                  label: sketch.label ?? sketch.id,
                })),
              ]}
            />
          )}
        </form.AppField>
        <form.Field name="lineIds">
          {(field) => (
            <Field orientation="vertical">
              <FieldLabel>{t("lines")}</FieldLabel>
              {lines.map((line, number) => (
                <Toggle
                  key={line.id}
                  label={t("lineLabel", { number: number + 1 })}
                  checked={field.state.value.includes(line.id)}
                  onChange={(checked) =>
                    field.handleChange(
                      checked
                        ? [...field.state.value, line.id]
                        : field.state.value.filter((id) => id !== line.id),
                    )
                  }
                />
              ))}
              {field.state.value
                .filter((id) => !lines.some((line) => line.id === id))
                .map((id) => (
                  <FieldError key={id}>{t("missingLine", { id })}</FieldError>
                ))}
              {issues.sketchId && <FieldError>{issues.sketchId}</FieldError>}
            </Field>
          )}
        </form.Field>
        <form.AppField name="direction">
          {(field) => (
            <field.ChoiceField
              label={t("direction")}
              options={[
                { value: "forward", label: t("forward") },
                { value: "reverse", label: t("reverse") },
              ]}
            />
          )}
        </form.AppField>
        {values.style === "web" && (
          <form.AppField name="extendToWalls">
            {(field) => <field.CheckboxField label={t("extendToWalls")} />}
          </form.AppField>
        )}
        {values.style === "web" && (
          <form.Field name="stopPlane">
            {(field) => (
              <Field orientation="vertical">
                <Toggle
                  label={t("planeTermination")}
                  checked={field.state.value !== null}
                  onChange={(checked) =>
                    field.handleChange(checked ? { kind: "origin-plane", plane: "XY" } : null)
                  }
                />
                {field.state.value && (
                  <ReferencePlaneSelection
                    value={field.state.value}
                    options={props.frameOptions}
                    onChange={field.handleChange}
                  >
                    {null}
                  </ReferencePlaneSelection>
                )}
                {issues.stopPlane && <FieldError>{issues.stopPlane}</FieldError>}
              </Field>
            )}
          </form.Field>
        )}
      </>
    )
  }
  function targetField(issues: Readonly<Record<string, string | undefined>>) {
    if (kind === "calibration-coupon") return null
    return (
      <form.AppField name="targetId">
        {(field) => (
          <field.SearchableSelectField
            label={t("target")}
            error={issues.targetId}
            placeholder={t("chooseTarget")}
            onValueChange={() => {
              state.clearSubmissionErrors()
            }}
            options={[
              { value: "", label: t(kind === "flexible-sleeve" ? "noTarget" : "chooseTarget") },
              ...props.options.map(({ id, label }) => ({ value: id, label })),
            ]}
          />
        )}
      </form.AppField>
    )
  }
  function axisField() {
    return (
      <form.AppField name="axis">
        {(field) => (
          <field.ChoiceField
            label={t("axis")}
            options={[
              { value: "X", label: "X" },
              { value: "Y", label: "Y" },
              { value: "Z", label: "Z" },
            ]}
          />
        )}
      </form.AppField>
    )
  }
  function specialFields() {
    return (
      <>
        {kind === "teardrop-hole" && (
          <form.AppField name="flatTop">
            {(field) => <field.CheckboxField label={t("flatTop")} />}
          </form.AppField>
        )}
        {kind === "enclosure-joint" && (
          <form.AppField name="jointMode">
            {(field) => (
              <field.ChoiceField
                label={t("mode")}
                options={[
                  { value: "lip", label: t("lip") },
                  { value: "groove", label: t("groove") },
                ]}
              />
            )}
          </form.AppField>
        )}
        {kind === "membrane" && (
          <form.AppField name="membraneMode">
            {(field) => (
              <field.ChoiceField
                label={t("mode")}
                options={[
                  { value: "sheet", label: t("sheet") },
                  { value: "bridges", label: t("bridges") },
                ]}
              />
            )}
          </form.AppField>
        )}
      </>
    )
  }
  function dimensionFields(values: FdmFormValues) {
    const fields = activeFdmFields(kind, values.membraneMode)
    return (
      <>
        {fields.map((name) => (
          <form.AppField key={name} name={`fields.${name}`}>
            {(field) => (
              <field.LengthExpressionField
                id={`fdm-${name}`}
                label={t(`fields.${name}`)}
                description={t(fieldDescriptionKey(name))}
                suggestions={state.suggestions}
                onValueChange={() => {
                  state.clearSubmissionErrors()
                }}
              />
            )}
          </form.AppField>
        ))}
      </>
    )
  }
  return (
    <Form form={form} aria-label={title} className="gap-0">
      <form.FormError />
      <form.Subscribe selector={(s) => [s.values, s.isSubmitting] as const}>
        {([values, pending]) => {
          const parsed = parseFdmForm(
            kind,
            values,
            props.options,
            props.sketches,
            props.variables,
            state.displayUnits,
            copy,
          )
          const issues = parsed.ok ? {} : parsed.issues
          const disabled = Boolean(props.disabled || pending)
          return (
            <>
              <Preview
                feature={parsed.ok ? fdmFormFeature(mode, featureId, parsed) : null}
                onChange={props.onPreviewChange}
              />
              <ParameterPanel
                copy={{
                  title: title,
                  description: t("description"),
                  cancel: t("cancel"),
                }}
                legend={t("parameters")}
                disabled={disabled}
                message={message}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={acceptLabel}
                    ariaLabel={t("title")}
                    cancelLabel={t("cancel")}
                    disabled={disabled || !parsed.ok}
                    onCancel={props.onCancel}
                    previewStatus={props.previewStatus}
                  />
                }
              >
                <LocalizedSearchableSelectField
                  ref={props.kindControlRef}
                  label={t("kind")}
                  description={t("flatCutDescription")}
                  placeholder={t("kind")}
                  value={kind}
                  disabled={disabled || mode.kind === "edit"}
                  onValueChange={(value) => {
                    const selected = fdmToolKinds.find((tool) => tool === value)
                    if (selected) props.onKindChange(selected)
                  }}
                  options={fdmToolKinds.map((tool) => ({
                    value: tool,
                    label: t(`tools.${tool}`),
                    icon: <FdmToolIcon kind={tool} className="size-5 shrink-0" />,
                  }))}
                />
                {targetField(issues)}
                {kind === "web" ? webFields(values, issues) : axisField()}
                {specialFields()}
                {dimensionFields(values)}
                {issues.parameters && <FieldError>{issues.parameters}</FieldError>}
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}

function fieldDescriptionKey(name: FdmField) {
  if (name === "roofAngle") return "roofDescription"
  if (fdmFieldDefinitions[name][1] === "scalar") return "countDescription"
  if (name.startsWith("origin")) return "originDescription"
  return "dimensionDescription"
}
