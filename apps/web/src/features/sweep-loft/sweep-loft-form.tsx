import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { TaskPanelContentProvider } from "../../components/task-panel-layout"
import { HelixFields, type HelixFieldsCopy } from "../coil/helix-fields"
import { type HelixValidationCopy, parseHelixForm } from "../coil/helix-form-model"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { isFeaturePreviewReady } from "../part-design/feature-preview-readiness"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { useParameterFormState } from "../part-design/use-parameter-form-state"
import type { ReferenceFrameOptions } from "../reference-geometry/reference-frame-options"
import { type LoftConstraintCopy, LoftConstraintFields } from "./loft-constraint-fields"
import { type LoftSupportOption, remapLoftOuterTracks } from "./loft-constraint-model"
import { LoftHoleFields } from "./loft-hole-fields"
import { type LoftSectionCopy, LoftSectionFields } from "./loft-section-fields"
import {
  type PathSketchOption,
  type ProfileOption,
  type SweepLoftFormMode,
  type SweepLoftFormValues,
  sweepLoftFeatureRecord,
  sweepLoftFormValues,
} from "./sweep-loft-form-model"
import { type SweepPathCopy, SweepPathFields } from "./sweep-path-fields"
export type SweepLoftFormCopy = ParameterPanelCopy &
  LoftSectionCopy &
  LoftConstraintCopy &
  SweepPathCopy &
  HelixFieldsCopy &
  HelixValidationCopy &
  Readonly<{
    pathKind: string
    sketchPath: string
    helixPath: string
    helixPathDescription: string
    leadAngle: (angle: string) => string
    submit: string
    parameters: string
    validationSummary: string
    previewFailed: string
    staleRevision: string
    saveFailed: string
  }>
type Props = FeatureParameterFormProps<SweepLoftFormMode, SweepLoftFormCopy> &
  Readonly<{
    snapshot: DocumentSnapshot
    profiles: readonly ProfileOption[]
    paths: readonly PathSketchOption[]
    supports?: readonly LoftSupportOption[]
    axisOptions?: ReferenceFrameOptions | undefined
    previewDiagnostic?: string | undefined
    onPreviewChange?: ((feature: FeatureRecord | null) => void) | undefined
  }>
function SweepLoftPreview({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}
export function SweepLoftForm({
  baseRevision,
  copy,
  disabled = false,
  mode,
  snapshot,
  profiles,
  paths,
  supports = [],
  axisOptions,
  previewDiagnostic,
  onCancel,
  onPreviewChange,
  onSave,
  onSaved,
  previewStatus,
}: Props) {
  const [featureId] = useState(() =>
    mode.kind === "edit" ? mode.feature.id : mode.createFeatureId(),
  )
  const [message, setMessage] = useState<string | null>(null)
  const parameterState = useParameterFormState(snapshot.variables)
  const units = parameterState.displayUnits
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: sweepLoftFormValues(mode, units),
    validators: {
      onDynamic: ({ value }) => {
        const feature = sweepLoftFeatureRecord(
          mode,
          featureId,
          value,
          profiles,
          paths,
          snapshot,
          supports,
          units,
        )
        return feature ? undefined : copy.validationSummary
      },
    },
    onSubmit: async ({ value }) => {
      if (disabled || !isFeaturePreviewReady(previewStatus)) return
      const feature = sweepLoftFeatureRecord(
        mode,
        featureId,
        value,
        profiles,
        paths,
        snapshot,
        supports,
        units,
      )
      if (!feature) return
      setMessage(null)
      try {
        await submitFeatureMutation({ baseRevision, copy, feature, onSave, onSaved, setMessage })
      } catch {
        setMessage(copy.saveFailed)
      }
    },
  })
  const updatePath = (changes: Partial<SweepLoftFormValues>) => {
    setMessage(null)
    for (const [key, value] of Object.entries(changes))
      form.setFieldValue(key as keyof SweepLoftFormValues, value as never)
  }
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <TaskPanelContentProvider content={<form.FormError />}>
        <form.Subscribe selector={(state) => [state.values, state.isSubmitting] as const}>
          {([values, pending]) => {
            const feature = sweepLoftFeatureRecord(
              mode,
              featureId,
              values,
              profiles,
              paths,
              snapshot,
              supports,
              units,
            )
            return (
              <>
                {onPreviewChange && (
                  <SweepLoftPreview feature={feature} onPreviewChange={onPreviewChange} />
                )}
                <ParameterPanel
                  previewStatus={previewStatus}
                  copy={copy}
                  legend={copy.parameters}
                  disabled={disabled || pending}
                  message={
                    message ??
                    (previewStatus === "error" ? (previewDiagnostic ?? copy.previewFailed) : null)
                  }
                  actions={
                    <TaskPanelFormActions
                      acceptLabel={copy.submit}
                      ariaLabel={copy.title}
                      cancelLabel={copy.cancel}
                      disabled={disabled || !feature}
                      onCancel={onCancel}
                      previewStatus={previewStatus}
                    />
                  }
                >
                  {mode.operation === "loft" ? (
                    <>
                      <LoftSectionFields
                        sections={values.sections}
                        ruled={values.ruled}
                        ruledDisabled={values.constrained}
                        profiles={profiles}
                        copy={copy}
                        onSectionsChange={(sections) => {
                          setMessage(null)
                          const tracks = sections.some(
                            ({ holeBoundaryEntityIds }) => holeBoundaryEntityIds.length > 0,
                          )
                            ? values.holeCorrespondence.map((track) => ({
                                sectionBoundaryEntityIds: sections.map((section) => {
                                  const oldIndex = values.sections.findIndex(
                                    (old) =>
                                      sketchProfileSelectorKey(old) ===
                                      sketchProfileSelectorKey(section),
                                  )
                                  return [...(track.sectionBoundaryEntityIds[oldIndex] ?? [])]
                                }),
                              }))
                            : []
                          form.setFieldValue("holeCorrespondence", tracks)
                          form.setFieldValue(
                            "outerCorrespondence",
                            remapLoftOuterTracks(
                              values.outerCorrespondence,
                              values.sections,
                              sections,
                            ),
                          )
                          form.setFieldValue("sections", sections)
                        }}
                        onRuledChange={(ruled) => {
                          setMessage(null)
                          form.setFieldValue("ruled", ruled)
                        }}
                      />
                      {!values.constrained && (
                        <LoftHoleFields
                          sections={values.sections}
                          tracks={values.holeCorrespondence}
                          onChange={(tracks) => form.setFieldValue("holeCorrespondence", tracks)}
                        />
                      )}
                      <LoftConstraintFields
                        values={values}
                        sections={values.sections}
                        paths={paths}
                        supports={supports}
                        copy={copy}
                        onChange={(changes) => {
                          setMessage(null)
                          if (changes.constrained !== undefined) {
                            form.setFieldValue("constrained", changes.constrained)
                            if (changes.constrained) form.setFieldValue("ruled", false)
                          }
                          if (changes.outerCorrespondence !== undefined)
                            form.setFieldValue("outerCorrespondence", changes.outerCorrespondence)
                          if (changes.rails !== undefined)
                            form.setFieldValue("rails", changes.rails)
                          if (changes.guides !== undefined)
                            form.setFieldValue("guides", changes.guides)
                          if (changes.start !== undefined)
                            form.setFieldValue("start", changes.start)
                          if (changes.end !== undefined) form.setFieldValue("end", changes.end)
                        }}
                      />
                    </>
                  ) : (
                    <SweepPathSection
                      values={values}
                      profiles={profiles}
                      paths={paths}
                      copy={copy}
                      axisOptions={axisOptions}
                      state={parameterState}
                      variables={snapshot.variables}
                      disabled={disabled}
                      pending={pending}
                      onChange={updatePath}
                    />
                  )}
                </ParameterPanel>
              </>
            )
          }}
        </form.Subscribe>
      </TaskPanelContentProvider>
    </Form>
  )
}

