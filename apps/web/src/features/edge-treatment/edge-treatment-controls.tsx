import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Scan, X } from "@vibeshape/ui/components/icons"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import type { ComponentProps } from "react"
import { useState } from "react"
import { exactBodyPickCandidates } from "../part-design/body-reference-picking"
import { LengthExpressionField } from "../part-design/length-expression-field"
import { ReferencePickField } from "../part-design/reference-pick-field"
import { VariableExpressionField } from "../variables/variable-expression-field"
import {
  type EdgeTreatmentCandidate,
  resolveTreatmentReference,
  sameTreatmentReference,
  treatmentReferenceMatchesCandidate,
} from "./edge-treatment-candidates"
import type { EdgeTreatmentFormCopy, EdgeTreatmentOperation } from "./edge-treatment-form"
import {
  clearTreatmentSelection,
  type TreatmentValues,
  treatmentReferences,
  treatmentUsesV3,
} from "./edge-treatment-model"
import { type EdgeTreatmentTargetOption, edgeTreatmentRequiresV3 } from "./edge-treatment-options"
import type { EdgeTreatmentPick } from "./edge-treatment-picking"

export type TreatmentControlsProps = {
  values: TreatmentValues
  onChange: (values: TreatmentValues) => void
  copy: EdgeTreatmentFormCopy
  operation: EdgeTreatmentOperation
  disabled: boolean
  options: readonly EdgeTreatmentTargetOption[]
  candidates: readonly EdgeTreatmentCandidate[]
  issues: Readonly<Record<string, string | undefined>>
  suggestions: ComponentProps<typeof LengthExpressionField>["suggestions"]
  pick: EdgeTreatmentPick | null
  onArm: (pick: EdgeTreatmentPick, element: HTMLButtonElement) => void
  onPick: (candidate: EdgeTreatmentCandidate, pick: EdgeTreatmentPick) => void
}

function PickButton({
  kind,
  props,
}: {
  kind: "edges" | "faces" | "overrides"
  props: TreatmentControlsProps
}) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const labels = {
    edges: t("pickGraphicalEdges"),
    faces: t("pickGraphicalFaces"),
    overrides: t("pickDirectionOverrides"),
  }
  return (
    <Button
      id={`edge-treatment-pick-${kind}`}
      type="button"
      size="sm"
      variant="outline"
      disabled={props.disabled}
      aria-pressed={props.pick?.kind === kind}
      onClick={(event) => props.onArm({ kind }, event.currentTarget)}
    >
      <Scan aria-hidden="true" />
      {labels[kind]}
    </Button>
  )
}

function CandidateChoice({
  props,
  candidate,
}: {
  props: TreatmentControlsProps
  candidate: EdgeTreatmentCandidate
}) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const body = props.options.find(({ id }) => id === candidate.optionId)?.label ?? ""
  const status = candidate.resolveStatus()
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start"
        disabled={props.disabled || status !== "resolved"}
        onClick={() => props.onPick(candidate, props.pick ?? { kind: "edges" })}
      >
        {t("candidateLabel", { body, reference: candidate.label })}
      </Button>
      {status !== "resolved" && (
        <p className="text-xs text-destructive">
          {status === "ambiguous" ? props.copy.ambiguousEdge : props.copy.missingEdge}
        </p>
      )}
    </div>
  )
}

function CandidateFallback({ props }: { props: TreatmentControlsProps }) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const intent = props.pick?.kind
  const face = intent === "faces" || intent === "side-face"
  const restricted = intent === "side-face" || intent === "overrides"
  const choices = props.candidates.filter(
    (candidate) =>
      candidate.reference.kind === (face ? "face" : "edge") &&
      (!restricted || candidate.optionId === props.values.targetFeatureId),
  )
  const lastPage = Math.max(0, Math.ceil(choices.length / 32) - 1)
  const currentPage = Math.min(page, lastPage)
  return (
    <details
      className="sr-only rounded-md border p-2 focus-within:not-sr-only"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="font-medium cursor-pointer text-xs">{t("keyboardChoices")}</summary>
      <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
        {choices.length === 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("noCandidates")}
          </p>
        )}
        {(open ? choices.slice(currentPage * 32, (currentPage + 1) * 32) : []).map((candidate) => (
          <CandidateChoice key={candidate.id} candidate={candidate} props={props} />
        ))}
      </div>
      {lastPage > 0 && (
        <div className="mt-2 flex items-center justify-between gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t("previousCandidates")}
          </Button>
          <span className="text-xs">
            {t("candidatePage", { page: currentPage + 1, count: lastPage + 1 })}
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            {t("nextCandidates")}
          </Button>
        </div>
      )}
    </details>
  )
}

