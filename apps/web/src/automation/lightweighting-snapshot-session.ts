import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  importUploadCommitSchema,
  importUploadDescriptorSchema,
  importUploadInspectionSchema,
} from "@vibeshape/automation-api/imports"
import type { CommandActor } from "@vibeshape/domain/commands"
import {
  type LightweightingSource,
  sameLightweightingSource,
} from "../features/lightweighting/lightweighting-model"
import { createImportAutomationSession } from "./import-automation-session"
import type { ImportReviewInput, ImportSessionConfiguration } from "./import-upload-session"

/** Private uploads bind both lightweighting workflows to the same reviewed import authority. */
export function createBrowserLightweightingSnapshotSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review"> & {
    readSource: (partId: string) => LightweightingSource | null
  },
) {
  let captured: LightweightingSource | null = null
  let evidence: Pick<ImportReviewInput, "lightweighting" | "quickLightweighting"> | undefined
  const imports = createImportAutomationSession({
    ...configuration,
    isActive: () =>
      configuration.isActive() &&
      (!captured || sameLightweightingSource(configuration.readSource(captured.partId), captured)),
    reviewContext: () => evidence,
  })
  return {
    async request(
      actor: CommandActor,
      source: LightweightingSource,
      label: string,
      bytes: Uint8Array,
      filename: string,
      reviewEvidence: NonNullable<typeof evidence>,
      signal: AbortSignal,
    ) {
      captured = source
      evidence = reviewEvidence
      try {
        const begun = await imports.execute(
          actor,
          {
            tool: "begin_import_upload",
            arguments: {
              revision: source.context.revision,
              filename,
              byteLength: bytes.byteLength,
              sourceUnit: "millimeter",
              label,
            },
          },
          signal,
        )
        if (!begun.ok) return begun
        const descriptor = importUploadDescriptorSchema.parse(begun.value)
        for (let offset = 0; offset < bytes.byteLength; offset += IMPORT_UPLOAD_CHUNK_MAX_BYTES) {
          const chunk = bytes.subarray(
            offset,
            Math.min(bytes.byteLength, offset + IMPORT_UPLOAD_CHUNK_MAX_BYTES),
          )
          let binary = ""
          for (const byte of chunk) binary += String.fromCharCode(byte)
          const appended = await imports.execute(
            actor,
            {
              tool: "append_import_chunk",
              arguments: { uploadId: descriptor.uploadId, offset, base64: btoa(binary) },
            },
            signal,
          )
          if (!appended.ok) return appended
        }
        const inspected = await imports.execute(
          actor,
          { tool: "inspect_import_upload", arguments: { uploadId: descriptor.uploadId } },
          signal,
        )
        if (!inspected.ok) return inspected
        const view = importUploadInspectionSchema.parse(inspected.value)
        const applied = await imports.execute(
          actor,
          {
            tool: "commit_import_upload",
            arguments: { uploadId: descriptor.uploadId, uploadVersion: view.upload.uploadVersion },
          },
          signal,
        )
        return applied.ok
          ? { ok: true as const, value: importUploadCommitSchema.parse(applied.value) }
          : applied
      } finally {
        imports.cancel()
        captured = null
        evidence = undefined
      }
    },
    cancel: imports.cancel,
    dispose: imports.dispose,
  }
}
