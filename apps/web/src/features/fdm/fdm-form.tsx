import type { FeatureRecord, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Field, FieldDescription, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
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
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
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
            <SelectField
              label={t("style")}
              value={field.state.value}
              onValueChange={(value) => {
                field.handleChange(value === "rib" ? "rib" : "web")
                form.setFieldValue("stopPlane", null)
                if (value === "rib") form.setFieldValue("extendToWalls", false)
              }}
            >
              <SelectOption value="web">{t("web")}</SelectOption>
              <SelectOption value="rib">{t("rib")}</SelectOption>
            </SelectField>
          )}
        </form.Field>
        <form.Field name="sketchId">
          {(field) => (
            <SelectField
              label={t("sketch")}
              value={field.state.value || "none"}
              onValueChange={(id) => {
                field.handleChange(id === "none" ? "" : id)
                form.setFieldValue("lineIds", [])
              }}
            >
              <SelectOption value="none">{t("chooseSketch")}</SelectOption>
              {props.sketches.map((sketch) => (
                <SelectOption key={sketch.id} value={sketch.id}>
                  {sketch.label ?? sketch.id}
                </SelectOption>
              ))}
            </SelectField>
          )}
        </form.Field>
        <form.Field name="lineIds">
          {(field) => (
            <Field>
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
                  <p key={id} className="text-xs text-destructive">
                    {t("missingLine", { id })}
                  </p>
                ))}
              {issues.sketchId && <FieldError>{issues.sketchId}</FieldError>}
            </Field>
          )}
        </form.Field>
        <form.Field name="direction">
          {(field) => (
            <SelectField
              label={t("direction")}
              value={field.state.value}
              onValueChange={(value) =>
                field.handleChange(value === "reverse" ? "reverse" : "forward")
              }
            >
              <SelectOption value="forward">{t("forward")}</SelectOption>
              <SelectOption value="reverse">{t("reverse")}</SelectOption>
            </SelectField>
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
              <Field>
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
          <Field>
            <SelectField
              label={t("target")}
              value={field.state.value || "none"}
              onValueChange={(value) => {
                state.clearSubmissionErrors()
                field.handleChange(value === "none" ? "" : value)
              }}
            >
              <SelectOption value="none">
                {t(kind === "flexible-sleeve" ? "noTarget" : "chooseTarget")}
              </SelectOption>
              {props.options.map((option) => (
                <SelectOption key={option.id} value={option.id}>
                  {option.label}
                </SelectOption>
              ))}
            </SelectField>
            {issues.targetId && <FieldError>{issues.targetId}</FieldError>}
          </Field>
        )}
      </form.Field>
    )
  }
  function axisField() {
    return (
      <form.Field name="axis">
        {(field) => (
          <SelectField
            label={t("axis")}
            value={field.state.value}
            onValueChange={(value) => {
              if (value === "X" || value === "Y" || value === "Z") field.handleChange(value)
            }}
          >
            {["X", "Y", "Z"].map((axis) => (
              <SelectOption key={axis} value={axis}>
                {axis}
              </SelectOption>
            ))}
          </SelectField>
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
              <SelectField
                label={t("mode")}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value === "groove" ? "groove" : "lip")}
              >
                <SelectOption value="lip">{t("lip")}</SelectOption>
                <SelectOption value="groove">{t("groove")}</SelectOption>
              </SelectField>
            )}
          </form.Field>
        )}
        {kind === "membrane" && (
          <form.Field name="membraneMode">
            {(field) => (
              <SelectField
                label={t("mode")}
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(value === "bridges" ? "bridges" : "sheet")
                }
              >
                <SelectOption value="sheet">{t("sheet")}</SelectOption>
                <SelectOption value="bridges">{t("bridges")}</SelectOption>
              </SelectField>
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
    <Form ref={state.formElementRef} form={form} aria-label={title} className="gap-0">
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
                <SelectField
                  label={t("kind")}
                  value={kind}
                  disabled={disabled || mode.kind === "edit"}
                  onValueChange={(value) => {
                    if (fdmToolKinds.includes(value as FdmToolKind))
                      props.onKindChange(value as FdmToolKind)
                  }}
                >
                  {fdmToolKinds.map((tool) => (
                    <SelectOption key={tool} value={tool}>
                      <span className="inline-flex items-center gap-2">
                        <FdmToolIcon kind={tool} className="size-5 shrink-0" />
                        <span>{t(`tools.${tool}`)}</span>
                      </span>
                    </SelectOption>
                  ))}
                </SelectField>
                {targetField(issues)}
                {kind === "web" ? webFields(values, issues) : axisField()}
                {specialFields()}
                {dimensionFields(values, issues)}
                {issues.parameters && <FieldError>{issues.parameters}</FieldError>}
                <FieldDescription>{t("flatCutDescription")}</FieldDescription>
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