function removeReference(
  props: TreatmentControlsProps,
  reference: ReturnType<typeof treatmentReferences>[number],
  candidate: EdgeTreatmentCandidate | undefined,
) {
  props.onChange({
    ...props.values,
    references: props.values.references.filter((ref) => !sameTreatmentReference(ref, reference)),
    targets: props.values.targets.filter(
      (target) =>
        !sameTreatmentReference(target.kind === "edge" ? target.edge : target.face, reference),
    ),
    directionOverrides: props.values.directionOverrides.filter(
      (ref) =>
        !sameTreatmentReference(ref, reference) &&
        !(candidate && treatmentReferenceMatchesCandidate(ref, candidate, props.candidates)),
    ),
  })
}

function SideFaceField({
  props,
  index,
  label,
  side,
}: {
  props: TreatmentControlsProps
  index: number
  label: string
  side: Extract<TreatmentValues["targets"][number], { kind: "edge" }>["sideFace"]
}) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  const resolvedSide = side
    ? resolveTreatmentReference(
        side,
        props.candidates.filter(({ optionId }) => optionId === props.values.targetFeatureId),
      )
    : null
  const sideLabel = resolvedSide?.status === "resolved" ? resolvedSide.candidate.label : null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled}
        aria-label={t("pickSideFace", { edge: label })}
        aria-pressed={props.pick?.kind === "side-face" && props.pick.index === index}
        onClick={(event) => props.onArm({ kind: "side-face", index }, event.currentTarget)}
      >
        <Scan aria-hidden="true" />
        {sideLabel ?? t("sideFaceRequired")}
      </Button>
      {side && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={props.disabled}
          onClick={() =>
            props.onChange({
              ...props.values,
              targets: props.values.targets.map((target, item) =>
                item === index && target.kind === "edge"
                  ? { kind: "edge", edge: target.edge }
                  : target,
              ),
            })
          }
        >
          {t("clearSideFace")}
        </Button>
      )}
    </>
  )
}

function EdgeOverrideCheckbox({
  props,
  label,
  candidate,
}: {
  props: TreatmentControlsProps
  label: string
  candidate: EdgeTreatmentCandidate | undefined
}) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        disabled={props.disabled || candidate?.resolveStatus() !== "resolved"}
        aria-label={t("reverseNamedEdge", { edge: label })}
        checked={props.values.directionOverrides.some(
          (ref) =>
            candidate && treatmentReferenceMatchesCandidate(ref, candidate, props.candidates),
        )}
        onChange={() => {
          if (candidate) props.onPick(candidate, { kind: "overrides" })
        }}
      />
      {t("reverseEdge")}
    </label>
  )
}

function SelectedEdgeDirection({
  props,
  index,
  label,
  candidate,
}: {
  props: TreatmentControlsProps
  index: number
  label: string
  candidate: EdgeTreatmentCandidate | undefined
}) {
  const target = props.values.targets[index]
  if (target?.kind !== "edge" || props.values.mode === "equal-distance") return null
  return (
    <>
      <SideFaceField props={props} index={index} label={label} side={target.sideFace} />
      <EdgeOverrideCheckbox props={props} label={label} candidate={candidate} />
    </>
  )
}

function SelectedRow({
  props,
  index,
  v3,
}: {
  props: TreatmentControlsProps
  index: number
  v3: boolean
}) {
  const reference = treatmentReferences(props.values, v3)[index]
  if (!reference) return null
  const resolved = resolveTreatmentReference(
    reference,
    props.candidates.filter((entry) => entry.optionId === props.values.targetFeatureId),
  )
  const candidate = resolved.status === "resolved" ? resolved.candidate : undefined
  const label = candidate?.label ?? props.copy.missingEdge
  return (
    <div className="grid gap-1 rounded-md border bg-accent px-2 py-1 text-sm">
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span
          className={candidate?.resolveStatus() === "resolved" ? "truncate" : "text-destructive"}
        >
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={props.copy.removeEdgeLabel(label)}
          disabled={props.disabled}
          onClick={() => removeReference(props, reference, candidate)}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {v3 && (
        <SelectedEdgeDirection props={props} index={index} label={label} candidate={candidate} />
      )}
    </div>
  )
}

