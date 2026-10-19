import type { ReferencePickCandidate } from "../../shell/reference-picking"
import { type ExtrusionTargetOption, extrusionBodyOptionKey } from "./extrusion-body-options"

export function extrusionTargetPickCandidates(
  options: readonly ExtrusionTargetOption[],
): readonly ReferencePickCandidate[] {
  return options.map((option) =>
    option.outputRole
      ? {
          id: extrusionBodyOptionKey(option),
          kind: "body",
          featureId: option.id,
          outputRole: option.outputRole,
        }
      : { id: option.id, kind: "producer", featureId: option.id },
  )
}

export function extrusionEndBodyPickCandidates(
  options: readonly ExtrusionTargetOption[],
): readonly ReferencePickCandidate[] {
  return extrusionTargetPickCandidates(
    options.filter((option) => option.outputRole && option.contentHash),
  )
}

export function extrusionEndFacePickCandidates(
  options: readonly ExtrusionTargetOption[],
): readonly ReferencePickCandidate[] {
  return options.flatMap((option) => {
    const outputRole = option.outputRole
    if (!outputRole || !option.contentHash) return []
    return (option.faces ?? []).flatMap<ReferencePickCandidate>((face) =>
      face.meshFaceId === undefined
        ? []
        : [
            {
              id: JSON.stringify(face.reference),
              kind: "face",
              featureId: option.id,
              outputRole,
              meshFaceId: face.meshFaceId,
            },
          ],
    )
  })
}

/** Keeps the exact body, current evidence hash and stable face reference together. */
export function extrusionEndFaceSelection(
  options: readonly ExtrusionTargetOption[],
  value: string,
) {
  const matches = options.flatMap((option) => {
    const sourceHash = option.contentHash
    return option.outputRole && sourceHash
      ? (option.faces ?? [])
          .filter((face) => JSON.stringify(face.reference) === value)
          .map(() => ({
            endTarget: extrusionBodyOptionKey(option),
            endSourceHash: sourceHash,
            endFace: value,
          }))
      : []
  })
  return matches.length === 1 ? matches[0] : undefined
}
