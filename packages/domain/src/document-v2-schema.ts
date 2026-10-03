import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import { type DocumentSnapshotV1, documentSnapshotV1Schema } from "./document"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { type HistoryFolder, historyFoldersSchema, validateHistoryFolders } from "./history-folders"
import { validatePartBindings } from "./part-bindings"
import { type PartRecord, partRecordsSchema } from "./parts"

function validateCanonicalModel(snapshot: DocumentSnapshotV1, context: z.RefinementCtx) {
  for (const [index, feature] of snapshot.features.entries()) {
    const projection = projectFirstPartyFeatureSemanticInputs(feature)
    if (!projection.recognized) continue
    if (
      !projection.ok ||
      canonicalJson(projection.inputs) !== canonicalJson(feature.semanticInputs)
    )
      context.addIssue({
        code: "custom",
        path: ["features", index, "semanticInputs"],
        message: "First-party semantic inputs must match their canonical feature declaration.",
      })
  }
}

// Keep the V1 refinement as the sole owner of the canonical history/dependency contract.
export const documentSnapshotV2Schema = z
  .object({
    ...documentSnapshotV1Schema.shape,
    schemaVersion: z.literal(2),
    parts: partRecordsSchema,
    folders: historyFoldersSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { parts, folders, ...model } = snapshot
    const v1 = documentSnapshotV1Schema.safeParse({ ...model, schemaVersion: 1 })
    if (!v1.success)
      for (const issue of v1.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (v1.success) validateCanonicalModel(v1.data, context)
    const folderIssue = validateHistoryFolders(folders, snapshot.history)
    if (folderIssue) context.addIssue({ code: "custom", path: ["folders"], message: folderIssue })
    const bindingIssue = validatePartBindings(parts, snapshot)
    if (bindingIssue) context.addIssue({ code: "custom", path: ["parts"], message: bindingIssue })
  })
export type DocumentSnapshotV2 = Readonly<
  Omit<DocumentSnapshotV1, "schemaVersion"> & {
    schemaVersion: 2
    parts: readonly PartRecord[]
    folders: readonly HistoryFolder[]
  }
>

/** Projection is read-only compatibility data; it must never replace V2 authority. */
export function projectDocumentSnapshotV2ToV1(snapshot: DocumentSnapshotV2): DocumentSnapshotV1 {
  const { parts: _parts, folders: _folders, ...model } = documentSnapshotV2Schema.parse(snapshot)
  return documentSnapshotV1Schema.parse({ ...model, schemaVersion: 1 })
}

export { type PartRootRequirement, requiredPartAllocations } from "./part-bindings"