function SelectionHeading({
  props,
  v3,
  count,
}: {
  props: TreatmentControlsProps
  v3: boolean
  count: number
}) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  return (
    <>
      <legend className="text-xs font-medium">
        {v3 ? t("selectedTargets") : props.copy.selectedEdges}
      </legend>
      <p className="text-xs text-muted-foreground">
        {v3 ? t("selectedTargetsDescription") : props.copy.selectedEdgesDescription}
      </p>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium">
        {v3 ? t("selectedTargetCount", { count }) : props.copy.selectedEdgeCount(count)}
      </p>
    </>
  )
}

function SelectedTargets({ props }: { props: TreatmentControlsProps }) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  if (props.values.scope !== "selected") return null
  const v3 =
    props.operation === "chamfer" &&
    treatmentUsesV3(
      props.values,
      props.options.find(({ id }) => id === props.values.targetFeatureId),
    )
  const references = treatmentReferences(props.values, v3)
  const unavailable = props.candidates.filter(
    (candidate) => candidate.reference.kind === "edge" && !candidate.edgePolyline,
  ).length
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-label={v3 ? t("selectedTargets") : props.copy.selectedEdges}
    >
      <SelectionHeading props={props} v3={v3} count={references.length} />
      <div className="flex flex-wrap gap-1">
        <PickButton kind="edges" props={props} />
        {props.operation === "chamfer" && <PickButton kind="faces" props={props} />}
      </div>
      {unavailable > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("missingPolylines", { count: unavailable })}
        </p>
      )}
      <CandidateFallback key={JSON.stringify(props.pick)} props={props} />
      {references.map((reference, index) => (
        <SelectedRow key={JSON.stringify(reference)} props={props} index={index} v3={v3} />
      ))}
      {props.issues.references && (
        <p role="alert" className="text-xs text-destructive">
          {props.issues.references}
        </p>
      )}
      {references.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={props.disabled}
          onClick={() => props.onChange(clearTreatmentSelection(props.values))}
        >
          {props.copy.clearEdges}
        </Button>
      )}
      {v3 && <p className="text-xs text-muted-foreground">{t("incidenceValidation")}</p>}
    </fieldset>
  )
}

function ChamferControls({ props }: { props: TreatmentControlsProps }) {
  const t = useTranslations("app.shell.taskPanel.edgeTreatment")
  if (props.operation !== "chamfer") return null
  const values = props.values
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-medium">{t("chamferControls")}</legend>
      <NativeSelectField
        label={t("modeLabel")}
        value={values.mode}
        disabled={props.disabled}
        onChange={(event) => {
          const mode =
            event.currentTarget.value === "two-distances"
              ? "two-distances"
              : event.currentTarget.value === "distance-angle"
                ? "distance-angle"
                : "equal-distance"
          props.onChange({
            ...values,
            mode,
            scope: "selected",
            ...(mode === "equal-distance" ? { flip: false, directionOverrides: [] } : {}),
          })
        }}
      >
        <option value="equal-distance">{t("modeEqual")}</option>
        <option value="two-distances">{t("modeTwo")}</option>
        <option value="distance-angle">{t("modeAngle")}</option>
      </NativeSelectField>
      {values.mode === "two-distances" && (
        <LengthExpressionField
          id="edge-treatment-secondDistance"
          name="secondDistance"
          label={t("secondDistance")}
          description={props.copy.expressionDescription}
          value={values.secondDistance}
          error={props.issues.secondDistance}
          suggestions={props.suggestions}
          onValueChange={(secondDistance) => props.onChange({ ...values, secondDistance })}
        />
      )}
      {values.mode === "distance-angle" && (
        <VariableExpressionField
          id="edge-treatment-angle"
          name="angle"
          label={t("angleLabel")}
          value={values.angle}
          error={props.issues.angle}
          suggestions={props.suggestions}
          description={t("angleDescription")}
          onValueChange={(angle) => props.onChange({ ...values, angle })}
        />
      )}
      <NativeSelectField
        label={t("measurementLabel")}
        value={values.measurement}
        disabled={props.disabled}
        onChange={(event) =>
          props.onChange({
            ...values,
            scope: "selected",
            measurement: event.currentTarget.value === "tangent" ? "tangent" : "offset",
          })
        }
      >
        <option value="offset">{t("measurementOffset")}</option>
        <option value="tangent">{t("measurementTangent")}</option>
      </NativeSelectField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.tangentPropagation}
          disabled={props.disabled}
          onChange={(event) =>
            props.onChange({
              ...values,
              scope: "selected",
              tangentPropagation: event.currentTarget.checked,
            })
          }
        />
        {t("tangentPropagation")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.flip}
          disabled={props.disabled || values.mode === "equal-distance"}
          onChange={(event) => props.onChange({ ...values, flip: event.currentTarget.checked })}
        />
        {t("flipDirection")}
      </label>
      {values.mode !== "equal-distance" && <PickButton kind="overrides" props={props} />}
      {values.directionOverrides.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <p className="text-xs">
            {t("overrideCount", { count: values.directionOverrides.length })}
          </p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => props.onChange({ ...values, directionOverrides: [] })}
          >
            {t("clearOverrides")}
          </Button>
        </div>
      )}
    </fieldset>
  )
}

