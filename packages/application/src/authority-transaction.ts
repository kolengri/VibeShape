import { applyVersionedDocumentCommand, versionedDocumentCommandSchema } from "@vibeshape/domain"
import type { DocumentAuthorityEvent } from "@vibeshape/domain/document-v2-command-schemas"
import {
  documentV2MetadataCommandSchema,
  documentV3CommandSchema,
} from "@vibeshape/domain/document-v2-command-schemas"
import { documentV4CommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import {
  historyRemoveRetainingDependentsCommandSchema,
  historyRepairCommandSchema,
} from "@vibeshape/domain/document-v5-command-schemas"
import { documentV6MetadataCommandSchema } from "@vibeshape/domain/document-v6-command-schemas"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { sourceAssetBlobSchema } from "@vibeshape/domain/source-assets"
import { z } from "zod"
import {
  type AuthoredAuthoritySnapshot,
  authorityFailure,
  modelProjection,
  type PartAllocationFactory,
  prepareAuthorityMetadataCommand,
  prepareAuthorityModelEvent,
} from "./authority-persistence-operations"

export const authorityTransactionSchema = z
  .object({
    transactionId: draftIdSchema,
    commands: z
      .array(
        z.union([
          documentV6MetadataCommandSchema,
          documentV4CommandSchema,
          historyRemoveRetainingDependentsCommandSchema,
          historyRepairCommandSchema,
          documentV3CommandSchema,
          documentV2MetadataCommandSchema,
          versionedDocumentCommandSchema,
        ]),
      )
      .min(1)
      .max(256),
    assetBlobs: z.array(sourceAssetBlobSchema).max(128).default([]),
  })
  .strict()

export function prepareAuthorityTransaction(
  base: AuthoredAuthoritySnapshot,
  input: unknown,
  createPart: PartAllocationFactory,
) {
  const parsed = authorityTransactionSchema.safeParse(input)
  if (!parsed.success)
    return authorityFailure("invalid-command", "The authored transaction is invalid.")
  let next = base
  let historyBase = base
  const events: DocumentAuthorityEvent[] = []
  for (const command of parsed.data.commands) {
    const options = { transactionId: parsed.data.transactionId }
    const applied =
      command.schemaVersion === 1
        ? applyVersionedDocumentCommand(modelProjection(next), command, options)
        : prepareAuthorityMetadataCommand(next, command, options, createPart)
    if (!applied.ok) return authorityFailure(applied.diagnostic.code, applied.diagnostic.message)
    const result =
      applied.event.schemaVersion === 1
        ? prepareAuthorityModelEvent(next, applied.event, createPart)
        : applied
    if (!result.ok) return authorityFailure(result.diagnostic.code, result.diagnostic.message)
    if (result.snapshot.schemaVersion === 1)
      return authorityFailure(
        "invalid-event",
        "An authored transaction cannot discard authored authority.",
      )
    next = result.snapshot
    events.push(result.event)
    if (
      historyBase.schemaVersion !== next.schemaVersion &&
      next.schemaVersion !== 5 &&
      next.schemaVersion !== 6
    )
      historyBase = next
  }
  return {
    ok: true as const,
    snapshot: next,
    historyBase,
    events,
    transactionId: parsed.data.transactionId,
    assetBlobs: parsed.data.assetBlobs.map(({ digest, bytes }) => ({
      digest,
      bytes: Uint8Array.from(bytes),
    })),
  }
}
