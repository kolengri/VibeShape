import { bodyReferenceSchema } from "@vibeshape/domain/body-reference"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { documentV2MetadataChangeSchema } from "@vibeshape/domain/document-v2-command-schemas"
import {
  commandIdSchema,
  documentIdSchema,
  featureIdSchema,
  historyFolderIdSchema,
  partIdSchema,
  revisionSchema,
} from "@vibeshape/domain/identifiers"
import { authoredItemNameSchema, partOriginSchema } from "@vibeshape/domain/parts"
import { z } from "zod"
import { serializedQueryBytes } from "./query-byte-budget"

export const authoredListArgumentsSchema = z
  .object({
    revision: revisionSchema,
    cursor: z.number().int().min(0).max(4096).nullable().default(null),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict()
export const authoredHistoryListArgumentsSchema = authoredListArgumentsSchema
  .extend({
    cursor: z.number().int().min(0).max(100256).nullable().default(null),
  })
  .strict()
export const metadataChangeArgumentsSchema = z
  .object({
    baseRevision: revisionSchema,
    commandId: commandIdSchema,
    change: documentV2MetadataChangeSchema,
  })
  .strict()
export type MetadataChangeArguments = z.infer<typeof metadataChangeArgumentsSchema>

const listEnvelope = {
  documentId: documentIdSchema,
  revision: revisionSchema,
  total: z.number().int().min(0).max(4096),
  nextCursor: z.number().int().min(0).max(4096).nullable(),
}
export const authoredPartsViewSchema = z
  .object({
    ...listEnvelope,
    parts: z
      .array(
        z
          .object({
            id: partIdSchema,
            name: authoredItemNameSchema,
            visible: z.boolean(),
            origin: partOriginSchema,
            body: bodyReferenceSchema,
            consumedBy: featureIdSchema.nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
export const authoredFoldersViewSchema = z
  .object({
    ...listEnvelope,
    folders: z
      .array(
        z
          .object({
            id: historyFolderIdSchema,
            name: authoredItemNameSchema,
            first: historyItemRefSchema,
            last: historyItemRefSchema,
            itemCount: z.number().int().min(1).max(100256),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
export const authoredHistoryViewSchema = z
  .object({
    documentId: documentIdSchema,
    revision: revisionSchema,
    total: z.number().int().min(0).max(100256),
    nextCursor: z.number().int().min(0).max(100256).nullable(),
    items: z
      .array(
        z
          .object({ ref: historyItemRefSchema, label: z.string().min(1).max(120).nullable() })
          .strict(),
      )
      .max(200),
  })
  .strict()
export const metadataCommitViewSchema = z
  .object({
    documentId: documentIdSchema,
    commandId: commandIdSchema,
    baseRevision: revisionSchema,
    revision: revisionSchema,
    change: documentV2MetadataChangeSchema,
  })
  .strict()

/** Metadata reads are bounded and belong to the exact paired document revision. */
export function readAuthoredMetadata(
  snapshot: AuthoredDocumentSnapshot,
  kind: "parts" | "folders" | "history",
  input: unknown,
) {
  const parsed = (
    kind === "history" ? authoredHistoryListArgumentsSchema : authoredListArgumentsSchema
  ).safeParse(input)
  if (!parsed.success)
    return {
      ok: false as const,
      diagnostic: {
        code: "invalid-query",
        message: "The metadata query is invalid.",
        retryable: false,
      },
    }
  if (parsed.data.revision !== snapshot.revision)
    return {
      ok: false as const,
      diagnostic: {
        code: "stale-revision",
        message: "Read the current document revision before listing metadata.",
        retryable: true,
      },
    }
  const { cursor, limit } = parsed.data
  const start = cursor ?? 0
  const collection =
    kind === "parts" ? snapshot.parts : kind === "folders" ? snapshot.folders : snapshot.history
  if (start > collection.length)
    return {
      ok: false as const,
      diagnostic: {
        code: "invalid-cursor",
        message: "The metadata cursor is outside the current document.",
        retryable: false,
      },
    }
  const end = Math.min(start + limit, collection.length)
  const envelope = {
    documentId: snapshot.id,
    revision: snapshot.revision,
    total: collection.length,
    nextCursor: end < collection.length ? end : null,
  }
  const value =
    kind === "parts"
      ? authoredPartsViewSchema.parse({
          ...envelope,
          parts: snapshot.parts
            .slice(start, end)
            .map(({ id, name, visible, origin, consumedBy, bodyHistory }) => ({
              id,
              name,
              visible,
              origin,
              consumedBy,
              body: bodyHistory.at(-1),
            })),
        })
      : kind === "folders"
        ? authoredFoldersViewSchema.parse({
            ...envelope,
            folders: snapshot.folders.slice(start, end).map(({ id, name, items }) => ({
              id,
              name,
              first: items[0],
              last: items.at(-1),
              itemCount: items.length,
            })),
          })
        : authoredHistoryViewSchema.parse({
            ...envelope,
            items: snapshot.history.slice(start, end).map((ref) => ({
              ref,
              label:
                (ref.kind === "feature" ? snapshot.features : snapshot.sketches).find(
                  (entry) => entry.id === ref.id,
                )?.label ?? null,
            })),
          })
  if (serializedQueryBytes({ ok: true, value }) > 128 * 1024)
    return {
      ok: false as const,
      diagnostic: {
        code: "query-result-too-large",
        message: "Reduce the metadata page limit to fit the response budget.",
        retryable: false,
      },
    }
  return { ok: true as const, value }
}
