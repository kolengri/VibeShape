import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  importUploadInspectionSchema,
} from "@vibeshape/automation-api/imports"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { context, id, inspection, meshInspection } from "../features/import/import-test-fixtures"
import type { ImportReviewInput } from "./import-upload-session"

export function importReviewFixture(mesh = false): ImportReviewInput {
  return {
    kind: "import",
    actor: commandActorSchema.parse({
      type: "mcp",
      clientId: "org.example.import",
      sessionId: id(90),
    }),
    draft: {
      draftId: id(100),
      documentId: context.documentId,
      baseRevision: context.revision,
      draftVersion: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    label: "Captured source",
    inspection: structuredClone(mesh ? meshInspection : inspection),
    source: importUploadInspectionSchema.parse({
      upload: {
        uploadId: id(100),
        documentId: context.documentId,
        baseRevision: context.revision,
        uploadVersion: 2,
        filename: mesh ? "source.stl" : "source.step",
        byteLength: 3,
        sourceUnit: "millimeter",
        format: mesh ? "stl" : "step",
        receivedBytes: 3,
        sha256: "a".repeat(64),
        status: "ready",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
      },
      featureId: id(110),
      representation: mesh ? "triangle-mesh" : "exact-solid",
      normalization: meshInspection.normalization,
      outputs: [
        {
          outputRole: `${mesh ? "mesh" : "import"}.${id(111)}`,
          bounds: { min: [0, 0, 0], max: [10, 10, 10] },
          volumeMm3: mesh ? null : 1000,
          surfaceAreaMm2: mesh ? 50 : 600,
          triangleCount: 1,
        },
      ],
      warnings: [],
    }),
    transaction: { transactionId: draftIdSchema.parse(id(100)), commands: [] },
  }
}
