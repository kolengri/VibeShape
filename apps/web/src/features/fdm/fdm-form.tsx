import type { FeatureRecord, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { type Ref, useState } from "react"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import type { ExactBodyOption } from "../part-design/exact-body-options"
import { LengthExpressionField } from "../part-design/length-expression-field"
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
  const form = useAppForm({
    defaultValues: defaults,
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
      if (!parsed.ok) {
        state.setIssues(parsed.issues)
        state.setMessage(t("validationSummary"))
        return
      }
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
        <form.Field name="style">
          {(field) => (
            <ChoiceField
              label={t("style")}
              value={field.state.value}
              onValueChange={(value) => {
                field.handleChange(value === "rib" ? "rib" : "web")
                form.setFieldValue("stopPlane", null)
                if (value === "rib") form.setFieldValue("extendToWalls", false)
              }}
              options={[
                { value: "web", label: t("web") },
                { value: "rib", label: t("rib") },
              ]}
            />
          )}
        </form.Field>
        <form.Field name="sketchId">
          {(field) => (
            <LocalizedSearchableSelectField
              label={t("sketch")}
              value={field.state.value}
              onValueChange={(id) => {
                field.handleChange(id)
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
        </form.Field>
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
        <form.Field name="direction">
          {(field) => (
            <ChoiceField
              label={t("direction")}
              value={field.state.value}
              onValueChange={(value) =>
                field.handleChange(value === "reverse" ? "reverse" : "forward")
              }
              options={[
                { value: "forward", label: t("forward") },
                { value: "reverse", label: t("reverse") },
              ]}
            />
          )}
        </form.Field>
        {values.style === "web" && (
          <form.Field name="extendToWalls">
            {(field) => (
              <Toggle
                label={t("extendToWalls")}
                checked={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
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
      <form.Field name="targetId">
        {(field) => (
          <LocalizedSearchableSelectField
            label={t("target")}
            error={issues.targetId}
            placeholder={t("chooseTarget")}
            value={field.state.value}
            onValueChange={(value) => {
              state.clearSubmissionErrors()
              field.handleChange(value)
            }}
            options={[
              { value: "", label: t(kind === "flexible-sleeve" ? "noTarget" : "chooseTarget") },
              ...props.options.map(({ id, label }) => ({ value: id, label })),
            ]}
          />
        )}
      </form.Field>
    )
  }
  function axisField() {
    return (
      <form.Field name="axis">
        {(field) => (
          <ChoiceField
            label={t("axis")}
            value={field.state.value}
            onValueChange={(value) => {
              if (value === "X" || value === "Y" || value === "Z") field.handleChange(value)
            }}
            options={[
              { value: "X", label: "X" },
              { value: "Y", label: "Y" },
              { value: "Z", label: "Z" },
            ]}
          />
        )}
      </form.Field>
    )
  }
  function specialFields() {
    return (
      <>
        {kind === "teardrop-hole" && (
          <form.Field name="flatTop">
            {(field) => (
              <Toggle
                label={t("flatTop")}
                checked={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        )}
        {kind === "enclosure-joint" && (
          <form.Field name="jointMode">
            {(field) => (
              <ChoiceField
                label={t("mode")}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value === "groove" ? "groove" : "lip")}
                options={[
                  { value: "lip", label: t("lip") },
                  { value: "groove", label: t("groove") },
                ]}
              />
            )}
          </form.Field>
        )}
        {kind === "membrane" && (
          <form.Field name="membraneMode">
            {(field) => (
              <ChoiceField
                label={t("mode")}
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(value === "bridges" ? "bridges" : "sheet")
                }
                options={[
                  { value: "sheet", label: t("sheet") },
                  { value: "bridges", label: t("bridges") },
                ]}
              />
            )}
          </form.Field>
        )}
      </>
    )
  }
  function dimensionFields(
    values: FdmFormValues,
    issues: Readonly<Record<string, string | undefined>>,
  ) {
    const fields = activeFdmFields(kind, values.membraneMode)
    return (
      <>
        {fields.map((name) => (
          <form.Field key={name} name={`fields.${name}`}>
            {(field) => (
              <LengthExpressionField
                id={`fdm-${name}`}
                name={field.name}
                value={field.state.value ?? ""}
                label={t(`fields.${name}`)}
                description={t(fieldDescriptionKey(name))}
                suggestions={state.suggestions}
                error={issues[name]}
                onBlur={field.handleBlur}
                onValueChange={(value) => {
                  state.clearSubmissionErrors()
                  field.handleChange(value)
                }}
              />
            )}
          </form.Field>
        ))}
      </>
    )
  }
  return (
    <Form
      ref={state.formElementRef}
      form={form}
      aria-label={title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
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
          const issues = parsed.ok ? state.issues : { ...state.issues, ...parsed.issues }
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
                {dimensionFields(values, issues)}
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
