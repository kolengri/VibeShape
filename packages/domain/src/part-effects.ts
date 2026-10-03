import { canonicalJson } from "./canonical-json"
import type { DocumentSnapshotV1 } from "./document"
import {
  derivePartBindings,
  requiredPartAllocations,
  retainedPartAllocations,
} from "./part-bindings"
import { type PartAllocation, type PartEffect, type PartRecord, partRecordsSchema } from "./parts"

type PlanResult =
  | Readonly<{ ok: true; parts: readonly PartRecord[]; effects: readonly PartEffect[] }>
  | Readonly<{ ok: false; message: string }>

function capturedAllocationsAreFresh(
  parts: readonly PartRecord[],
  after: DocumentSnapshotV1,
  allocations: readonly PartAllocation[],
): boolean {
  const priorIds = new Set(parts.map((part) => part.id))
  const requirements = new Set(
    requiredPartAllocations(after, parts).map((root) => canonicalJson(root)),
  )
  return (
    new Set(allocations.map((allocation) => allocation.id)).size === allocations.length &&
    allocations.every(
      (allocation) =>
        !priorIds.has(allocation.id) &&
        requirements.has(canonicalJson({ body: allocation.body, origin: allocation.origin })),
    )
  )
}

function diffParts(
  before: readonly PartRecord[],
  after: readonly PartRecord[],
): readonly PartEffect[] {
  const previous = new Map(before.map((part) => [part.id, part]))
  const current = new Set(after.map((part) => part.id))
  const effects: PartEffect[] = before
    .filter((part) => !current.has(part.id))
    .map((part) => ({ kind: "remove", partId: part.id }))
  for (const part of after) {
    const prior = previous.get(part.id)
    if (!prior) effects.push({ kind: "create", part })
    else if (canonicalJson(prior) !== canonicalJson(part)) effects.push({ kind: "replace", part })
  }
  return effects
}

/** Captured allocations are the only source of new identities; order follows canonical History. */
export function planPartEffects(
  input: Readonly<{
    after: DocumentSnapshotV1
    parts: readonly PartRecord[]
    allocations: readonly PartAllocation[]
  }>,
): PlanResult {
  if (!capturedAllocationsAreFresh(input.parts, input.after, input.allocations))
    return {
      ok: false,
      message: "Part allocations must use fresh IDs and match newly required roots.",
    }
  const existing = retainedPartAllocations(input.after, input.parts)
  const derived = derivePartBindings(input.after, [...existing, ...input.allocations], input.parts)
  if (!derived)
    return {
      ok: false,
      message: "Each independent or fork root requires exactly one matching captured allocation.",
    }
  const previous = new Map(input.parts.map((part) => [part.id, part]))
  const parts = derived.map((part) => ({
    ...part,
    visible: previous.get(part.id)?.visible ?? part.visible,
  }))
  const parsed = partRecordsSchema.safeParse(parts)
  return parsed.success
    ? { ok: true, parts: parsed.data, effects: diffParts(input.parts, parsed.data) }
    : {
        ok: false,
        message: "The resulting part collection exceeds its bounds or repeats a body binding.",
      }
}
