import { z } from "zod"
import {
  type AssemblyAuthority,
  assemblyAuthoritySchema,
  emptyAssemblyAuthority,
  validateAssemblySourcePins,
} from "./assembly-authority"
import { type DocumentSnapshotV2, documentSnapshotV2Schema } from "./document-v2-schema"
import { type DocumentSnapshotV3, documentSnapshotV3Schema } from "./document-v3-schema"
import type { DocumentSnapshotV5 } from "./document-v5"
import type { DocumentSnapshotV6 } from "./document-v6"
import { validateImportedFeatureAssets } from "./part-design-import"
import { validateSketchSourceImportAssets } from "./sketch-source-import"
import { type SourceAsset, sourceAssetsSchema } from "./source-assets"

/** Source descriptors are authority; their verified bytes live outside the semantic snapshot. */
export const documentSnapshotV4Schema = z
  .object({
    ...documentSnapshotV3Schema.shape,
    schemaVersion: z.literal(4),
    assets: sourceAssetsSchema,
    assembly: assemblyAuthoritySchema.default(emptyAssemblyAuthority),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { assets: _assets, assembly: _assembly, ...model } = snapshot
    const v2 = documentSnapshotV3Schema.safeParse({ ...model, schemaVersion: 3 })
    if (!v2.success)
      for (const issue of v2.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    const sourceIssue = validateImportedFeatureAssets(snapshot)
    if (sourceIssue) context.addIssue({ code: "custom", path: ["features"], message: sourceIssue })
    const sketchSourceIssue = validateSketchSourceImportAssets(snapshot)
    if (sketchSourceIssue)
      context.addIssue({ code: "custom", path: ["sketches"], message: sketchSourceIssue })
    const assemblyIssue = validateAssemblySourcePins(snapshot.assembly, snapshot.assets)
    if (assemblyIssue)
      context.addIssue({ code: "custom", path: ["assembly"], message: assemblyIssue })
  })
export type DocumentSnapshotV4 = Readonly<
  Omit<DocumentSnapshotV3, "schemaVersion"> & {
    schemaVersion: 4
    assets: readonly SourceAsset[]
    assembly: AssemblyAuthority
  }
>

/** Disposable previews may promote older authority; persistence still requires ordinary upgrade events. */
export function promoteDocumentSnapshotV4(
  snapshot:
    | DocumentSnapshotV2
    | DocumentSnapshotV3
    | DocumentSnapshotV4
    | DocumentSnapshotV5
    | DocumentSnapshotV6,
): DocumentSnapshotV4 {
  if (snapshot.schemaVersion === 6) {
    const { partAppearances: _appearances, ...previous } = snapshot
    return promoteDocumentSnapshotV4({ ...previous, schemaVersion: 5 })
  }
  if (snapshot.schemaVersion === 5) {
    const { repairIntents: _repairIntents, suspendedParts: _suspendedParts, ...active } = snapshot
    return documentSnapshotV4Schema.parse({ ...active, schemaVersion: 4 })
  }
  return documentSnapshotV4Schema.parse({
    ...snapshot,
    schemaVersion: 4,
    surfaceTextures: snapshot.schemaVersion === 2 ? [] : snapshot.surfaceTextures,
    assets: snapshot.schemaVersion === 4 ? snapshot.assets : [],
    assembly: snapshot.schemaVersion === 4 ? snapshot.assembly : emptyAssemblyAuthority(),
  })
}

/** Compatibility projection cannot replace V4 persisted authority. */
export function projectDocumentSnapshotV4ToV3(snapshot: DocumentSnapshotV4): DocumentSnapshotV3 {
  const {
    assets: _assets,
    assembly: _assembly,
    ...model
  } = documentSnapshotV4Schema.parse(snapshot)
  return documentSnapshotV3Schema.parse({ ...model, schemaVersion: 3 })
}
export function projectDocumentSnapshotV4ToV2(snapshot: DocumentSnapshotV4) {
  const { surfaceTextures: _textures, ...model } = projectDocumentSnapshotV4ToV3(snapshot)
  return documentSnapshotV2Schema.parse({ ...model, schemaVersion: 2 })
}
