import type { ReferenceAxis } from "@vibeshape/domain/reference-frame"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { FieldError } from "@vibeshape/ui/components/field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { ReferenceAxisSelection } from "../reference-geometry/reference-support-fields"
import type { VariableExpressionSuggestion } from "../variables/variable-expression-input"
import type { HelixFieldIssues, HelixFormValues, HelixQuantityField } from "./helix-form-model"

export type HelixFieldsCopy = Readonly<{
  axis: string
  axisDescription: string
  handedness: string
  right: string
  left: string
  radius: string
  radiusDescription: string
  pitch: string
  pitchDescription: string
  extent: string
  extentTurns: string
  extentHeight: string
  turns: string
  turnsDescription: string
  height: string
  heightDescription: string
  startAngle: string
  startAngleDescription: string
}>

type Props = Readonly<{
  idPrefix: string
  values: HelixFormValues
  issues: HelixFieldIssues
  copy: HelixFieldsCopy
  axisOptions?: ReferenceFrameOptions | undefined
  suggestions: readonly VariableExpressionSuggestion[]
  disabled?: boolean | undefined
  onChange: (values: Partial<HelixFormValues>) => void
}>

const descriptions = {
  radius: "radiusDescription",
  pitch: "pitchDescription",
  turns: "turnsDescription",
  height: "heightDescription",
  startAngle: "startAngleDescription",
} as const

/** State-agnostic helix inputs shared by Coil and the helical Sweep path. */
export function HelixFields({
  idPrefix,
  values,
  issues,
  copy,
  axisOptions,
  suggestions,
  disabled,
  onChange,
}: Props) {
  const expression = (field: HelixQuantityField) => (
    <LengthExpressionField
      key={field}
      id={`${idPrefix}-${field}`}
      label={copy[field]}
      description={copy[descriptions[field]]}
      error={issues[field]}
      suggestions={suggestions}
      disabled={disabled}
      value={values[field]}
      onValueChange={(value) => onChange({ [field]: value })}
    />
  )
  return (
    <>
      <div className="grid gap-1">
        <span className="text-xs font-medium">{copy.axis}</span>
        <p className="text-xs text-muted-foreground">{copy.axisDescription}</p>
        {axisOptions && (
          <ReferenceAxisSelection
            options={axisOptions}
            value={values.axis}
            onChange={(axis: ReferenceAxis | null) => onChange({ axis })}
          >
            {null}
          </ReferenceAxisSelection>
        )}
        <FieldError id={`${idPrefix}-axis-error`}>{issues.axis}</FieldError>
      </div>
      <ChoiceField
        id={`${idPrefix}-handedness`}
        label={copy.handedness}
        value={values.handedness}
        disabled={disabled}
        onValueChange={(value) => onChange({ handedness: value === "left" ? "left" : "right" })}
        options={[
          { value: "right", label: copy.right },
          { value: "left", label: copy.left },
        ]}
      />
      {expression("radius")}
      {expression("pitch")}
      <ChoiceField
        id={`${idPrefix}-extent`}
        label={copy.extent}
        value={values.extentKind}
        disabled={disabled}
        onValueChange={(value) => onChange({ extentKind: value === "height" ? "height" : "turns" })}
        options={[
          { value: "turns", label: copy.extentTurns },
          { value: "height", label: copy.extentHeight },
        ]}
      />
      {expression(values.extentKind)}
      {expression("startAngle")}
    </>
  )
}
