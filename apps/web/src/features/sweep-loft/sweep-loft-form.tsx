import type { DocumentSnapshot, FeatureRecord } from "@vibeshape/domain"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import { ParameterPanel, type ParameterPanelCopy } from "../part-design/parameter-panel"
import {
  type FeatureParameterFormProps,
  submitFeatureMutation,
} from "../part-design/primitive-form"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
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
  const form = useAppForm({
    defaultValues: sweepLoftFormValues(mode),
    onSubmit: async ({ value }) => {
      const feature = sweepLoftFeatureRecord(mode, featureId, value, profiles, paths, snapshot)
      if (!feature) {
        setMessage(copy.validationSummary)
        return
      }
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
      <form.Subscribe selector={(state) => [state.values, state.isSubmitting] as const}>
        {([values, pending]) => {
          const feature = sweepLoftFeatureRecord(mode, featureId, values, profiles, paths, snapshot)
          return (
            <>
              {onPreviewChange && (
                <SweepLoftPreview feature={feature} onPreviewChange={onPreviewChange} />
              )}
              <ParameterPanel
                copy={copy}
                legend={copy.parameters}
                disabled={disabled || pending}
                message={message ?? (previewStatus === "error" ? copy.previewFailed : null)}
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
                      profiles={profiles}
                      copy={copy}
                      onSectionsChange={(sections) => {
                        setMessage(null)
                        const tracks = values.holeCorrespondence.map((track) => ({
                          sectionBoundaryEntityIds: sections.map((section) => {
                            const oldIndex = values.sections.findIndex(
                              (old) =>
                                sketchProfileSelectorKey(old) === sketchProfileSelectorKey(section),
                            )
                            return [...(track.sectionBoundaryEntityIds[oldIndex] ?? [])]
                          }),
                        }))
                        form.setFieldValue("holeCorrespondence", tracks)
                        form.setFieldValue("sections", sections)
                      }}
                      onRuledChange={(ruled) => {
                        setMessage(null)
                        form.setFieldValue("ruled", ruled)
                      }}
                    />
                    <LoftHoleFields
                      sections={values.sections}
                      tracks={values.holeCorrespondence}
                      onChange={(tracks) => form.setFieldValue("holeCorrespondence", tracks)}
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
