import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  importUploadCommitSchema,
  importUploadDescriptorSchema,
  importUploadInspectionSchema,
} from "@vibeshape/automation-api/imports"
import { lightweightingSourceIdentitySchema } from "@vibeshape/automation-api/lightweighting-tools"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import { createLightweightingProposalCoordinator } from "@vibeshape/automation-host/lightweighting-proposal"
import {
  optimizeStructuralModel,
  StructuralOptimizationError,
} from "@vibeshape/structural-optimization/client"
import { encodeStructuralStl } from "@vibeshape/structural-optimization/mesh"
import {
  type LightweightingSource,
  sameLightweightingSource,
} from "../features/lightweighting/lightweighting-model"
import { createImportAutomationSession } from "./import-automation-session"
import type { ImportReviewInput, ImportSessionConfiguration } from "./import-upload-session"

/** A separate private import session prevents external upload tools replacing a computed candidate. */
export function createBrowserLightweightingAutomationSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review"> & {
    readSource: (partId: string) => LightweightingSource | null
  },
) {
  let captured: LightweightingSource | null = null
  let reviewEvidence: ImportReviewInput["lightweighting"]
  const imports = createImportAutomationSession({
    ...configuration,
    isActive: () =>
      configuration.isActive() &&
      (!captured || sameLightweightingSource(configuration.readSource(captured.partId), captured)),
    reviewContext: () => reviewEvidence,
  })
  const coordinator = createLightweightingProposalCoordinator({
    describeFailure(error) {
      return error instanceof StructuralOptimizationError
        ? localFailure(error.code, error.message, true)
        : null
    },
    createCancellation() {
      const controller = new AbortController()
      return { signal: controller.signal, abort: () => controller.abort() }
    },
    observeCancellation(signal, cancel) {
      signal?.addEventListener("abort", cancel, { once: true })
      return () => signal?.removeEventListener("abort", cancel)
    },
    documentId: configuration.documentId,
    isActive: configuration.isActive,
    readSource(identity) {
      const source = configuration.readSource(identity.partId)
      return source
        ? {
            ...source,
            documentId: source.context.documentId,
            revision: source.context.revision,
            identity: lightweightingSourceIdentitySchema.parse({
              partId: source.partId,
              featureId: source.featureId,
              outputRole: source.outputRole,
              contentHash: source.contentHash,
            }),
          }
        : null
    },
    async optimize(source, settings, signal) {
      const result = await optimizeStructuralModel(
        {
          schemaVersion: 1,
          mesh: {
            vertices: Array.from(source.body.mesh.positions),
            indices: Array.from(source.body.mesh.indices),
          },
          ...settings,
        },
        { signal },
      )
      const { mesh, ...summary } = result
      return { summary, payload: mesh }
    },
    async requestSnapshot(actor, source, settings, summary, mesh, label, signal) {
      captured = source
      reviewEvidence = { sourceName: source.partName, source: source.identity, settings, summary }
      try {
        const bytes = encodeStructuralStl(mesh, settings.cellSizeMm)
        const begun = await imports.execute(
          actor,
          {
            tool: "begin_import_upload",
            arguments: {
              revision: source.revision,
              filename: "lightweighted-snapshot.stl",
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
        reviewEvidence = undefined
      }
    },
    cancelSnapshot: () => imports.cancel(),
  })
  return {
    execute: coordinator.execute,
    cancel: () => coordinator.cancel(),
    dispose() {
      coordinator.dispose()
      imports.dispose()
    },
  }
}
