import {
  canonicalJson,
  projectDocumentSnapshotV1ToV0,
  reduceVersionedDocumentEvent,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import type { DocumentSnapshot, DocumentSnapshotV1 } from "@vibeshape/domain/document"
import {
  type AuthoredDocumentSnapshot,
  type DocumentAuthoritySnapshot,
  type PartRootRequirement,
  projectAuthoredDocumentSnapshotToV1,
  requiredPartAllocations,
} from "@vibeshape/domain/document-v2"
import {
  documentRestoredV2EventSchema,
  documentRestoredV3EventSchema,
  documentUpgradeV3CommandSchema,
  documentV2CommandEnvelopeSchema,
  documentV2MetadataCommandSchema,
  documentV3MetadataCommandSchema,
} from "@vibeshape/domain/document-v2-command-schemas"
import {
  applyDocumentV2Command,
  applyDocumentV2ModelEvent,
  reduceDocumentV2Event,
} from "@vibeshape/domain/document-v2-commands"
import {
  applyDocumentV3Command,
  applyDocumentV3ModelEvent,
  reduceDocumentV3Event,
} from "@vibeshape/domain/document-v3-commands"
import {
  documentRestoredV4EventSchema,
  documentV4CommandSchema,
} from "@vibeshape/domain/document-v4-command-schemas"
import {
  applyDocumentV4AuthoredCommand,
  applyDocumentV4Command,
  applyDocumentV4ModelEvent,
  reduceDocumentV4Event,
} from "@vibeshape/domain/document-v4-commands"
import {
  documentRestoredV5EventSchema,
  historyRemoveRetainingDependentsCommandSchema,
  historyRepairCommandSchema,
} from "@vibeshape/domain/document-v5-command-schemas"
import {
  applyDocumentV5AuthoredCommand,
  applyDocumentV5ModelEvent,
  applyHistoryRemoveRetainingDependentsCommand,
  applyHistoryRepairCommand,
  type DocumentV5CommandResult,
  prepareHistoryRepairModel,
  reduceDocumentV5Event,
} from "@vibeshape/domain/document-v5-commands"
import { projectDocumentSnapshotV6ToV5 } from "@vibeshape/domain/document-v6"
import {
  documentRestoredV6EventSchema,
  documentV6MetadataCommandSchema,
} from "@vibeshape/domain/document-v6-command-schemas"
import {
  applyDocumentV6MetadataCommand,
  type DocumentV6CommandResult,
  reduceDocumentV6Event,
  wrapDocumentV6AuthoredResult,
} from "@vibeshape/domain/document-v6-commands"
import type { FeatureRecordV1 } from "@vibeshape/domain/feature-graph"
import type { PartAllocation, PartRecord } from "@vibeshape/domain/parts"
import { z } from "zod"
import { draftDiagnosticCause } from "./draft-validation-diagnostics"
import type { DocumentHistoryRequest, SessionPortResult } from "./persistent-document-session"

export type PartAllocationFactory = (
  requirement: PartRootRequirement,
  feature: FeatureRecordV1 | undefined,
  ordinal: number,
) => PartAllocation

export const documentAuthoredCommandRequestSchema = z.union([
  documentV6MetadataCommandSchema,
  documentV2MetadataCommandSchema,
  documentV3MetadataCommandSchema,
  documentUpgradeV3CommandSchema,
  documentV4CommandSchema,
  historyRemoveRetainingDependentsCommandSchema,
  historyRepairCommandSchema,
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
  return snapshot.schemaVersion !== 1 ? projectAuthoredDocumentSnapshotToV1(snapshot) : snapshot
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
  base: AuthoredDocumentSnapshot,
  event: VersionedDocumentEvent,
  createPart: PartAllocationFactory,
):
  | ReturnType<typeof applyDocumentV2ModelEvent>
  | ReturnType<typeof applyDocumentV3ModelEvent>
  | ReturnType<typeof applyDocumentV4ModelEvent>
  | DocumentV5CommandResult
  | DocumentV6CommandResult
  | ReturnType<typeof authorityFailure> {
  if (base.schemaVersion === 6) {
    const result = prepareAuthorityModelEvent(
      projectDocumentSnapshotV6ToV5(base),
      event,
      createPart,
    )
    if (!result.ok) return result
    if (result.event.schemaVersion !== 5 || result.snapshot.schemaVersion !== 5)
      return authorityFailure("invalid-event", "The V6 model projection lost repair authority.")
    return wrapDocumentV6AuthoredResult(base, {
      ok: true,
      event: result.event,
      snapshot: result.snapshot,
    })
  }
  const model = reduceVersionedDocumentEvent(modelProjection(base), event)
  if (!model.ok) return authorityFailure("invalid-event", draftDiagnosticCause(model.diagnostic))
  const allocationFactory: PartAllocationFactory =
    base.schemaVersion === 5
      ? (requirement, feature, ordinal) => {
          const suspended = base.suspendedParts.find(
            (part) =>
              canonicalJson(part.bodyHistory[0]) === canonicalJson(requirement.body) &&
              part.origin === requirement.origin,
          )
          return suspended
            ? {
                id: suspended.id,
                name: suspended.name,
                body: requirement.body,
                origin: requirement.origin,
              }
            : createPart(requirement, feature, ordinal)
        }
      : createPart
  const allocations = capturePartAllocations(model.snapshot, base.parts, allocationFactory)
  return base.schemaVersion === 5
    ? applyDocumentV5ModelEvent(base, event, allocations)
    : base.schemaVersion === 4
      ? applyDocumentV4ModelEvent(base, event, allocations)
      : base.schemaVersion === 3
        ? applyDocumentV3ModelEvent(base, event, allocations)
        : applyDocumentV2ModelEvent(base, event, allocations)
}

export function prepareAuthorityRestore(
  base: AuthoredDocumentSnapshot,
  request: DocumentHistoryRequest,
  target: AuthoredDocumentSnapshot | null,
) {
  if (!target)
    return authorityFailure("history-unavailable", "There is no saved change in this direction.")
  const { schema, reduce } = {
    2: { schema: documentRestoredV2EventSchema, reduce: reduceDocumentV2Event },
    3: { schema: documentRestoredV3EventSchema, reduce: reduceDocumentV3Event },
    4: { schema: documentRestoredV4EventSchema, reduce: reduceDocumentV4Event },
    5: { schema: documentRestoredV5EventSchema, reduce: reduceDocumentV5Event },
    6: { schema: documentRestoredV6EventSchema, reduce: reduceDocumentV6Event },
  }[base.schemaVersion]
  const event = schema.safeParse({
    ...request,
    schemaVersion: base.schemaVersion,
    type: "org.vibeshape.document.restored",
    transactionId: null,
    revision: base.revision + 1,
    targetRevision: target.revision,
  })
  if (!event.success)
    return authorityFailure("invalid-event", "The authored history request is invalid.")
  const restored = reduce(base, event.data, target)
  if (!restored.ok) return authorityFailure("invalid-event", restored.diagnostic.message)
  return { ok: true as const, event: event.data, snapshot: restored.snapshot }
}

export type AuthoredAuthoritySnapshot = AuthoredDocumentSnapshot
function promoteAuthoredCommand(command: unknown) {
  const versioned = z.object({ schemaVersion: z.number() }).passthrough().safeParse(command)
  return versioned.success && versioned.data.schemaVersion === 2
    ? { ...versioned.data, schemaVersion: 3 }
    : command
}
function prepareHistoryCommand(
  base: DocumentAuthoritySnapshot,
  command: unknown,
  options: { transactionId?: string | null },
  createPart: PartAllocationFactory | undefined,
) {
  const remove = historyRemoveRetainingDependentsCommandSchema.safeParse(command)
  if (remove.success)
    return applyHistoryRemoveRetainingDependentsCommand(base, remove.data, options)
  const repair = historyRepairCommandSchema.safeParse(command)
  if (!repair.success) return null
  if (base.schemaVersion !== 5)
    return authorityFailure("invalid-command", "History repair requires V5 authority.")
  const prepared = prepareHistoryRepairModel(base, repair.data.payload.item)
  if (!prepared.ok) return prepared
  const parts = [...base.parts, ...base.suspendedParts]
  const partAllocations = createPart
    ? capturePartAllocations(prepared.model, parts, createPart)
    : []
  return applyHistoryRepairCommand(base, repair.data, { ...options, partAllocations })
}
export function prepareAuthorityMetadataCommand(
  base: DocumentAuthoritySnapshot,
  command: unknown,
  options: { transactionId?: string | null } = {},
  createPart?: PartAllocationFactory,
):
  | ReturnType<typeof applyDocumentV2Command>
  | ReturnType<typeof applyDocumentV3Command>
  | ReturnType<typeof applyDocumentV4Command>
  | DocumentV5CommandResult
  | DocumentV6CommandResult
  | ReturnType<typeof authorityFailure> {
  const appearance = documentV6MetadataCommandSchema.safeParse(command)
  if (appearance.success) return applyDocumentV6MetadataCommand(base, appearance.data, options)
  if (base.schemaVersion === 6) {
    const result = prepareAuthorityMetadataCommand(
      projectDocumentSnapshotV6ToV5(base),
      command,
      options,
      createPart,
    )
    if (!result.ok) return result
    if (result.snapshot.schemaVersion !== 5 || result.event.schemaVersion !== 5)
      return authorityFailure("invalid-event", "V6 authored edits must preserve repair authority.")
    return wrapDocumentV6AuthoredResult(base, {
      ok: true,
      snapshot: result.snapshot,
      event: result.event,
    })
  }
  const history = prepareHistoryCommand(base, command, options, createPart)
  if (history) return history
  const sourceCommand = documentV4CommandSchema.safeParse(command)
  if (sourceCommand.success)
    return base.schemaVersion === 5
      ? applyDocumentV5AuthoredCommand(base, sourceCommand.data, options)
      : applyDocumentV4Command(base, sourceCommand.data, options)
  switch (base.schemaVersion) {
    case 5:
      return applyDocumentV5AuthoredCommand(base, promoteAuthoredCommand(command), options)
    case 4:
      return applyDocumentV4AuthoredCommand(base, promoteAuthoredCommand(command), options)
    case 3:
      return applyDocumentV3Command(base, promoteAuthoredCommand(command), options)
    default: {
      const header = z.object({ schemaVersion: z.number() }).passthrough().safeParse(command)
      return header.success && header.data.schemaVersion === 3
        ? applyDocumentV3Command(base, command, options)
        : applyDocumentV2Command(base, command, options)
    }
  }
}