function HelicalPathFields({
  values,
  profiles,
  copy,
  axisOptions,
  state,
  variables,
  disabled,
  onChange,
}: {
  values: SweepLoftFormValues
  profiles: readonly ProfileOption[]
  copy: SweepLoftFormCopy
  axisOptions: ReferenceFrameOptions | undefined
  state: ReturnType<typeof useParameterFormState>
  variables: Parameters<typeof parseHelixForm>[1]
  disabled: boolean
  onChange: (changes: Partial<SweepLoftFormValues>) => void
}) {
  const helix = parseHelixForm(values, variables, state.displayUnits, copy)
  const lead = helix.ok
    ? (Math.atan2(helix.parameters.pitch.value, 2 * Math.PI * helix.parameters.radius.value) *
        180) /
      Math.PI
    : null
  return (
    <>
      <label htmlFor="sweep-profile" className={fieldVariants({ orientation: "horizontal" })}>
        <span>{copy.profile}</span>
        <NativeSelect
          id="sweep-profile"
          aria-label={copy.profile}
          value={values.profileKey}
          disabled={disabled}
          onChange={(event) => onChange({ profileKey: event.currentTarget.value })}
        >
          <option value="">{copy.chooseProfile}</option>
          {profiles.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="text-xs text-muted-foreground">{copy.helixPathDescription}</p>
      <HelixFields
        idPrefix="sweep-helix"
        values={values}
        issues={helix.ok ? {} : helix.issues}
        copy={copy}
        axisOptions={axisOptions}
        suggestions={state.suggestions}
        disabled={disabled}
        onChange={onChange}
      />
      {lead !== null && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {copy.leadAngle((Math.round(lead * 1000) / 1000).toString())}
        </p>
      )}
    </>
  )
}

type SweepPathSectionProps = Readonly<{
  values: SweepLoftFormValues
  profiles: readonly ProfileOption[]
  paths: readonly PathSketchOption[]
  copy: SweepLoftFormCopy
  axisOptions: ReferenceFrameOptions | undefined
  state: ReturnType<typeof useParameterFormState>
  variables: Parameters<typeof parseHelixForm>[1]
  disabled: boolean
  pending: boolean
  onChange: (changes: Partial<SweepLoftFormValues>) => void
}>
/** Sweep path type: an authored sketch path (v1) or an exact helix (v2). */
function SweepPathSection({ pending, ...props }: SweepPathSectionProps) {
  const { values, copy, onChange } = props
  const disabled = props.disabled || pending
  return (
    <>
      <ChoiceField
        id="sweep-path-kind"
        label={copy.pathKind}
        value={values.pathKind}
        disabled={disabled}
        onValueChange={(value) => onChange({ pathKind: value === "helix" ? "helix" : "sketch" })}
        options={[
          { value: "sketch", label: copy.sketchPath },
          { value: "helix", label: copy.helixPath },
        ]}
      />
      {values.pathKind === "helix" ? (
        <HelicalPathFields {...props} disabled={disabled} />
      ) : (
        <SweepPathFields
          values={values}
          profiles={props.profiles}
          paths={props.paths}
          copy={copy}
          onChange={onChange}
        />
      )}
    </>
  )
}
