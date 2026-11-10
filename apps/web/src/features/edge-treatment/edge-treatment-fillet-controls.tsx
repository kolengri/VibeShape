import { useTranslations } from "@vibeshape/i18n"
import { FieldError } from "@vibeshape/ui/components/field"
import type { ComponentProps } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import type { EdgeTreatmentCandidate } from "./edge-treatment-candidates"
import { setVariableRadius, variableRadiusFor } from "./edge-treatment-fillet"
import type { TreatmentValues } from "./edge-treatment-model"

type FilletEdgeRadiusProps = Readonly<{
  values: TreatmentValues
  onChange: (values: TreatmentValues) => void
  candidate: EdgeTreatmentCandidate | undefined
  label: string
  index: number
  disabled: boolean
  defaultEndRadius: string
  expressionDescription: string
  suggestions: ComponentProps<typeof LengthExpressionField>["suggestions"]
}>

/** Per-edge linear radius law. Enabling it routes the Fillet to body-bound V3. */
export function FilletEdgeRadius(props: FilletEdgeRadiusProps) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment.fillet")
  const reference = props.candidate?.reference
  if (
    props.candidate?.resolveStatus() !== "resolved" ||
    reference?.schemaVersion !== 1 ||
    reference.kind !== "edge"
  )
    return null
  const edge = { ...reference, kind: "edge" as const }
  const draft = variableRadiusFor(props.values, edge)
  const update = (patch: Partial<NonNullable<typeof draft>>) => {
    if (draft) props.onChange(setVariableRadius(props.values, edge, { ...draft, ...patch }))
  }
  return (
    <div className="grid gap-1">
      <BooleanParameterField
        label={t("variableRadius")}
        aria-label={t("variableRadiusNamed", { edge: props.label })}
        checked={Boolean(draft)}
        disabled={props.disabled}
        onChange={(event) =>
          props.onChange(
            setVariableRadius(
              props.values,
              edge,
              event.currentTarget.checked
                ? {
                    startRadius: props.values.distance,
                    endRadius: props.defaultEndRadius,
                    reverse: false,
                  }
                : null,
            ),
          )
        }
      />
      {draft && (
        <>
          <LengthExpressionField
            id={`edge-treatment-start-radius-${props.index}`}
            name={`startRadius-${props.index}`}
            label={t("startRadiusNamed", { edge: props.label })}
            description={props.expressionDescription}
            value={draft.startRadius}
            disabled={props.disabled}
            suggestions={props.suggestions}
            onValueChange={(startRadius) => update({ startRadius })}
          />
          <LengthExpressionField
            id={`edge-treatment-end-radius-${props.index}`}
            name={`endRadius-${props.index}`}
            label={t("endRadiusNamed", { edge: props.label })}
            description={props.expressionDescription}
            value={draft.endRadius}
            disabled={props.disabled}
            suggestions={props.suggestions}
            onValueChange={(endRadius) => update({ endRadius })}
          />
          <BooleanParameterField
            label={t("reverseRadius")}
            aria-label={t("reverseRadiusNamed", { edge: props.label })}
            checked={draft.reverse}
            disabled={props.disabled}
            onChange={(event) => update({ reverse: event.currentTarget.checked })}
          />
        </>
      )}
    </div>
  )
}

/** Fillet behavior that holds for every route: native tangent contours, never a toggle. */
export function FilletSelectionHelp({
  values,
  issue,
}: Readonly<{ values: TreatmentValues; issue: string | undefined }>) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment.fillet")
  return (
    <>
      {issue && <FieldError>{issue}</FieldError>}
      <p className="text-xs text-muted-foreground">{t("contourHelp")}</p>
      {values.variableRadii.length > 0 && (
        <p className="text-xs text-muted-foreground">{t("variableRadiusDescription")}</p>
      )}
    </>
  )
}
