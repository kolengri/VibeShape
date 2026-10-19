import type { ReferencePickCandidate } from "../../shell/reference-picking"

export function bodyReferencePickCandidate(
  id: string,
  body: Readonly<{ featureId: string; outputRole?: string }>,
): ReferencePickCandidate {
  return body.outputRole === undefined
    ? { id, featureId: body.featureId, kind: "producer" }
    : { id, featureId: body.featureId, outputRole: body.outputRole, kind: "body" }
}

export function exactBodyPickCandidates(
  options: readonly Readonly<{
    id: string
    body?: Readonly<{ featureId: string; outputRole: string }>
  }>[],
): readonly ReferencePickCandidate[] {
  return options.map((option) =>
    bodyReferencePickCandidate(option.id, option.body ?? { featureId: option.id }),
  )
}
