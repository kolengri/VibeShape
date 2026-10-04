import { commandActorSchema } from "@vibeshape/domain/commands"
import type { ImportDocumentContext } from "../features/import/import-model"
import { inspectPlanarRequest } from "../features/planar-import/parser-service"
export const planarId = (n: number) => `0195b5ac-b250-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
export const planarActor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.planar-import",
  sessionId: planarId(90),
})
export const planarContext: ImportDocumentContext = {
  documentId: planarId(1),
  revision: 4,
  authorityVersion: 4,
  historyAfter: null,
}
export const planarSvg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 2 3 L 22 3 L 22 13 L 2 13 Z"/></svg>'
export const planarDxf =
  "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nCUT\n10\n1\n20\n2\n40\n1\n0\nENDSEC\n0\nEOF\n"
export async function realPlanarInspection(source: {
  input: Parameters<typeof inspectPlanarRequest>[0]
}) {
  const result = await inspectPlanarRequest({ schemaVersion: 0, input: source.input })
  return result
}

export async function planarReviewFixture() {
  const inspection = await realPlanarInspection({
    input: {
      format: "svg",
      bytes: Uint8Array.from(new TextEncoder().encode(planarSvg)),
      units: "mm",
    },
  })
  if (!inspection.ok) throw new Error(inspection.diagnostic.message)
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  const { planarUploadInspectionSchema } = await import("@vibeshape/automation-api/planar-imports")
  const { draftIdSchema } = await import("@vibeshape/domain/identifiers")
  const { IMPORT_UPLOAD_CHUNK_MAX_BYTES } = await import("@vibeshape/automation-api/imports")
  return {
    kind: "planar-import" as const,
    actor: planarActor,
    draft: {
      draftId: planarId(100),
      documentId: planarContext.documentId,
      baseRevision: planarContext.revision,
      draftVersion: 2,
      expiresAt,
    },
    label: "Captured outline",
    inspection,
    source: planarUploadInspectionSchema.parse({
      upload: {
        uploadId: planarId(100),
        documentId: planarContext.documentId,
        baseRevision: planarContext.revision,
        uploadVersion: 2,
        filename: "source.svg",
        byteLength: 3,
        receivedBytes: 3,
        unit: "mm",
        plane: "xz",
        format: "svg",
        sha256: "a".repeat(64),
        status: "ready",
        expiresAt,
        chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
      },
      sketchId: planarId(110),
      normalization: {
        sourceUnit: "millimeter",
        scaleToMillimeters: 1,
        normalizedUnit: "millimeter",
      },
      unitPolicy: "selected",
      bounds: inspection.bounds,
      pathOutputs: [planarId(111)],
      closedPaths: 1,
      curves: 4,
    }),
    transaction: { transactionId: draftIdSchema.parse(planarId(100)), commands: [] },
  }
}
