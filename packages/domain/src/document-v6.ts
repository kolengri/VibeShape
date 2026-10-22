import { z } from "zod"
import { emptyAssemblyAuthority } from "./assembly-authority"
import type { DocumentSnapshotV2 } from "./document-v2-schema"
import type { DocumentSnapshotV3 } from "./document-v3-schema"
import type { DocumentSnapshotV4 } from "./document-v4"
import { type DocumentSnapshotV5, documentSnapshotV5Schema } from "./document-v5"
import { type PartAppearance, partAppearanceSchema } from "./part-appearance"

/** Appearance is authored PartId metadata, independent of transient feature/body presentation. */
export const documentSnapshotV6Schema = z
  .object({
    ...documentSnapshotV5Schema.shape,
    schemaVersion: z.literal(6),
    partAppearances: z.array(partAppearanceSchema).max(8_192),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { partAppearances, ...previous } = snapshot
    const parsed = documentSnapshotV5Schema.safeParse({ ...previous, schemaVersion: 5 })
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    const partIds = new Set([...snapshot.parts, ...snapshot.suspendedParts].map((part) => part.id))
    if (
      new Set(partAppearances.map((appearance) => appearance.partId)).size !==
        partAppearances.length ||
      partAppearances.some((appearance) => !partIds.has(appearance.partId))
    )
      context.addIssue({
        code: "custom",
        path: ["partAppearances"],
        message: "Each appearance must reference one distinct active or suspended authored part.",
      })
  })
export type DocumentSnapshotV6 = Readonly<
  Omit<DocumentSnapshotV5, "schemaVersion"> & {
    schemaVersion: 6
    partAppearances: readonly PartAppearance[]
  }
>

export function projectDocumentSnapshotV6ToV5(snapshot: DocumentSnapshotV6): DocumentSnapshotV5 {
  const { partAppearances: _appearances, ...previous } = documentSnapshotV6Schema.parse(snapshot)
  return documentSnapshotV5Schema.parse({ ...previous, schemaVersion: 5 })
}

/** A disposable lift; only a V6 event can establish saved V6 authority. */
export function promoteDocumentSnapshotV6(
  snapshot:
    | DocumentSnapshotV2
    | DocumentSnapshotV3
    | DocumentSnapshotV4
    | DocumentSnapshotV5
    | DocumentSnapshotV6,
): DocumentSnapshotV6 {
  if (snapshot.schemaVersion === 6) return snapshot
  return documentSnapshotV6Schema.parse({
    ...snapshot,
    schemaVersion: 6,
    partAppearances: [],
    repairIntents: snapshot.schemaVersion === 5 ? snapshot.repairIntents : [],
    suspendedParts: snapshot.schemaVersion === 5 ? snapshot.suspendedParts : [],
    surfaceTextures: snapshot.schemaVersion === 2 ? [] : snapshot.surfaceTextures,
    assets: snapshot.schemaVersion >= 4 && "assets" in snapshot ? snapshot.assets : [],
    assembly:
      snapshot.schemaVersion >= 4 && "assembly" in snapshot
        ? snapshot.assembly
        : emptyAssemblyAuthority(),
  })
}

export function validateAppearanceAuthorityBoundary(input: {
  seed: { schemaVersion: number; revision: number } | null
  versionedEvents: readonly { schemaVersion: number; revision: number }[]
  snapshot: { revision: number }
  repairUpgradeRevision: number
  appearanceUpgradeRevision: number
}) {
  const revision = input.appearanceUpgradeRevision
  return revision >= input.repairUpgradeRevision &&
    revision <= input.snapshot.revision &&
    (input.seed?.schemaVersion === 6
      ? revision <= input.seed.revision
      : input.versionedEvents.find((event) => event.schemaVersion === 6)?.revision === revision)
    ? null
    : "Appearance authority adoption does not match its journal."
}
