import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { cadFormValidationLogic, useCadForm } from "../part-design/cad-form"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { type LoftConstraintCopy, LoftConstraintFields } from "./loft-constraint-fields"
import { type LoftSupportOption, remapLoftOuterTracks } from "./loft-constraint-model"
import { LoftHoleFields } from "./loft-hole-fields"
import { type LoftSectionCopy, LoftSectionFields } from "./loft-section-fields"
import {
  type PathSketchOption,
  type ProfileOption,
  type SweepLoftFormMode,
  sweepLoftFeatureRecord,
  sweepLoftFormValues,
} from "./sweep-loft-form-model"
import { type SweepPathCopy, SweepPathFields } from "./sweep-path-fields"
export type SweepLoftFormCopy = ParameterPanelCopy &
  LoftSectionCopy &
  LoftConstraintCopy &
  SweepPathCopy &
  Readonly<{
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
  const form = useCadForm({
    validationLogic: cadFormValidationLogic,
    defaultValues: sweepLoftFormValues(mode),
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
        )
        return feature ? undefined : copy.validationSummary
      },
    },
    onSubmit: async ({ value }) => {
      const feature = sweepLoftFeatureRecord(
        mode,
        featureId,
        value,
        profiles,
        paths,
        snapshot,
        supports,
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
  return (
    <Form form={form} aria-label={copy.title} className="gap-0">
      <form.FormError />
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
          )
          return (
            <>
              {onPreviewChange && (
                <SweepLoftPreview feature={feature} onPreviewChange={onPreviewChange} />
              )}
              <ParameterPanel
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
                        if (changes.rails !== undefined) form.setFieldValue("rails", changes.rails)
                        if (changes.guides !== undefined)
                          form.setFieldValue("guides", changes.guides)
                        if (changes.start !== undefined) form.setFieldValue("start", changes.start)
                        if (changes.end !== undefined) form.setFieldValue("end", changes.end)
                      }}
                    />
                  </>
                ) : (
                  <SweepPathFields
                    values={values}
                    profiles={profiles}
                    paths={paths}
                    copy={copy}
                    onChange={(changes) => {
                      setMessage(null)
                      if (changes.profileKey !== undefined)
                        form.setFieldValue("profileKey", changes.profileKey)
                      if (changes.pathSketchId !== undefined)
                        form.setFieldValue("pathSketchId", changes.pathSketchId)
                      if (changes.entityIds !== undefined)
                        form.setFieldValue("entityIds", changes.entityIds)
                      if (changes.startPointId !== undefined)
                        form.setFieldValue("startPointId", changes.startPointId)
                    }}
                  />
                )}
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
