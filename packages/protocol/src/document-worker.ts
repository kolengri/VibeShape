import { z } from "zod"
import {
  featureEvaluationEngineResultSchema,
  featureMeshPolicySchema,
  geometryExportFormatSchema,
  geometryProgressStageSchema,
  sha256Schema,
} from "./geometry-worker"
import {
  sketchDragTargetWireSchema,
  sketchSolveContinuationWireSchema,
  sketchWireIdSchema,
  sketchWireRecordSchema,
  solvedSketchWireSchema,
} from "./sketch"

export const DOCUMENT_PROTOCOL_VERSION = 4 as const

const MAX_FEATURES = 100_000
const MAX_SKETCHES = 256
const MAX_VARIABLES = 4_096
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reverseDnsPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const featureIdSchema = z.string().regex(uuidV7Pattern)
const variableIdSchema = z.string().regex(uuidV7Pattern)
export const documentWorkerDocumentIdSchema = z.string().regex(uuidV7Pattern)
const revisionSchema = z.number().int().nonnegative().safe()
const identifierSchema = z.string().trim().min(1).max(128)
const technicalIdentifierSchema = z.string().min(3).max(128).regex(reverseDnsPattern)
const featureTypeSchema = z
  .object({
    moduleId: technicalIdentifierSchema,
    moduleVersion: z.string().regex(semverPattern),
    typeId: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
  })
  .strict()

const documentVariableSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: variableIdSchema,
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    expression: z
      .string()
      .min(1)
      .max(256)
      .refine((expression) => expression.trim() === expression),
  })
  .strict()

const featureParametersSchema = z
  .record(z.string().min(1).max(128), z.json())
  .refine((parameters) => Object.keys(parameters).length <= 512)
  .refine((parameters) => JSON.stringify(parameters).length <= 1024 * 1024)

const documentFeatureSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: featureIdSchema,
    type: featureTypeSchema,
    parameters: featureParametersSchema,
    dependencies: z.array(featureIdSchema).max(1_024),
    references: z.array(z.json()).max(4_096),
    suppressed: z.boolean(),
    label: z.string().min(1).max(120).optional(),
  })
  .strict()

export const documentRebuildSnapshotSchema = z
  .object({
    schemaVersion: z.literal(0),
    id: documentWorkerDocumentIdSchema,
    revision: revisionSchema,
    name: z.string().min(1).max(120),
    variables: z.array(documentVariableSchema).max(MAX_VARIABLES).default([]),
    sketches: z.array(sketchWireRecordSchema).max(MAX_SKETCHES).default([]),
    features: z.array(documentFeatureSchema).max(MAX_FEATURES),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((document) => JSON.stringify(document).length <= 32 * 1024 * 1024)

const requestEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(DOCUMENT_PROTOCOL_VERSION),
    requestId: identifierSchema,
    documentId: documentWorkerDocumentIdSchema,
    revision: revisionSchema,
    generation: revisionSchema,
  })
  .strict()

const rebuildDocumentRequestSchema = requestEnvelopeSchema
  .extend({
    type: z.literal("rebuildDocument"),
    document: documentRebuildSnapshotSchema,
    mesh: featureMeshPolicySchema,
  })
  .superRefine((request, context) => {
    if (request.document.id !== request.documentId) {
      context.addIssue({
        code: "custom",
        path: ["document", "id"],
        message: "The document snapshot must match the request document.",
      })
    }
    if (request.document.revision !== request.revision) {
      context.addIssue({
        code: "custom",
        path: ["document", "revision"],
        message: "The document snapshot must match the request revision.",
      })
    }
  })

const disposeDocumentRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("disposeDocument"),
})

const healthCheckRequestSchema = requestEnvelopeSchema.extend({ type: z.literal("healthCheck") })

const exportDocumentRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("exportDocument"),
  format: geometryExportFormatSchema,
})

const solveSketchRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("solveSketch"),
  sketchId: sketchWireIdSchema,
  continuation: sketchSolveContinuationWireSchema.nullable().default(null),
  draggedPoints: z.array(sketchDragTargetWireSchema).max(128).default([]),
})

export const documentWorkerRequestSchema = z.discriminatedUnion("type", [
  rebuildDocumentRequestSchema,
  solveSketchRequestSchema,
  exportDocumentRequestSchema,
  disposeDocumentRequestSchema,
  healthCheckRequestSchema,
])

const featureDiagnosticSchema = z
  .object({
    code: technicalIdentifierSchema,
    values: z.record(z.string().min(1).max(128), z.json()),
  })
  .strict()

const featureEvaluationRecordSchema = z.discriminatedUnion("status", [
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("succeeded"),
      contentHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("failed"),
      diagnostics: z.array(featureDiagnosticSchema).min(1).max(32),
    })
    .strict(),
  z
    .object({
      featureId: featureIdSchema,
      status: z.literal("blocked"),
      blockedBy: z.array(featureIdSchema).min(1).max(32),
    })
    .strict(),
  z.object({ featureId: featureIdSchema, status: z.literal("suppressed") }).strict(),
])

