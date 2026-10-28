import { importUploadCommitSchema } from "@vibeshape/automation-api/imports"
import { localFailure } from "@vibeshape/automation-api/local-tools"
import type { CommandActor } from "@vibeshape/domain/commands"
import { importFormat, readImportSource } from "../features/import/import-model"
import {
  type LightweightingSource,
  sameLightweightingSource,
} from "../features/lightweighting/lightweighting-model"
import { automationReviews } from "./automation-review-controller"
import { createImportAutomationSession } from "./import-automation-session"
import type { ImportReviewInput, ImportSessionConfiguration } from "./import-upload-session"

/** Local generated sources use the same capture, review and commit authority as public uploads. */
export function createBrowserLightweightingSnapshotSession(
  configuration: Omit<ImportSessionConfiguration, "inspect" | "review"> & {
    readSource: (partId: string) => LightweightingSource | null
  },
  reviews = automationReviews,
) {
  let captured: LightweightingSource | null = null
  let requesting = false
  let epoch = 0
  let evidence: Pick<ImportReviewInput, "lightweighting" | "quickLightweighting"> | undefined
  const imports = createImportAutomationSession(
    {
      ...configuration,
      isActive: () =>
        configuration.isActive() &&
        (!captured ||
          sameLightweightingSource(configuration.readSource(captured.partId), captured)),
      reviewContext: () => evidence,
    },
    reviews,
  )
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
      if (requesting) return localFailure("busy", "Another snapshot request is pending.", true)
      requesting = true
      const generation = epoch
      captured = source
      evidence = reviewEvidence
      try {
        const sourceUnit = importFormat(filename) === "3mf" ? null : "millimeter"
        const prepared = await readImportSource(
          {
            name: filename,
            size: bytes.byteLength,
            arrayBuffer: async () => Uint8Array.from(bytes).buffer,
          },
          sourceUnit,
        )
        if (signal.aborted || generation !== epoch)
          return localFailure("import-cancelled", "The snapshot request was cancelled.")
        const applied = await imports.requestPrepared(
          actor,
          {
            prepared,
            revision: source.context.revision,
            sourceUnit,
            label,
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
        requesting = false
      }
    },
    cancel() {
      epoch++
      imports.cancel()
    },
    dispose() {
      epoch++
      imports.dispose()
    },
  }
}
