import {
  type AssemblyDraftState,
  type AssemblyOperation,
  assemblyDraftStateSchema,
} from "@vibeshape/automation-api/assembly-tools"
import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import {
  applyCapturedAssemblyMutations,
  captureAssemblyMutations,
} from "@vibeshape/domain/assembly-authority"
import { mergeCapturedAssemblyAssets } from "@vibeshape/domain/assembly-pinned-insertion"
import type { CommandActor } from "@vibeshape/domain/commands"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import { documentSnapshotV4Schema, promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import type { SourceAssetBlob } from "@vibeshape/domain/source-assets"
import { ASSEMBLY_DRAFT_TTL_MS } from "./assembly-session-contract"

export type AssemblyDraftRecord = {
  state: AssemblyDraftState
  actor: CommandActor
  snapshot: Exclude<DocumentAuthoritySnapshot, { schemaVersion: 1 }>
  changes: readonly AssemblyMutation[]
  blobs: readonly SourceAssetBlob[]
}
export function draftAssemblyAuthority(record: AssemblyDraftRecord) {
  const snapshot = promoteDocumentSnapshotV4(record.snapshot)
  if (!record.changes.length) return snapshot
  const captured = captureAssemblyMutations(snapshot, snapshot.assembly, record.changes)
  return documentSnapshotV4Schema.parse({
    ...snapshot,
    assets: mergeCapturedAssemblyAssets(snapshot, captured),
    assembly: applyCapturedAssemblyMutations(snapshot.assembly, captured),
  })
}
export function renewedDraft(record: AssemblyDraftRecord, now: number) {
  return assemblyDraftStateSchema.parse({
    ...record.state,
    expiresAt: new Date(now + ASSEMBLY_DRAFT_TTL_MS).toISOString(),
  })
}
export function mergeOwnedBlobs(
  previous: readonly SourceAssetBlob[],
  additions: readonly SourceAssetBlob[],
): readonly SourceAssetBlob[] {
  const unique = new Map(previous.map((blob) => [blob.digest, blob]))
  for (const blob of additions) {
    const existing = unique.get(blob.digest)
    if (
      existing &&
      (existing.bytes.length !== blob.bytes.length ||
        !existing.bytes.every((value, index) => value === blob.bytes[index]))
    )
      throw new Error("One frozen source digest cannot carry conflicting bytes.")
    unique.set(blob.digest, { digest: blob.digest, bytes: Uint8Array.from(blob.bytes) })
  }
  if (
    unique.size > 128 ||
    [...unique.values()].reduce((total, blob) => total + blob.bytes.byteLength, 0) >
      64 * 1024 * 1024
  )
    throw new Error("The draft source closure exceeds its byte budget.")
  return [...unique.values()]
}
export function namedAssemblyMutation(operation: AssemblyOperation): AssemblyMutation | null {
  switch (operation.tool) {
    case "upgrade_assembly":
      return { kind: "assembly.upgrade" }
    case "create_assembly_definition":
      return { kind: "definition.create", definition: operation.arguments.definition }
    case "update_assembly_definition": {
      const { definitionId, name, sourceFrame } = operation.arguments
      return {
        kind: "definition.update",
        definitionId,
        ...(name === undefined ? {} : { name }),
        ...(sourceFrame === undefined ? {} : { sourceFrame }),
      }
    }
    case "relink_assembly_definition":
      return { kind: "definition.relink", definition: operation.arguments.definition }
    case "remove_assembly_definition":
      return {
        kind: "definition.remove",
        definitionId: operation.arguments.definitionId,
        cascade: operation.arguments.cascade,
      }
    case "create_assembly_instance":
      return { kind: "instance.create", instance: operation.arguments.instance }
    case "update_assembly_instance":
      return { kind: "instance.update", instance: operation.arguments.instance }
    case "remove_assembly_instance":
      return {
        kind: "instance.remove",
        instanceId: operation.arguments.instanceId,
        cascade: operation.arguments.cascade,
      }
    case "create_assembly_joint":
      return { kind: "joint.create", joint: operation.arguments.joint }
    case "update_assembly_joint":
      return { kind: "joint.update", joint: operation.arguments.joint }
    case "remove_assembly_joint":
      return { kind: "joint.remove", jointId: operation.arguments.jointId }
    default:
      return null
  }
}
