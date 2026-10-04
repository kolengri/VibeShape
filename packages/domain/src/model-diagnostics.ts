import { z } from "zod"
import {
  documentIdSchema,
  featureIdSchema,
  revisionSchema,
  sketchExternalReferenceIdSchema,
  sketchIdSchema,
  technicalIdentifierSchema,
} from "./identifiers"

export const modelDiagnosticEntrySchema = z
  .object({
    entity: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("feature"), id: featureIdSchema }).strict(),
      z.object({ kind: z.literal("sketch"), id: sketchIdSchema }).strict(),
    ]),
    code: technicalIdentifierSchema,
    values: z.record(z.string().min(1).max(128), z.json()),
    blockedBy: z.array(featureIdSchema).min(1).max(32).optional(),
    supportFeatureId: featureIdSchema.optional(),
    referenceId: sketchExternalReferenceIdSchema.optional(),
    resolution: z.enum(["missing", "ambiguous", "unknown", "broken"]).optional(),
    action: z.enum([
      "inspect-feature",
      "repair-dependency",
      "reselect-support",
      "repair-reference",
    ]),
  })
  .strict()
export const modelDiagnosticsEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    status: z.enum(["valid", "invalid", "unknown"]),
    truncated: z.literal(false),
    entries: z.array(modelDiagnosticEntrySchema).max(100_000),
  })
  .strict()
  .refine(
    (view) =>
      view.status ===
      (view.entries.some((entry) => entry.resolution !== "unknown")
        ? "invalid"
        : view.entries.length
          ? "unknown"
          : "valid"),
    "Diagnostic status must describe every reported entry.",
  )
export type ModelDiagnosticsEvidence = z.infer<typeof modelDiagnosticsEvidenceSchema>
