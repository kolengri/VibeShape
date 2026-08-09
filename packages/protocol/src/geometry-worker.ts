import { z } from "zod"

export const GEOMETRY_PROTOCOL_VERSION = 7 as const

const finiteNumberSchema = z.number().finite()
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reverseDnsPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const featureIdSchema = z
  .string()
  .regex(uuidV7Pattern, "Feature IDs must be lowercase UUIDv7 values.")
const technicalIdentifierSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(reverseDnsPattern, "Technical identifiers must use a lowercase dotted namespace.")
const moduleVersionSchema = z
  .string()
  .regex(semverPattern, "Module versions must be exact semantic versions.")
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 digest.")
const cadLengthSchema = finiteNumberSchema.min(0.001).max(100_000)
const cadCoordinateSchema = finiteNumberSchema.min(-100_000).max(100_000)
const meshToleranceSchema = finiteNumberSchema.min(0.001).max(10)
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()
const identifierSchema = z.string().trim().min(1).max(128)
const vector3Schema = z.tuple([cadCoordinateSchema, cadCoordinateSchema, cadCoordinateSchema])
const vector2Schema = z.tuple([cadCoordinateSchema, cadCoordinateSchema])
const positiveVector3Schema = z.tuple([cadLengthSchema, cadLengthSchema, cadLengthSchema])

export const boxFeatureContentParametersSchema = z
  .object({
    width: cadLengthSchema,
    depth: cadLengthSchema,
    height: cadLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const cylinderFeatureContentParametersSchema = z
  .object({
    radius: cadLengthSchema,
    height: cadLengthSchema,
    centered: z.boolean(),
  })
  .strict()

export const booleanFeatureContentParametersSchema = z
  .object({ operation: z.literal("subtract") })
  .strict()

const normalizedBuildVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim() === value, "Build versions must be normalized.")
const sourceRevisionSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "Source revisions must be exact lowercase hexadecimal identifiers.",
  )
  .nullable()

export const featureContentEnvironmentSchema = z
  .object({
    schemaVersion: z.literal(0),
    hostApiVersion: moduleVersionSchema,
    geometry: z
      .object({
        adapterId: technicalIdentifierSchema,
        adapterVersion: normalizedBuildVersionSchema,
        kernelId: technicalIdentifierSchema,
        kernelVersion: normalizedBuildVersionSchema,
        kernelSourceRevision: sourceRevisionSchema,
      })
      .strict(),
    modelingTolerancePolicyVersion: z.number().int().positive().safe(),
    provider: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("built-in") }).strict(),
      z
        .object({
          kind: z.literal("extension"),
          extensionId: technicalIdentifierSchema,
          extensionVersion: moduleVersionSchema,
          apiVersion: moduleVersionSchema,
          integrity: sha256Schema,
        })
        .strict(),
    ]),
  })
  .strict()

const featureTypeSchema = z
  .object({
    moduleId: technicalIdentifierSchema,
    moduleVersion: moduleVersionSchema,
    typeId: technicalIdentifierSchema,
    schemaVersion: z.number().int().positive().safe(),
  })
  .strict()

const featureContentParametersSchema = z
  .record(z.string().min(1).max(128), z.json())
  .refine(
    (parameters) => Object.keys(parameters).length <= 16,
    "Primitive content parameters are limited to 16 keys.",
  )
  .refine(
    (parameters) => JSON.stringify(parameters).length <= 64 * 1024,
    "Primitive content parameters exceed the encoded-size limit.",
  )

