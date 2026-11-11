import type { FeatureId, FeatureRecord } from "@vibeshape/domain"
import type { BodyReference } from "@vibeshape/domain/body-reference"
import type { ModelBodyTopologyEvidence } from "@vibeshape/domain/model-body-topology"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { BodyFacePickingSync } from "./body-face-selection"
import type { ShellPickingContext, ShellPickRequest } from "./shell-picking"

/** Repair or unavailable-source note for a task that selects faces of one exact body. */
export function BodyFaceStatusNotes({
  copy,
  repair,
  available,
}: Readonly<{
  copy: Readonly<{ repair: string; unavailable: string }>
  repair: boolean
  available: boolean
}>) {
  const note = available ? (repair ? copy.repair : null) : copy.unavailable
  return note ? (
    <p role="status" className="text-sm text-muted-foreground">
      {note}
    </p>
  ) : null
}

function BodyFacePreview(props: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ onPreviewChange: props.onPreviewChange, preview: props.feature })
  return null
}

/** Keeps viewport face picking and the disposable exact preview in step with the form values. */
export function BodyFaceFormSync(
  props: Readonly<{
    evidence: ModelBodyTopologyEvidence | null
    featureId: FeatureId
    target: BodyReference
    faceIds: string[]
    preview: FeatureRecord | null
    request: ShellPickRequest | null
    toggle: (candidateId: string) => string[] | null
    onContextChange: ((context: ShellPickingContext | null) => void) | undefined
    onPreviewChange: ((feature: FeatureRecord | null) => void) | undefined
    onSelectionChange: (ids: string[]) => void
  }>,
) {
  return (
    <>
      <BodyFacePickingSync
        enabled
        evidence={props.evidence}
        featureId={props.featureId}
        target={props.target}
        selectedIds={props.faceIds}
        request={props.request}
        onContextChange={props.onContextChange}
        pick={(request) => props.toggle(request.candidateId)}
        onSelectionChange={props.onSelectionChange}
      />
      {props.onPreviewChange && (
        <BodyFacePreview feature={props.preview} onPreviewChange={props.onPreviewChange} />
      )}
    </>
  )
}
