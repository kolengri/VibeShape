import type { AutomationDraftPreview } from "@vibeshape/automation-api/drafts"
import type { DraftReviewInput } from "@vibeshape/automation-host/host"
import { type DocumentSnapshot, readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentWorkerResponse, FeatureEvaluationEngineResult } from "@vibeshape/protocol"
import { terminalModelBodies } from "../features/part-design/model-bodies"
import type { AutomationReviewState } from "./automation-review-state"

type Rebuild = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

export type AutomationDraftViewport = Readonly<{
  draft: AutomationDraftPreview["draft"]
  generation: number
  preview: Readonly<{
    status: "ready"
    meshes: readonly (FeatureEvaluationEngineResult["mesh"] &
      Readonly<{ featureId: string; outputRole?: string; appearance: "preview" }>)[]
  }>
}>

/** Takes ownership of the retained buffers from the review's exact disposable rebuild. */
export function createAutomationDraftViewport(
  review: Pick<DraftReviewInput, "preview" | "metadata">,
  snapshot: DocumentSnapshot,
  rebuild: Rebuild,
): AutomationDraftViewport | null {
  const { draft, geometry } = review.preview
  if (
    review.metadata ||
    geometry.status !== "valid" ||
    snapshot.id !== draft.documentId ||
    snapshot.revision !== draft.revision ||
    rebuild.documentId !== snapshot.id ||
    rebuild.revision !== snapshot.revision ||
    rebuild.generation !== geometry.measurements.generation
  )
    return null
  const bodies = terminalModelBodies(snapshot.features, rebuild)
  if (!bodies) return null
  const datumIds = new Set<string>(
    snapshot.features.filter(readDatumPlaneFeatureParameters).map(({ id }) => id),
  )
  return {
    draft: { ...draft },
    generation: rebuild.generation,
    preview: {
      status: "ready",
      // Every draft body is presentation-only, including new datum planes.
      meshes: [
        ...bodies.map(({ geometry: { featureId, outputRole, mesh } }) => ({
          ...mesh,
          featureId,
          ...(outputRole === undefined ? {} : { outputRole }),
          appearance: "preview" as const,
        })),
        ...rebuild.geometry
          .filter(({ featureId }) => datumIds.has(featureId))
          .map(({ featureId, geometry }) => ({
            ...geometry.mesh,
            featureId,
            appearance: "preview" as const,
          })),
      ],
    },
  }
}

export function automationDraftViewportPreview(
  review: AutomationReviewState | null,
  committed: DocumentSnapshot | null,
  presentation: AutomationDraftViewport | null = null,
): AutomationDraftViewport["preview"] | null {
  if (!review || review.status === "error") {
    return presentation &&
      committed?.id === presentation.draft.documentId &&
      committed.revision === presentation.draft.baseRevision
      ? presentation.preview
      : null
  }
  const viewport = review?.draftViewport
  if (!viewport || !committed) return null
  if ("kind" in review.input || review.input.metadata) return null
  const { draft, geometry } = review.input.preview
  if (
    draft.draftId !== viewport.draft.draftId ||
    draft.documentId !== viewport.draft.documentId ||
    draft.baseRevision !== viewport.draft.baseRevision ||
    draft.revision !== viewport.draft.revision ||
    geometry.measurements.generation !== viewport.generation ||
    committed.id !== draft.documentId ||
    committed.revision !== draft.baseRevision
  )
    return null
  return viewport.preview
}
