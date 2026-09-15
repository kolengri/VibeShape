import { z } from "zod"
import { sha256Schema } from "./feature-content-identity"
import {
  documentIdSchema,
  featureIdSchema,
  revisionSchema,
  technicalIdentifierSchema,
} from "./identifiers"

const finiteCoordinateSchema = z.number().finite()
const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe()

const boundsSchema = z
  .object({
    min: z.tuple([finiteCoordinateSchema, finiteCoordinateSchema, finiteCoordinateSchema]),
    max: z.tuple([finiteCoordinateSchema, finiteCoordinateSchema, finiteCoordinateSchema]),
  })
  .strict()
  .superRefine((bounds, context) => {
    const pairs: readonly [number, number, number][] = [
      [bounds.min[0], bounds.max[0], 0],
      [bounds.min[1], bounds.max[1], 1],
      [bounds.min[2], bounds.max[2], 2],
    ]
    for (const [min, max, index] of pairs) {
      if (min <= max) continue
      context.addIssue({ code: "custom", path: ["min", index], message: "Bounds must be ordered." })
    }
  })

const succeededEntrySchema = z
  .object({
    featureId: featureIdSchema,
    status: z.literal("succeeded"),
    contentHash: sha256Schema,
    shape: z
      .object({
        valid: z.literal(true),
        volume: z.number().finite().nonnegative(),
        surfaceArea: z.number().finite().nonnegative(),
        bounds: boundsSchema,
        solidCount: nonnegativeSafeIntegerSchema,
        faceCount: nonnegativeSafeIntegerSchema,
        edgeCount: nonnegativeSafeIntegerSchema,
      })
      .strict(),
  })
  .strict()

const failedEntrySchema = z
  .object({
    featureId: featureIdSchema,
    status: z.literal("failed"),
    diagnosticCodes: z.array(technicalIdentifierSchema).min(1).max(32),
  })
  .strict()

const blockedEntrySchema = z
  .object({
    featureId: featureIdSchema,
    status: z.literal("blocked"),
    blockedBy: z.array(featureIdSchema).min(1).max(32),
  })
  .strict()

const suppressedEntrySchema = z
  .object({ featureId: featureIdSchema, status: z.literal("suppressed") })
  .strict()

export const modelMeasurementEntrySchema = z.discriminatedUnion("status", [
  succeededEntrySchema,
  failedEntrySchema,
  blockedEntrySchema,
  suppressedEntrySchema,
])

export type ModelMeasurementEntry = Readonly<z.infer<typeof modelMeasurementEntrySchema>>

export const modelMeasurementEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: documentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
    features: z.array(modelMeasurementEntrySchema).max(100_000),
  })
  .strict()
  .superRefine((evidence, context) => {
    const ids = new Set<string>()
    for (const [index, entry] of evidence.features.entries()) {
      if (ids.has(entry.featureId)) {
        context.addIssue({
          code: "custom",
          path: ["features", index, "featureId"],
          message: "Feature IDs must be unique.",
        })
      }
      ids.add(entry.featureId)
    }
  })

export type ModelMeasurementEvidence = Readonly<z.infer<typeof modelMeasurementEvidenceSchema>>
