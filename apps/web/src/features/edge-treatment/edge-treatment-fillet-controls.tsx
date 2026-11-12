import type { EdgeTopoRef } from "@vibeshape/domain"
import type { BodyTopoRef } from "@vibeshape/domain/body-topology-reference"
import { useTranslations } from "@vibeshape/i18n"
import type { ComponentProps } from "react"
import { BooleanParameterField } from "../part-design/boolean-parameter-field"
import { LengthExpressionField } from "../part-design/length-expression-field"
import type { EdgeTreatmentCandidate } from "./edge-treatment-candidates"
import { setVariableRadius, variableRadiusFor } from "./edge-treatment-fillet"
import type { TreatmentValues } from "./edge-treatment-model"
import { SelectedRowToggle } from "./edge-treatment-selected-row"

type FilletEdgeRadiusProps = Readonly<{
  values: TreatmentValues
  onChange: (values: TreatmentValues) => void
  candidate: EdgeTreatmentCandidate | undefined
  /** The row's stored reference: drafts follow authored intent, not the current signature. */
  reference: EdgeTopoRef | BodyTopoRef
  label: string
  index: number
  disabled: boolean
  defaultEndRadius: string
  expressionDescription: string
  suggestions: ComponentProps<typeof LengthExpressionField>["suggestions"]
}>

/** Variable radius needs a body-bound catalogue for the resolved current edge. */
function supportsVariableRadius(props: FilletEdgeRadiusProps) {
  return (
    props.candidate?.resolveStatus() === "resolved" && props.candidate.reference.schemaVersion === 1
  )
}

/**
 * Per-edge linear radius law, toggled inline in the selected-edge row. Enabling it routes the
 * Fillet to body-bound V3. The draft is keyed by the stored row reference, which is what targets
 * and the route match, so a drifted signature still finds its saved law.
 */
export function FilletEdgeRadiusToggle(props: FilletEdgeRadiusProps) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment.fillet")
  if (!supportsVariableRadius(props)) return null
  const draft = variableRadiusFor(props.values, props.reference)
  return (
    <SelectedRowToggle
      label={t("variableRadius")}
      aria-label={t("variableRadiusNamed", { edge: props.label })}
      checked={Boolean(draft)}
      disabled={props.disabled}
      onChange={(event) =>
        props.onChange(
          setVariableRadius(
            props.values,
            props.reference,
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
  )
}

/** Start, end and Reverse fields, expanded under the row only while the law is enabled. */
export function FilletEdgeRadiusDetails(props: FilletEdgeRadiusProps) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment.fillet")
  const draft = variableRadiusFor(props.values, props.reference)
  if (!supportsVariableRadius(props) || !draft) return null
  const update = (patch: Partial<typeof draft>) =>
    props.onChange(setVariableRadius(props.values, props.reference, { ...draft, ...patch }))
  return (
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
  )
}

/** Fillet behavior that holds for every route: native tangent contours, never a toggle. */
export function FilletSelectionHelp({ values }: Readonly<{ values: TreatmentValues }>) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment.fillet")
  return (
    <>
      <span className="block">{t("contourHelp")}</span>
      {values.variableRadii.length > 0 && (
        <span className="block">{t("variableRadiusDescription")}</span>
      )}
    </>
  )
}