export const featureContentIdentitySchema = z
  .object({
    schemaVersion: z.literal(0),
    feature: z
      .object({
        schemaVersion: z.literal(0),
        type: featureTypeSchema,
        parameters: featureContentParametersSchema,
        inputs: z.array(sha256Schema).max(8),
        references: z.tuple([]),
      })
      .strict(),
    environment: featureContentEnvironmentSchema,
  })
  .strict()

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError("Canonical JSON accepts only JSON values.")
    return serialized
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`
}

export function serializeFeatureContentEnvironment(input: unknown) {
  return canonicalJson(featureContentEnvironmentSchema.parse(input))
}

export function serializeFeatureContentIdentity(input: unknown) {
  return canonicalJson(featureContentIdentitySchema.parse(input))
}

export const featureMeshPolicySchema = z
  .object({
    chordTolerance: meshToleranceSchema,
    angularTolerance: finiteNumberSchema.min(0.001).max(Math.PI),
  })
  .strict()

function isNormalized(vector: readonly number[]) {
  return Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

export const topologyKindSchema = z.enum(["vertex", "edge", "face"])
export const topologySignatureSchema = z
  .object({
    kind: topologyKindSchema,
    geometryClass: z.string().min(1).max(64),
    measure: finiteNumberSchema.nonnegative(),
    centroid: vector3Schema,
    bounds: z.object({ min: vector3Schema, max: vector3Schema }).strict(),
    direction: vector3Schema.optional(),
    directionMode: z.enum(["oriented", "axis"]).optional(),
    boundaryCount: nonNegativeIntegerSchema,
    adjacentGeometryClasses: z.array(z.string().min(1).max(64)).max(256),
  })
  .strict()
  .superRefine((signature, context) => {
    const hasDirection = signature.direction !== undefined
    if (hasDirection !== (signature.directionMode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Topology direction and direction mode must be provided together.",
      })
    }
    if (signature.direction && !isNormalized(signature.direction)) {
      context.addIssue({
        code: "custom",
        message: "Topology directions must be normalized.",
        path: ["direction"],
      })
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if ((signature.bounds.min[axis] as number) > (signature.bounds.max[axis] as number)) {
        context.addIssue({
          code: "custom",
          message: "Topology signature bounds must be ordered.",
          path: ["bounds"],
        })
        break
      }
    }
  })
export const topologyCandidateSchema = z
  .object({
    candidateId: identifierSchema,
    kind: topologyKindSchema,
    semanticRole: z.string().min(1).max(256).optional(),
    lineageTokens: z.array(z.string().min(1).max(256)).max(256),
    signature: topologySignatureSchema,
  })
  .strict()
  .refine((candidate) => candidate.kind === candidate.signature.kind, {
    message: "Topology candidate kind must match its signature kind.",
    path: ["signature", "kind"],
  })

export const geometryLifecycleOperationSchema = z.enum([
  "box",
  "cylinder",
  "boolean-cut",
  "occt-box",
  "occt-cylinder",
  "occt-native-box",
  "occt-native-cylinder",
])

const requestEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(GEOMETRY_PROTOCOL_VERSION),
    requestId: identifierSchema,
    documentId: identifierSchema,
    revision: nonNegativeIntegerSchema,
    generation: nonNegativeIntegerSchema,
  })
  .strict()

const responseEnvelopeSchema = requestEnvelopeSchema

export const kernelSpikeParametersSchema = z
  .object({
    boxSize: positiveVector3Schema,
    cylinderRadius: cadLengthSchema,
    cylinderHeight: cadLengthSchema,
    cylinderOrigin: vector3Schema,
    filletRadius: cadLengthSchema,
    meshTolerance: meshToleranceSchema,
    angularTolerance: finiteNumberSchema.min(0.001).max(Math.PI),
    lifecycleIterations: z.number().int().min(1).max(1_000),
    lifecycleOperation: geometryLifecycleOperationSchema.default("boolean-cut"),
    purgeAfterLifecycle: z.boolean().default(false),
  })
  .strict()
  .superRefine((parameters, context) => {
    const [boxLength, boxWidth, boxHeight] = parameters.boxSize
    const maximumFillet = Math.min(boxLength, boxWidth, boxHeight) / 2

    if (parameters.filletRadius >= maximumFillet) {
      context.addIssue({
        code: "custom",
        message: "Fillet radius must be smaller than half the smallest box dimension.",
        path: ["filletRadius"],
      })
    }
  })

const topologySpikeParametersBaseSchema = z
  .object({
    boxSize: positiveVector3Schema,
    holeCount: z.number().int().min(0).max(3),
    holeRadius: cadLengthSchema,
    holeSpacing: cadLengthSchema,
    holeCenter: vector2Schema,
    filletRadius: cadLengthSchema.nullable(),
  })
  .strict()

type TopologySpikeParameterValues = z.infer<typeof topologySpikeParametersBaseSchema>

function topologyHolesFitProfile(parameters: TopologySpikeParameterValues) {
  const [length, width] = parameters.boxSize
  const [centerX, centerY] = parameters.holeCenter
  const maximumHoleOffset = parameters.holeCount < 2 ? 0 : parameters.holeSpacing
  return (
    Math.abs(centerX) + maximumHoleOffset + parameters.holeRadius < length / 2 &&
    Math.abs(centerY) + parameters.holeRadius < width / 2
  )
}

function topologyHolesOverlap(parameters: TopologySpikeParameterValues) {
  if (parameters.holeCount === 2) return parameters.holeSpacing <= parameters.holeRadius
  if (parameters.holeCount === 3) return parameters.holeSpacing <= parameters.holeRadius * 2
  return false
}

function topologyFilletFits(parameters: TopologySpikeParameterValues) {
  return (
    parameters.filletRadius === null ||
    parameters.filletRadius < Math.min(...parameters.boxSize) / 2
  )
}

export const topologySpikeParametersSchema = topologySpikeParametersBaseSchema.superRefine(
  (parameters, context) => {
    if (!topologyHolesFitProfile(parameters)) {
      context.addIssue({
        code: "custom",
        message: "Topology spike holes must remain strictly inside the base profile.",
        path: ["holeCenter"],
      })
    }
    if (topologyHolesOverlap(parameters)) {
      context.addIssue({
        code: "custom",
        message: "Topology spike pattern holes must not overlap.",
        path: ["holeSpacing"],
      })
    }
    if (!topologyFilletFits(parameters)) {
      context.addIssue({
        code: "custom",
        message: "Topology spike fillet radius is too large for the base box.",
        path: ["filletRadius"],
      })
    }
  },
)

const initializeEngineRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("initializeEngine"),
})

const runKernelSpikeRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("runKernelSpike"),
  parameters: kernelSpikeParametersSchema,
})

const runTopologySpikeRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("runTopologySpike"),
  parameters: topologySpikeParametersSchema,
})

export const featureEvaluationDependencySchema = z
  .object({ featureId: featureIdSchema, contentHash: sha256Schema })
  .strict()

const evaluateFeatureRequestSchema = requestEnvelopeSchema
  .extend({
    type: z.literal("evaluateFeature"),
    featureId: featureIdSchema,
    content: featureContentIdentitySchema,
    contentHash: sha256Schema,
    dependencies: z.array(featureEvaluationDependencySchema).max(8),
    mesh: featureMeshPolicySchema,
  })
  .superRefine((request, context) => {
    if (request.dependencies.length !== request.content.feature.inputs.length) {
      context.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Evaluation dependencies must match the canonical input slots.",
      })
      return
    }
    const featureIds = new Set<string>()
    for (const [index, dependency] of request.dependencies.entries()) {
      if (dependency.contentHash !== request.content.feature.inputs[index]) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", index, "contentHash"],
          message: "Evaluation dependency hashes must preserve canonical input order.",
        })
      }
      if (featureIds.has(dependency.featureId)) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", index, "featureId"],
          message: "Evaluation dependency feature IDs must be unique.",
        })
      }
      if (dependency.featureId === request.featureId) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", index, "featureId"],
          message: "A feature cannot evaluate from its own prior shape.",
        })
      }
      featureIds.add(dependency.featureId)
    }
  })

const healthCheckRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("healthCheck"),
})

const disposeDocumentRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("disposeDocument"),
})

const cancelRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("cancel"),
  targetRequestId: identifierSchema,
})

export const geometryWorkerRequestSchema = z.discriminatedUnion("type", [
  initializeEngineRequestSchema,
  runKernelSpikeRequestSchema,
  runTopologySpikeRequestSchema,
  evaluateFeatureRequestSchema,
  healthCheckRequestSchema,
  disposeDocumentRequestSchema,
  cancelRequestSchema,
])

export const geometryProgressStageSchema = z.enum([
  "initializing",
  "creating-primitives",
  "boolean-cut",
  "fillet",
  "validation",
  "tessellation",
  "step-export",
  "step-import",
  "stl-export",
  "lifecycle-check",
  "feature-validation",
  "feature-evaluation",
  "feature-tessellation",
  "complete",
])

const engineMetadataSchema = z
  .object({
    adapter: z.literal("replicad"),
    adapterVersion: z.string().min(1),
    replicadVersion: z.string().min(1),
    opencascadePackageVersion: z.string().min(1),
    opencascadeSourceRevision: z.string().min(1).nullable(),
    wasmBytes: nonNegativeIntegerSchema,
    initializedInMs: finiteNumberSchema.nonnegative(),
    featureContentEnvironment: featureContentEnvironmentSchema,
  })
  .strict()

const boundsSchema = z
  .object({
    min: vector3Schema,
    max: vector3Schema,
  })
  .strict()

const shapeMetricsSchema = z
  .object({
    valid: z.boolean(),
    volume: finiteNumberSchema.nonnegative(),
    surfaceArea: finiteNumberSchema.nonnegative(),
    bounds: boundsSchema,
    faceCount: nonNegativeIntegerSchema,
    edgeCount: nonNegativeIntegerSchema,
    solidCount: nonNegativeIntegerSchema,
  })
  .strict()

const meshPayloadSchema = z
  .object({
    positions: z.instanceof(Float32Array),
    normals: z.instanceof(Float32Array),
    indices: z.instanceof(Uint32Array),
    triangleFaceIds: z.instanceof(Uint32Array),
  })
  .strict()

const operationHistoryStatsSchema = z
  .object({
    sourceCount: nonNegativeIntegerSchema,
    modifiedSourceCount: nonNegativeIntegerSchema,
    modifiedRelationCount: nonNegativeIntegerSchema,
    generatedSourceCount: nonNegativeIntegerSchema,
    generatedRelationCount: nonNegativeIntegerSchema,
    deletedSourceCount: nonNegativeIntegerSchema,
  })
  .strict()

const operationHistorySchema = z
  .object({
    booleanCut: z
      .object({
        vertices: operationHistoryStatsSchema,
        edges: operationHistoryStatsSchema,
        faces: operationHistoryStatsSchema,
        solids: operationHistoryStatsSchema,
      })
      .strict(),
    fillet: z
      .object({
        vertices: operationHistoryStatsSchema,
        edges: operationHistoryStatsSchema,
        faces: operationHistoryStatsSchema,
      })
      .strict(),
  })
  .strict()

const timingSchema = z
  .object({
    createPrimitivesMs: finiteNumberSchema.nonnegative(),
    booleanCutMs: finiteNumberSchema.nonnegative(),
    filletMs: finiteNumberSchema.nonnegative(),
    validationMs: finiteNumberSchema.nonnegative(),
    tessellationMs: finiteNumberSchema.nonnegative(),
    stepExportMs: finiteNumberSchema.nonnegative(),
    stepImportMs: finiteNumberSchema.nonnegative(),
    stlExportMs: finiteNumberSchema.nonnegative(),
    lifecycleCheckMs: finiteNumberSchema.nonnegative(),
    totalMs: finiteNumberSchema.nonnegative(),
  })
  .strict()

const lifecycleSchema = z
  .object({
    operation: geometryLifecycleOperationSchema,
    iterations: z.number().int().min(1).max(1_000),
    ownedShapesBefore: nonNegativeIntegerSchema,
    ownedShapesAfter: nonNegativeIntegerSchema,
    wasmHeapBytesBefore: nonNegativeIntegerSchema,
    wasmHeapBytesAfter: nonNegativeIntegerSchema,
    wasmHeapGrowthBytes: z.number().int().safe(),
    allocatorPurge: z
      .object({
        requested: z.boolean(),
        releasedBlocks: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict()

export const GEOMETRY_MEMORY_STAGES = [
  "initialized",
  "primitives-created",
  "boolean-completed",
  "fillet-completed",
  "validation-completed",
  "tessellation-completed",
  "step-exported",
  "step-imported",
  "stl-exported",
  "lifecycle-completed",
  "shapes-disposed",
] as const

export const geometryMemoryStageSchema = z.enum(GEOMETRY_MEMORY_STAGES)

const allocatorMetricsSchema = z
  .object({
    arenaBytes: nonNegativeIntegerSchema,
    allocatedBytes: nonNegativeIntegerSchema,
    freeBytes: nonNegativeIntegerSchema,
  })
  .strict()

const memoryProfileSchema = z
  .object({
    source: z.enum(["heap-capacity-only", "allocator-instrumented"]),
    snapshots: z
      .array(
        z
          .object({
            stage: geometryMemoryStageSchema,
            heapCapacityBytes: nonNegativeIntegerSchema,
            allocator: allocatorMetricsSchema.nullable(),
          })
          .strict(),
      )
      .length(geometryMemoryStageSchema.options.length),
  })
  .strict()

const exchangeMetricsSchema = z
  .object({
    stepBytes: nonNegativeIntegerSchema,
    stepFile: z.instanceof(Uint8Array),
    stlBytes: nonNegativeIntegerSchema,
    importedShape: shapeMetricsSchema,
    relativeVolumeError: finiteNumberSchema.nonnegative(),
  })
  .strict()
  .superRefine((exchange, context) => {
    if (exchange.stepBytes !== exchange.stepFile.byteLength) {
      context.addIssue({
        code: "custom",
        message: "STEP byte length does not match the transferred file.",
        path: ["stepBytes"],
      })
    }
  })

const initializedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("initialized"),
  engine: engineMetadataSchema,
})

const progressResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("progress"),
  stage: geometryProgressStageSchema,
  fraction: finiteNumberSchema.min(0).max(1),
})

const kernelSpikeCompletedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("kernelSpikeCompleted"),
  engine: engineMetadataSchema,
  shape: shapeMetricsSchema,
  history: operationHistorySchema,
  topologyCandidates: z.array(topologyCandidateSchema).max(10_000),
  mesh: meshPayloadSchema,
  exchange: exchangeMetricsSchema,
  lifecycle: lifecycleSchema,
  memory: memoryProfileSchema,
  timings: timingSchema,
})

const topologySpikeCompletedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("topologySpikeCompleted"),
  engine: engineMetadataSchema,
  shape: shapeMetricsSchema,
  topologyCandidates: z.array(topologyCandidateSchema).max(10_000),
})

const featureEvaluatedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("featureEvaluated"),
  featureId: featureIdSchema,
  contentHash: sha256Schema,
  engine: engineMetadataSchema,
  shape: shapeMetricsSchema,
  topologyCandidates: z.array(topologyCandidateSchema).max(10_000),
  mesh: meshPayloadSchema,
  cache: z.object({ brepHit: z.boolean() }).strict(),
  timings: z
    .object({
      evaluationMs: finiteNumberSchema.nonnegative(),
      tessellationMs: finiteNumberSchema.nonnegative(),
      totalMs: finiteNumberSchema.nonnegative(),
    })
    .strict(),
})

export const featureEvaluationEngineResultSchema = featureEvaluatedResponseSchema.pick({
  engine: true,
  shape: true,
  topologyCandidates: true,
  mesh: true,
  cache: true,
  timings: true,
})

const healthResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("health"),
  initialized: z.boolean(),
  activeDocuments: nonNegativeIntegerSchema,
  ownedShapeCount: nonNegativeIntegerSchema,
  wasmHeapBytes: nonNegativeIntegerSchema,
})

const documentDisposedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("documentDisposed"),
  ownedShapeCount: nonNegativeIntegerSchema,
})

const requestCancelledResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("requestCancelled"),
  targetRequestId: identifierSchema,
  reason: z.enum(["cancelled", "stale-generation"]),
})

const cancellationAcceptedResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("cancellationAccepted"),
  targetRequestId: identifierSchema,
})

export const geometryDiagnosticCodeSchema = z.enum([
  "invalid-request",
  "unsupported-protocol-version",
  "engine-not-initialized",
  "kernel-initialization-failed",
  "geometry-operation-failed",
  "feature-content-environment-mismatch",
  "feature-content-hash-mismatch",
  "unsupported-feature-type",
  "invalid-feature-parameters",
  "invalid-feature-geometry",
  "missing-feature-dependency",
  "cancelled",
  "stale-generation",
  "internal-error",
])

const failureResponseSchema = responseEnvelopeSchema.extend({
  type: z.literal("failure"),
  diagnostic: z
    .object({
      code: geometryDiagnosticCodeSchema,
      message: z.string().min(1),
      stage: geometryProgressStageSchema.nullable(),
      retryable: z.boolean(),
    })
    .strict(),
})

export const geometryWorkerResponseSchema = z.discriminatedUnion("type", [
  initializedResponseSchema,
  progressResponseSchema,
  kernelSpikeCompletedResponseSchema,
  topologySpikeCompletedResponseSchema,
  featureEvaluatedResponseSchema,
  healthResponseSchema,
  documentDisposedResponseSchema,
  cancellationAcceptedResponseSchema,
  requestCancelledResponseSchema,
  failureResponseSchema,
])

export type KernelSpikeParameters = z.infer<typeof kernelSpikeParametersSchema>
export type TopologySpikeParameters = z.infer<typeof topologySpikeParametersSchema>
export type FeatureMeshPolicy = z.infer<typeof featureMeshPolicySchema>
export type FeatureContentEnvironment = z.infer<typeof featureContentEnvironmentSchema>
export type FeatureContentIdentity = z.infer<typeof featureContentIdentitySchema>
export type FeatureEvaluationDependency = z.infer<typeof featureEvaluationDependencySchema>
export type GeometryWorkerRequest = z.infer<typeof geometryWorkerRequestSchema>
export type GeometryWorkerResponse = z.infer<typeof geometryWorkerResponseSchema>
export type GeometryRequestEnvelope = Pick<
  GeometryWorkerRequest,
  "protocolVersion" | "requestId" | "documentId" | "revision" | "generation"
>
export type GeometryTerminalResponse = Exclude<GeometryWorkerResponse, { type: "progress" }>
export type GeometryProgressStage = z.infer<typeof geometryProgressStageSchema>
export type GeometryMemoryStage = z.infer<typeof geometryMemoryStageSchema>
export type GeometryLifecycleOperation = z.infer<typeof geometryLifecycleOperationSchema>
export type GeometryDiagnosticCode = z.infer<typeof geometryDiagnosticCodeSchema>
export type TopologyCandidate = z.infer<typeof topologyCandidateSchema>
export type TopologySignature = z.infer<typeof topologySignatureSchema>
export type GeometryEngineMetadata = Extract<
  GeometryWorkerResponse,
  { type: "initialized" }
>["engine"]
export type KernelSpikeCompletedResponse = Extract<
  GeometryWorkerResponse,
  { type: "kernelSpikeCompleted" }
>
export type KernelSpikeEngineResult = Pick<
  KernelSpikeCompletedResponse,
  | "engine"
  | "shape"
  | "history"
  | "topologyCandidates"
  | "mesh"
  | "exchange"
  | "lifecycle"
  | "memory"
  | "timings"
>
export type TopologySpikeEngineResult = Pick<
  Extract<GeometryWorkerResponse, { type: "topologySpikeCompleted" }>,
  "engine" | "shape" | "topologyCandidates"
>
export type FeatureEvaluatedResponse = Extract<GeometryWorkerResponse, { type: "featureEvaluated" }>
export type FeatureEvaluationEngineResult = z.infer<typeof featureEvaluationEngineResultSchema>
