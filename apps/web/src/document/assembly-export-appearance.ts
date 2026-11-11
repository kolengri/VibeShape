import { assemblySourceAppearances } from "@vibeshape/domain/assembly-bom"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import type { AssemblyExportSettings } from "@vibeshape/protocol"

/**
 * Frozen definitions keep no display data, so glTF/OBJ materials use the live appearance of each
 * part source captured at the same revision as the exported assembly.
 */
export function withAssemblySourceAppearances(
  settings: AssemblyExportSettings,
  authored: DocumentAuthoritySnapshot | null | undefined,
  authority: DocumentSnapshotV4,
): AssemblyExportSettings {
  if ((settings.format !== "glb" && settings.format !== "obj") || !authored) return settings
  if (!("partAppearances" in authored)) return settings
  const sourceAppearances = assemblySourceAppearances(authority.assembly, authored.partAppearances)
  return sourceAppearances.length
    ? { ...settings, sourceAppearances: sourceAppearances.map((entry) => ({ ...entry })) }
    : settings
}
