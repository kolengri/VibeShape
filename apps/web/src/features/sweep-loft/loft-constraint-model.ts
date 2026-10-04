import { canonicalJson, type SketchEntityId, type SketchProfileSelector } from "@vibeshape/domain"
import type { BodyFaceRef } from "@vibeshape/domain/body-topology-reference"
import { readLoftFeatureParametersV3 } from "@vibeshape/domain/part-design-loft-v3"
import { sketchProfileSelectorKey } from "@vibeshape/domain/sketch-profile-selector"
import type { SweepLoftFormMode } from "./sweep-loft-form-model"

export type LoftPathValues = { sketchId: string; entityIds: SketchEntityId[]; startPointId: string }
export type LoftEndValues = {
  segmentTrack: number
  continuity: "G1" | "G2"
  support: BodyFaceRef | null
}
export type LoftConstraintValues = {
  constrained: boolean
  outerCorrespondence: {
    sectionEntityIds: (SketchEntityId | "")[]
    sectionStartPointIds: (SketchEntityId | "")[]
  }[]
  rails: { vertexTrack: number; path: LoftPathValues }[]
  guides: { name: string; segmentTrack: number; continuity: "C0"; path: LoftPathValues }[]
  start: LoftEndValues[]
  end: LoftEndValues[]
}
export type LoftSupportOption = { key: string; label: string; reference: BodyFaceRef }
export const emptyLoftPath = (): LoftPathValues => ({
  sketchId: "",
  entityIds: [],
  startPointId: "",
})
export const loftSupportKey = (reference: BodyFaceRef) => canonicalJson(reference)
export function loftConstraintValues(mode: SweepLoftFormMode): LoftConstraintValues {
  const parameters = mode.kind === "edit" ? readLoftFeatureParametersV3(mode.feature) : null
  return parameters
    ? { constrained: true, ...structuredClone(parameters) }
    : { constrained: false, outerCorrespondence: [], rails: [], guides: [], start: [], end: [] }
}
/** Preserve the explicitly authored cells when section order changes; new cells stay unassigned. */
export function remapLoftOuterTracks(
  tracks: LoftConstraintValues["outerCorrespondence"],
  previous: readonly SketchProfileSelector[],
  next: readonly SketchProfileSelector[],
): LoftConstraintValues["outerCorrespondence"] {
  return tracks.map((track) => {
    const indexes = next.map((section) =>
      previous.findIndex(
        (old) => sketchProfileSelectorKey(old) === sketchProfileSelectorKey(section),
      ),
    )
    return {
      sectionEntityIds: indexes.map((index) => track.sectionEntityIds[index] ?? ""),
      sectionStartPointIds: indexes.map((index) => track.sectionStartPointIds[index] ?? ""),
    }
  })
}
