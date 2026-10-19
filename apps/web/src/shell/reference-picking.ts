import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"

/** Option keys are owned by the form; mesh face IDs are disposable rebuild evidence. */
export type ReferencePickCandidate = Readonly<
  { id: string; featureId: string } & (
    | { kind: "body"; outputRole: string }
    | { kind: "face"; outputRole: string; meshFaceId: number }
    | { kind: "producer" }
  )
>

export function resolveReferencePick(
  candidates: readonly ReferencePickCandidate[],
  selection: ViewerSelection,
): ReferencePickCandidate | null {
  const matches = candidates.filter((candidate) => {
    if (candidate.featureId !== selection.featureId) return false
    if (candidate.kind === "producer") return true
    if (selection.outputRole === undefined || candidate.outputRole !== selection.outputRole)
      return false
    return candidate.kind === "body" || candidate.meshFaceId === selection.faceId
  })
  // Legacy whole-producer options may coexist with their explicit body replacement.
  const exactBodies = matches.filter(({ kind }) => kind === "body")
  const eligible =
    exactBodies.length > 0 ? matches.filter(({ kind }) => kind !== "producer") : matches
  return eligible.length === 1 ? (eligible[0] ?? null) : null
}
