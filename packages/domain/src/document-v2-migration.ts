import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { documentSnapshotV1Schema } from "./document"
import { documentSnapshotV2Schema } from "./document-v2"
import {
  documentUpgradedV2EventSchema,
  documentUpgradeV2CommandSchema,
} from "./document-v2-command-schemas"
import {
  allocationsFromEffects,
  type DocumentV2CommandResult,
  type DocumentV2Result,
  invalidV2,
  validateV2Envelope,
} from "./document-v2-support"
import { draftIdSchema } from "./identifiers"
import { planPartEffects } from "./part-effects"

const upgradeOptionsSchema = z
  .object({ transactionId: draftIdSchema.nullable().optional() })
  .strict()

/** Pure N -> N+1 transition. Persistence must atomically commit the event, snapshot and head. */
export function applyDocumentUpgradeV2Command(
  snapshotInput: unknown,
  commandInput: unknown,
  optionsInput: unknown = {},
): DocumentV2CommandResult {
  const snapshot = documentSnapshotV1Schema.safeParse(snapshotInput)
  const command = documentUpgradeV2CommandSchema.safeParse(commandInput)
  const options = upgradeOptionsSchema.safeParse(optionsInput)
  if (!snapshot.success || !command.success || !options.success)
    return invalidV2("The V2 upgrade command or V1 source is invalid.", "invalid-command")
  const planned = planPartEffects({
    after: snapshot.data,
    parts: [],
    allocations: command.data.payload.partAllocations,
  })
  if (!planned.ok) return invalidV2(planned.message, "invalid-command")
  const { kind: _kind, payload: _payload, ...envelope } = command.data
  const event = documentUpgradedV2EventSchema.safeParse({
    ...envelope,
    type: "org.vibeshape.document.upgraded-v2",
    transactionId: options.data.transactionId ?? null,
    revision: envelope.baseRevision + 1,
    partEffects: planned.effects,
  })
  if (!event.success)
    return invalidV2("The V2 upgrade revision cannot advance safely.", "revision-exhausted")
  const reduced = reduceDocumentUpgradedV2Event(snapshot.data, event.data)
  return reduced.ok ? { ...reduced, event: event.data } : reduced
}

export function reduceDocumentUpgradedV2Event(
  snapshotInput: unknown,
  eventInput: unknown,
): DocumentV2Result {
  const snapshot = documentSnapshotV1Schema.safeParse(snapshotInput)
  const event = documentUpgradedV2EventSchema.safeParse(eventInput)
  if (!snapshot.success || !event.success)
    return invalidV2("A V2 upgrade requires a valid V1 source and upgrade event.")
  const envelopeIssue = validateV2Envelope(snapshot.data, event.data)
  if (envelopeIssue) return envelopeIssue
  const planned = planPartEffects({
    after: snapshot.data,
    parts: [],
    allocations: allocationsFromEffects(event.data.partEffects),
  })
  if (!planned.ok) return invalidV2(planned.message)
  if (canonicalJson(planned.effects) !== canonicalJson(event.data.partEffects))
    return invalidV2("The captured upgrade part effects do not match the source model.")
  const next = documentSnapshotV2Schema.safeParse({
    ...snapshot.data,
    schemaVersion: 2,
    revision: event.data.revision,
    updatedAt: event.data.issuedAt,
    parts: planned.parts,
    folders: [],
  })
  return next.success
    ? { ok: true, snapshot: next.data }
    : invalidV2("The V2 upgrade produces invalid authored metadata.")
}
