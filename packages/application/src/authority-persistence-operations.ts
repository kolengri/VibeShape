import {
  canonicalJson,
  projectDocumentSnapshotV1ToV0,
  reduceVersionedDocumentEvent,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import type { DocumentSnapshot, DocumentSnapshotV1 } from "@vibeshape/domain/document"
import {
  type DocumentAuthoritySnapshot,
  type DocumentSnapshotV2,
  type PartRootRequirement,
  projectDocumentSnapshotV2ToV1,
  requiredPartAllocations,
} from "@vibeshape/domain/document-v2"
import {
  documentRestoredV2EventSchema,
  documentV2CommandEnvelopeSchema,
  documentV2MetadataCommandSchema,
} from "@vibeshape/domain/document-v2-command-schemas"
import {
  applyDocumentV2ModelEvent,
  reduceDocumentV2Event,
} from "@vibeshape/domain/document-v2-commands"
import type { FeatureRecordV1 } from "@vibeshape/domain/feature-graph"
import type { PartAllocation, PartRecord } from "@vibeshape/domain/parts"
import { z } from "zod"
import type { DocumentHistoryRequest, SessionPortResult } from "./persistent-document-session"

export type PartAllocationFactory = (
  requirement: PartRootRequirement,
  feature: FeatureRecordV1 | undefined,
  ordinal: number,
) => PartAllocation

export const documentAuthoredCommandRequestSchema = z.union([
  documentV2MetadataCommandSchema,
  documentV2CommandEnvelopeSchema.extend({
    kind: z.literal("org.vibeshape.document.upgrade-v2"),
    payload: z.object({}).strict(),
  }),
])
export type DocumentAuthoredCommandRequest = z.infer<typeof documentAuthoredCommandRequestSchema>

export function authorityFailure(
  code: string,
  message: string,
): Extract<SessionPortResult<never>, { ok: false }> {
  return { ok: false, diagnostic: { code, message, retryable: false } }
}

export function modelProjection(snapshot: DocumentAuthoritySnapshot): DocumentSnapshotV1 {
  return snapshot.schemaVersion === 2 ? projectDocumentSnapshotV2ToV1(snapshot) : snapshot
}

export function runtimeProjection(snapshot: DocumentAuthoritySnapshot) {
  return projectDocumentSnapshotV1ToV0(modelProjection(snapshot))
}

export function matchRuntimeProjection(
  authority: DocumentAuthoritySnapshot,
  expected: DocumentSnapshot,
) {
  const projected = runtimeProjection(authority)
  return projected.ok && canonicalJson(projected.snapshot) === canonicalJson(expected)
    ? null
    : authorityFailure(
        "invalid-input",
        "The authored authority and runtime snapshot do not match canonically.",
      )
}

export function capturePartAllocations(
  model: DocumentSnapshotV1,
  parts: readonly PartRecord[],
  createPart: PartAllocationFactory,
) {
  const features = new Map(model.features.map((feature) => [feature.id, feature]))
  return requiredPartAllocations(model, parts).map((requirement, index) =>
    createPart(requirement, features.get(requirement.body.featureId), parts.length + index + 1),
  )
}

export function prepareAuthorityModelEvent(
  base: DocumentSnapshotV2,
  event: VersionedDocumentEvent,
  createPart: PartAllocationFactory,
) {
  const model = reduceVersionedDocumentEvent(modelProjection(base), event)
  if (!model.ok) return authorityFailure("invalid-event", model.diagnostic.message)
  const allocations = capturePartAllocations(model.snapshot, base.parts, createPart)
  return applyDocumentV2ModelEvent(base, event, allocations)
}

export function prepareAuthorityRestore(
  base: DocumentSnapshotV2,
  request: DocumentHistoryRequest,
  target: DocumentSnapshotV2 | null,
) {
  if (!target)
    return authorityFailure("history-unavailable", "There is no saved change in this direction.")
  const event = documentRestoredV2EventSchema.safeParse({
    ...request,
    schemaVersion: 2,
    type: "org.vibeshape.document.restored",
    transactionId: null,
    revision: base.revision + 1,
    targetRevision: target.revision,
  })
  if (!event.success)
    return authorityFailure("invalid-event", "The authored history request is invalid.")
  const restored = reduceDocumentV2Event(base, event.data, target)
  if (!restored.ok) return authorityFailure("invalid-event", restored.diagnostic.message)
  return { ok: true as const, event: event.data, snapshot: restored.snapshot }
}
