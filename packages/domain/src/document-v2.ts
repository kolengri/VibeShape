import { z } from "zod"
import { canonicalJson } from "./canonical-json"
import {
  type DocumentSnapshotV1,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "./document"
import { projectFirstPartyFeatureSemanticInputs } from "./feature-semantic-inputs"
import { type HistoryFolder, historyFoldersSchema, validateHistoryFolders } from "./history-folders"
import { validatePartBindings } from "./part-bindings"
import { type PartRecord, partRecordsSchema } from "./parts"
import { type SurfaceTextureLayer, surfaceTextureLayersSchema } from "./surface-textures"

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

export const documentSnapshotV3Schema = z
  .object({
    ...documentSnapshotV2Schema.shape,
    schemaVersion: z.literal(3),
    surfaceTextures: surfaceTextureLayersSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { surfaceTextures, ...model } = snapshot
    const v2 = documentSnapshotV2Schema.safeParse({ ...model, schemaVersion: 2 })
    if (!v2.success)
      for (const issue of v2.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    const features = new Set(snapshot.features.map((feature) => feature.id))
    for (const [index, layer] of surfaceTextures.entries())
      if (!features.has(layer.featureId))
        context.addIssue({
          code: "custom",
          path: ["surfaceTextures", index, "featureId"],
          message: "Texture layers require an existing producing feature.",
        })
  })
export type DocumentSnapshotV3 = Readonly<
  Omit<DocumentSnapshotV2, "schemaVersion"> & {
    schemaVersion: 3
    surfaceTextures: readonly SurfaceTextureLayer[]
  }
>
export type AuthoredDocumentSnapshot = DocumentSnapshotV2 | DocumentSnapshotV3
export const authoredDocumentSnapshotSchema = z.union([
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
])

/** Additive boundary for callers adopting V2; the historical V0/V1 API remains frozen. */
export const documentAuthorityV2SnapshotSchema = z.union([
  documentSnapshotV1Schema,
  documentSnapshotV2Schema,
])
export type DocumentAuthorityV2Snapshot = DocumentSnapshotV1 | DocumentSnapshotV2
export const documentAuthoritySnapshotSchema = z.union([
  documentAuthorityV2SnapshotSchema,
  documentSnapshotV3Schema,
])
export type DocumentAuthoritySnapshot = DocumentSnapshotV1 | AuthoredDocumentSnapshot
export const portableDocumentSnapshotSchema = z.union([
  documentSnapshotSchema,
  documentSnapshotV1Schema,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
])

/** Projection is read-only compatibility data; it must never replace V2 authority. */
export function projectDocumentSnapshotV2ToV1(snapshot: DocumentSnapshotV2): DocumentSnapshotV1 {
  const { parts: _parts, folders: _folders, ...model } = documentSnapshotV2Schema.parse(snapshot)
  return documentSnapshotV1Schema.parse({ ...model, schemaVersion: 1 })
}

export function projectDocumentSnapshotV3ToV2(snapshot: DocumentSnapshotV3): DocumentSnapshotV2 {
  const { surfaceTextures: _textures, ...model } = documentSnapshotV3Schema.parse(snapshot)
  return documentSnapshotV2Schema.parse({ ...model, schemaVersion: 2 })
}

export function projectAuthoredDocumentSnapshotToV1(
  snapshot: AuthoredDocumentSnapshot,
): DocumentSnapshotV1 {
  return projectDocumentSnapshotV2ToV1(
    snapshot.schemaVersion === 3 ? projectDocumentSnapshotV3ToV2(snapshot) : snapshot,
  )
}

export { type PartRootRequirement, requiredPartAllocations } from "./part-bindings"