export const documentFeatureEvaluationSchema = z
  .object({
    records: z.array(featureEvaluationRecordSchema).max(MAX_FEATURES),
    dirtyFeatureIds: z.array(featureIdSchema).max(MAX_FEATURES),
    evaluatedFeatureIds: z.array(featureIdSchema).max(MAX_FEATURES),
    reusedFeatureIds: z.array(featureIdSchema).max(MAX_FEATURES),
  })
  .strict()

export const documentFeatureGeometrySchema = z
  .object({
    featureId: featureIdSchema,
    contentHash: sha256Schema,
    meshPolicy: featureMeshPolicySchema,
    geometry: featureEvaluationEngineResultSchema,
  })
  .strict()

const responseEnvelopeSchema = requestEnvelopeSchema

const progressResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("progress"),
  featureId: featureIdSchema,
  stage: geometryProgressStageSchema,
  fraction: z.number().finite().min(0).max(1),
})

const documentRebuiltResponseSchema = responseEnvelopeSchema
  .extend({
    type: z.literal("documentRebuilt"),
    evaluation: documentFeatureEvaluationSchema,
    geometry: z.array(documentFeatureGeometrySchema).max(MAX_FEATURES),
  })
  .superRefine((response, context) => {
    const recordIds = new Set<string>()
    const successfulHashes = new Map<string, string>()
    for (const [index, record] of response.evaluation.records.entries()) {
      if (recordIds.has(record.featureId)) {
        context.addIssue({
          code: "custom",
          path: ["evaluation", "records", index, "featureId"],
          message: "Evaluation feature IDs must be unique.",
        })
      }
      recordIds.add(record.featureId)
      if (record.status === "succeeded") successfulHashes.set(record.featureId, record.contentHash)
    }

    const geometryIds = new Set<string>()
    for (const [index, geometry] of response.geometry.entries()) {
      if (geometryIds.has(geometry.featureId)) {
        context.addIssue({
          code: "custom",
          path: ["geometry", index, "featureId"],
          message: "Geometry feature IDs must be unique.",
        })
      }
      geometryIds.add(geometry.featureId)
      if (successfulHashes.get(geometry.featureId) !== geometry.contentHash) {
        context.addIssue({
          code: "custom",
          path: ["geometry", index, "contentHash"],
          message: "Geometry must match a successful evaluation record and content hash.",
        })
      }
    }

    for (const featureId of successfulHashes.keys()) {
      if (!geometryIds.has(featureId)) {
        context.addIssue({
          code: "custom",
          path: ["geometry"],
          message: `Successful feature ${featureId} must include geometry.`,
        })
      }
    }
  })

const documentDisposedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("documentDisposed"),
  ownedShapeCount: revisionSchema,
})

const healthResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("health"),
  initialized: z.boolean(),
  activeDocuments: revisionSchema,
  ownedShapeCount: revisionSchema,
  wasmHeapBytes: revisionSchema,
})

const documentExportedResponseSchema = responseEnvelopeSchema
  .extend({
    type: z.literal("documentExported"),
    format: geometryExportFormatSchema,
    file: z.instanceof(Uint8Array),
    bodyCount: z.number().int().positive().safe(),
  })
  .superRefine((response, context) => {
    if (response.file.byteLength === 0) {
      context.addIssue({
        code: "custom",
        path: ["file"],
        message: "An exported document file must not be empty.",
      })
    }
  })

const sketchSolvedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("sketchSolved"),
  solution: solvedSketchWireSchema,
})

export const documentWorkerDiagnosticCodeSchema = z.enum([
  "invalid-request",
  "unsupported-protocol-version",
  "stale-generation",
  "engine-initialization-failed",
  "invalid-document-snapshot",
  "invalid-previous-feature-state",
  "invalid-rebuild-identity",
  "previous-document-mismatch",
  "future-previous-revision",
  "invalid-feature-content-environment",
  "invalid-feature-mesh-policy",
  "invalid-dirty-feature",
  "invalid-previous-feature-result",
  "export-state-unavailable",
  "no-exportable-bodies",
  "export-failed",
  "sketch-state-unavailable",
  "sketch-not-found",
  "sketch-solver-unavailable",
  "sketch-solve-invalid",
  "sketch-solve-failed",
  "internal-error",
])

const failureResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("failure"),
  diagnostic: z
    .object({
      code: documentWorkerDiagnosticCodeSchema,
      message: z.string().min(1).max(1_024),
      retryable: z.boolean(),
    })
    .strict(),
})

export const documentWorkerResponseSchema = z.discriminatedUnion("type", [
  progressResponseSchema,
  documentRebuiltResponseSchema,
  sketchSolvedResponseSchema,
  documentExportedResponseSchema,
  documentDisposedResponseSchema,
  healthResponseSchema,
  failureResponseSchema,
])

export type DocumentWorkerRequest = z.infer<typeof documentWorkerRequestSchema>
export type DocumentWorkerResponse = z.infer<typeof documentWorkerResponseSchema>
export type DocumentWorkerTerminalResponse = Exclude<DocumentWorkerResponse, { type: "progress" }>
export type DocumentWorkerDiagnosticCode = z.infer<typeof documentWorkerDiagnosticCodeSchema>