export function EdgeTreatmentControls(props: TreatmentControlsProps) {
  const allUnavailable = edgeTreatmentRequiresV3(
    props.options.find(({ id }) => id === props.values.targetFeatureId),
  )
  return (
    <>
      {props.values.scope === "all" ? (
        <ReferencePickField
          id="edge-treatment-target"
          name="targetFeatureId"
          label={props.copy.target}
          description={props.copy.targetDescription}
          placeholder={props.copy.missingTarget}
          value={props.values.targetFeatureId}
          options={props.options.map(({ id, label }) => ({ value: id, label }))}
          candidates={exactBodyPickCandidates(props.options)}
          required
          disabled={props.disabled}
          error={props.issues.targetFeatureId}
          onValueChange={(value) =>
            props.onChange(
              value === props.values.targetFeatureId
                ? props.values
                : clearTreatmentSelection(props.values, value),
            )
          }
        />
      ) : (
        <div className="grid gap-1">
          <dl className="flex min-w-0 gap-2 text-xs text-muted-foreground">
            <dt>{props.copy.target}</dt>
            <dd data-edge-treatment-body className="min-w-0 truncate">
              {props.options.find(({ id }) => id === props.values.targetFeatureId)?.label ??
                props.copy.missingTarget}
            </dd>
          </dl>
          {props.issues.targetFeatureId && (
            <p role="alert" className="text-xs text-destructive">
              {props.issues.targetFeatureId}
            </p>
          )}
        </div>
      )}
      <fieldset className="grid gap-2">
        <legend className="text-xs font-medium">{props.copy.scopeLabel}</legend>
        {(["all", "selected"] as const).map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="scope"
              value={scope}
              checked={props.values.scope === scope}
              disabled={props.disabled || (scope === "all" && allUnavailable)}
              onChange={() =>
                props.onChange({
                  ...props.values,
                  scope,
                  ...(scope === "all"
                    ? {
                        retainV3: false,
                        mode: "equal-distance",
                        measurement: "offset",
                        flip: false,
                        tangentPropagation: false,
                        directionOverrides: [],
                        targets: [],
                      }
                    : {}),
                })
              }
            />
            {scope === "all" ? props.copy.allEdges : props.copy.selectedEdges}
          </label>
        ))}
      </fieldset>
      <SelectedTargets props={props} />
      <LengthExpressionField
        id="edge-treatment-distance"
        name="distance"
        value={props.values.distance}
        label={props.copy.distance}
        description={props.copy.expressionDescription}
        error={props.issues.distance}
        suggestions={props.suggestions}
        onValueChange={(distance) => props.onChange({ ...props.values, distance })}
      />
      <ChamferControls props={props} />
    </>
  )
}
