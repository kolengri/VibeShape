import { z } from "zod"

export const GEOMETRY_PROTOCOL_VERSION = 2 as const

const finiteNumberSchema = z.number().finite()
const cadLengthSchema = finiteNumberSchema.min(0.001).max(100_000)
const cadCoordinateSchema = finiteNumberSchema.min(-100_000).max(100_000)
const meshToleranceSchema = finiteNumberSchema.min(0.001).max(10)
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()
const identifierSchema = z.string().trim().min(1).max(128)
const vector3Schema = z.tuple([cadCoordinateSchema, cadCoordinateSchema, cadCoordinateSchema])
const positiveVector3Schema = z.tuple([cadLengthSchema, cadLengthSchema, cadLengthSchema])

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

const initializeEngineRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("initializeEngine"),
})

const runKernelSpikeRequestSchema = requestEnvelopeSchema.extend({
  type: z.literal("runKernelSpike"),
  parameters: kernelSpikeParametersSchema,
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
    stlBytes: nonNegativeIntegerSchema,
    importedShape: shapeMetricsSchema,
    relativeVolumeError: finiteNumberSchema.nonnegative(),
  })
  .strict()

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
  mesh: meshPayloadSchema,
  exchange: exchangeMetricsSchema,
  lifecycle: lifecycleSchema,
  memory: memoryProfileSchema,
  timings: timingSchema,
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
  healthResponseSchema,
  documentDisposedResponseSchema,
  cancellationAcceptedResponseSchema,
  requestCancelledResponseSchema,
  failureResponseSchema,
])

export type KernelSpikeParameters = z.infer<typeof kernelSpikeParametersSchema>
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
  "engine" | "shape" | "mesh" | "exchange" | "lifecycle" | "memory" | "timings"
>
