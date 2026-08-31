import { isArray, isNaNValue, isNumber, isPlainObject } from "is-what"
import { z } from "zod"

export const GEOMETRY_PROTOCOL_VERSION = 12 as const

const finiteNumberSchema = z.number().finite()
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reverseDnsPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const featureIdSchema = z
  .string()
  .regex(uuidV7Pattern, "Feature IDs must be lowercase UUIDv7 values.")
const sketchIdSchema = z
  .string()
  .regex(uuidV7Pattern, "Sketch IDs must be lowercase UUIDv7 values.")
const sketchEntityIdSchema = z
  .string()
  .regex(uuidV7Pattern, "Sketch entity IDs must be lowercase UUIDv7 values.")
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
const topologyVector3Schema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])

function vectorDot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function vectorCross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ] as const
}

function normalizedVector(vector: readonly [number, number, number]) {
  return Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

function vectorsMatch(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) <= 1e-6
}

export const extrusionFrameSchema = z
  .object({
    origin: vector3Schema,
    xAxis: vector3Schema,
    yAxis: vector3Schema,
    normal: vector3Schema,
  })
  .strict()
  .superRefine((frame, context) => {
    const axes = [frame.xAxis, frame.yAxis, frame.normal]
    if (axes.some((axis) => !normalizedVector(axis))) {
      context.addIssue({ code: "custom", message: "Extrusion frame axes must be normalized." })
      return
    }
    if (
      Math.abs(vectorDot(frame.xAxis, frame.yAxis)) > 1e-6 ||
      Math.abs(vectorDot(frame.xAxis, frame.normal)) > 1e-6 ||
      Math.abs(vectorDot(frame.yAxis, frame.normal)) > 1e-6
    ) {
      context.addIssue({ code: "custom", message: "Extrusion frame axes must be orthogonal." })
      return
    }
    if (vectorDot(vectorCross(frame.xAxis, frame.yAxis), frame.normal) < 1 - 1e-6) {
      context.addIssue({ code: "custom", message: "Extrusion frame must be right-handed." })
    }
  })

export const boxFeatureContentParametersSchema = z
  .object({
    width: cadLengthSchema,
    depth: cadLengthSchema,
    height: cadLengthSchema,
    centered: z.boolean(),
    origin: vector3Schema.default([0, 0, 0]),
  })
  .strict()

export const cylinderFeatureContentParametersSchema = z
  .object({
    radius: cadLengthSchema,
    height: cadLengthSchema,
    centered: z.boolean(),
    origin: vector3Schema.default([0, 0, 0]),
  })
  .strict()

export const booleanFeatureContentParametersSchema = z
  .object({ operation: z.literal("subtract") })
  .strict()

const extrusionLineSegmentSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.literal("line"),
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
    start: vector2Schema,
    end: vector2Schema,
  })
  .strict()

const extrusionArcSegmentSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.literal("arc"),
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
    start: vector2Schema,
    middle: vector2Schema,
    end: vector2Schema,
  })
  .strict()

const extrusionCircleSegmentSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.literal("circle"),
    center: vector2Schema,
    radius: cadLengthSchema,
  })
  .strict()

const extrusionEllipseSegmentSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.literal("ellipse"),
    center: vector2Schema,
    primaryAxisPoint: vector2Schema,
    secondaryAxisPoint: vector2Schema,
  })
  .strict()
  .superRefine((segment, context) => {
    const primary = [
      segment.primaryAxisPoint[0] - segment.center[0],
      segment.primaryAxisPoint[1] - segment.center[1],
    ] as const
    const secondary = [
      segment.secondaryAxisPoint[0] - segment.center[0],
      segment.secondaryAxisPoint[1] - segment.center[1],
    ] as const
    const primaryRadius = Math.hypot(...primary)
    const secondaryRadius = Math.hypot(...secondary)
    if (primaryRadius < 0.001 || secondaryRadius < 0.001) {
      context.addIssue({
        code: "custom",
        message: "Extrusion ellipse axes must have positive CAD-scale radii.",
      })
      return
    }
    const normalizedDot =
      (primary[0] * secondary[0] + primary[1] * secondary[1]) / (primaryRadius * secondaryRadius)
    if (Math.abs(normalizedDot) > 1e-6) {
      context.addIssue({
        code: "custom",
        message: "Extrusion ellipse axes must be perpendicular.",
      })
    }
  })

const extrusionEllipticalArcSegmentSchema = z
  .object({
    entityId: sketchEntityIdSchema,
    type: z.literal("elliptical-arc"),
    startPointId: sketchEntityIdSchema,
    endPointId: sketchEntityIdSchema,
    center: vector2Schema,
    primaryAxisPoint: vector2Schema,
    secondaryAxisPoint: vector2Schema,
    start: vector2Schema,
    end: vector2Schema,
  })
  .strict()
  .superRefine((segment, context) => {
    const primary = [
      segment.primaryAxisPoint[0] - segment.center[0],
      segment.primaryAxisPoint[1] - segment.center[1],
    ] as const
    const secondary = [
      segment.secondaryAxisPoint[0] - segment.center[0],
      segment.secondaryAxisPoint[1] - segment.center[1],
    ] as const
    const primaryRadius = Math.hypot(...primary)
    const secondaryRadius = Math.hypot(...secondary)
    if (primaryRadius < 0.001 || secondaryRadius < 0.001) {
      context.addIssue({
        code: "custom",
        message: "Extrusion elliptical-arc axes must have positive CAD-scale radii.",
      })
      return
    }
    const normalizedDot =
      (primary[0] * secondary[0] + primary[1] * secondary[1]) / (primaryRadius * secondaryRadius)
    if (Math.abs(normalizedDot) > 1e-6) {
      context.addIssue({
        code: "custom",
        message: "Extrusion elliptical-arc axes must be perpendicular.",
      })
    }
    for (const [path, point] of [
      ["start", segment.start],
      ["end", segment.end],
    ] as const) {
      const offset = [point[0] - segment.center[0], point[1] - segment.center[1]] as const
      const primaryCoordinate =
        (offset[0] * primary[0] + offset[1] * primary[1]) / primaryRadius ** 2
      const secondaryCoordinate =
        (offset[0] * secondary[0] + offset[1] * secondary[1]) / secondaryRadius ** 2
      if (Math.abs(primaryCoordinate ** 2 + secondaryCoordinate ** 2 - 1) > 1e-6) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "Extrusion elliptical-arc endpoints must lie on the ellipse.",
        })
      }
    }
    if (Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) < 0.001) {
      context.addIssue({
        code: "custom",
        message: "Extrusion elliptical-arc endpoints must be distinct.",
      })
    }
  })

export const extrusionProfileSegmentSchema = z.discriminatedUnion("type", [
  extrusionLineSegmentSchema,
  extrusionArcSegmentSchema,
  extrusionCircleSegmentSchema,
  extrusionEllipseSegmentSchema,
  extrusionEllipticalArcSegmentSchema,
])

export const extrusionProfileLoopSchema = z
  .object({
    sourceEntityIds: z.array(sketchEntityIdSchema).min(1).max(2_000),
    segments: z.array(extrusionProfileSegmentSchema).min(1).max(2_000),
  })
  .strict()
  .superRefine((loop, context) => {
    const sourceIds = loop.sourceEntityIds
    if (
      sourceIds.some((entityId, index) => index > 0 && (sourceIds[index - 1] ?? "") >= entityId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceEntityIds"],
        message: "Extrusion profile source entity IDs must be unique and sorted.",
      })
    }
    const segmentIds = [...new Set(loop.segments.map(({ entityId }) => entityId))].sort()
    if (
      segmentIds.length !== sourceIds.length ||
      segmentIds.some((entityId, index) => entityId !== sourceIds[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["segments"],
        message: "Extrusion profile segments must match their source entity IDs.",
      })
    }
  })

function profileSegmentCount({
  holes,
  outer,
}: Readonly<{
  holes: readonly { segments: readonly unknown[] }[]
  outer: { segments: readonly unknown[] }
}>) {
  return outer.segments.length + holes.reduce((total, hole) => total + hole.segments.length, 0)
}

export const extrusionFeatureContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    supportFeatureId: featureIdSchema.optional(),
    plane: z.enum(["xy", "xz", "yz"]).optional(),
    frame: extrusionFrameSchema.optional(),
    outer: extrusionProfileLoopSchema,
    holes: z.array(extrusionProfileLoopSchema).max(2_000),
    distance: cadLengthSchema,
    symmetric: z.boolean(),
    operation: z.enum(["new", "add", "remove", "intersect"]),
  })
  .strict()
  .refine(({ frame, plane }) => Number(frame !== undefined) + Number(plane !== undefined) === 1, {
    message: "Extrusion content must declare exactly one sketch placement.",
  })
  .refine(
    (profile) => profileSegmentCount(profile) <= 2_000,
    "Extrusion profiles are limited to 2,000 total segments.",
  )

const multiProfileSchema = z
  .object({
    outer: extrusionProfileLoopSchema,
    holes: z.array(extrusionProfileLoopSchema).max(2_000),
  })
  .strict()
  .refine(
    (profile) => profileSegmentCount(profile) <= 2_000,
    "A profile is limited to 2,000 total segments.",
  )

const multiProfileListSchema = z
  .array(multiProfileSchema)
  .min(1)
  .max(64)
  .refine(
    (profiles) =>
      profiles.reduce((total, profile) => total + profileSegmentCount(profile), 0) <= 2_000,
    "Multi-profile content is limited to 2,000 aggregate segments.",
  )

export const extrusionMultiProfileFeatureContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    supportFeatureId: featureIdSchema.optional(),
    frame: extrusionFrameSchema,
    profiles: multiProfileListSchema,
    distance: cadLengthSchema,
    symmetric: z.boolean(),
    operation: z.literal("new"),
  })
  .strict()

export const revolveMultiProfileFeatureContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    supportFeatureId: featureIdSchema.optional(),
    frame: extrusionFrameSchema,
    profiles: multiProfileListSchema,
    axis: z.union([
      z.object({ kind: z.literal("origin-axis"), axis: z.enum(["x", "y"]) }).strict(),
      z
        .object({
          kind: z.literal("sketch-line"),
          sketchId: sketchIdSchema,
          entityId: sketchEntityIdSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("model-edge"),
          reference: z
            .object({
              schemaVersion: z.literal(0),
              featureId: featureIdSchema,
              kind: z.literal("edge"),
              semanticRole: z.string().min(1).max(256).optional(),
              lineageToken: z.string().min(1).max(256).optional(),
              signature: z.lazy(() => topologySignatureSchema.extend({ kind: z.literal("edge") })),
              intent: z.lazy(() => topologyIntentSchema).optional(),
            })
            .strict()
            .refine((reference) => reference.signature.kind === "edge", {
              message: "Revolve axis reference signature must describe an edge.",
              path: ["signature", "kind"],
            }),
        })
        .strict(),
    ]),
    axisOrigin: vector3Schema,
    axisDirection: topologyVector3Schema,
    angleRadians: finiteNumberSchema.min(Number.EPSILON).max(Math.PI * 2),
    operation: z.literal("new"),
  })
  .strict()
  .refine(({ axisDirection }) => isNormalized(axisDirection), {
    message: "Revolve axis direction must be normalized.",
    path: ["axisDirection"],
  })

type RevolveAxisValidationInput = Readonly<{
  axis:
    | Readonly<{ kind: "origin-axis"; axis: "x" | "y" }>
    | Readonly<{ kind: "sketch-line"; sketchId: string }>
    | Readonly<{ kind: "model-edge" }>
  axisDirection: readonly [number, number, number]
  axisOrigin: readonly [number, number, number]
  frame: z.infer<typeof extrusionFrameSchema>
  sketchId: string
}>

function axisIsInFrame(input: RevolveAxisValidationInput) {
  const relative = [
    input.axisOrigin[0] - input.frame.origin[0],
    input.axisOrigin[1] - input.frame.origin[1],
    input.axisOrigin[2] - input.frame.origin[2],
  ] as const
  return (
    Math.abs(vectorDot(relative, input.frame.normal)) <= 1e-6 &&
    Math.abs(vectorDot(input.axisDirection, input.frame.normal)) <= 1e-6
  )
}

function validateOriginRevolveAxis(input: RevolveAxisValidationInput, context: z.RefinementCtx) {
  if (!vectorsMatch(input.axisOrigin, input.frame.origin)) {
    context.addIssue({
      code: "custom",
      message: "Revolve axis origin must match the sketch frame origin.",
      path: ["axisOrigin"],
    })
  }
  if (input.axis.kind !== "origin-axis") return
  const expectedDirection = input.axis.axis === "x" ? input.frame.xAxis : input.frame.yAxis
  if (!vectorsMatch(input.axisDirection, expectedDirection)) {
    context.addIssue({
      code: "custom",
      message: "Revolve axis direction must match its sketch-local axis intent.",
      path: ["axisDirection"],
    })
  }
}

function validateSketchLineRevolveAxis(
  input: RevolveAxisValidationInput,
  context: z.RefinementCtx,
) {
  if (input.axis.kind !== "sketch-line") return
  if (input.axis.sketchId !== input.sketchId) {
    context.addIssue({
      code: "custom",
      message: "Revolve sketch-line axis must belong to the prepared profile sketch.",
      path: ["axis", "sketchId"],
    })
  }
  if (!axisIsInFrame(input)) {
    context.addIssue({
      code: "custom",
      message: "Revolve sketch-line axes must lie in the prepared profile plane.",
      path: ["axis"],
    })
  }
}

function validateRevolveAxisContent(input: RevolveAxisValidationInput, context: z.RefinementCtx) {
  if (input.axis.kind === "origin-axis") return validateOriginRevolveAxis(input, context)
  if (input.axis.kind === "sketch-line") return validateSketchLineRevolveAxis(input, context)
  if (!axisIsInFrame(input)) {
    context.addIssue({
      code: "custom",
      message: "Revolve model-edge axes must lie in the prepared profile plane.",
      path: ["axis"],
    })
  }
}

export const revolveFeatureContentParametersSchema = z
  .object({
    sketchId: sketchIdSchema,
    supportFeatureId: featureIdSchema.optional(),
    frame: extrusionFrameSchema,
    outer: extrusionProfileLoopSchema,
    holes: z.array(extrusionProfileLoopSchema).max(2_000),
    axis: z.union([
      z.object({ kind: z.literal("origin-axis"), axis: z.enum(["x", "y"]) }).strict(),
      z
        .object({
          kind: z.literal("sketch-line"),
          sketchId: sketchIdSchema,
          entityId: sketchEntityIdSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("model-edge"),
          reference: z.lazy(() =>
            z
              .object({
                schemaVersion: z.literal(0),
                featureId: featureIdSchema,
                kind: z.literal("edge"),
                semanticRole: z.string().min(1).max(256).optional(),
                lineageToken: z.string().min(1).max(256).optional(),
                signature: topologySignatureSchema.safeExtend({ kind: z.literal("edge") }),
                intent: topologyIntentSchema.optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ]),
    axisOrigin: vector3Schema,
    axisDirection: topologyVector3Schema,
    angleRadians: finiteNumberSchema.min(Number.EPSILON).max(Math.PI * 2),
    operation: z.enum(["new", "add", "remove", "intersect"]),
  })
  .strict()
  .refine(({ axisDirection }) => isNormalized(axisDirection), {
    message: "Revolve axis direction must be normalized.",
    path: ["axisDirection"],
  })
  .superRefine(validateRevolveAxisContent)
  .refine(
    (profile) => profileSegmentCount(profile) <= 2_000,
    "Revolve profiles are limited to 2,000 total segments.",
  )

export const datumPlaneFeatureContentParametersSchema = z
  .object({
    frame: extrusionFrameSchema,
    supportFeatureId: featureIdSchema.optional(),
    size: cadLengthSchema,
  })
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
    (parameters) => Object.keys(parameters).length <= 32,
    "Feature content parameters are limited to 32 keys.",
  )
  .refine(
    (parameters) => JSON.stringify(parameters).length <= 1024 * 1024,
    "Feature content parameters exceed the encoded-size limit.",
  )

function canonicalJson(value: unknown): string {
  if (isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isPlainObject(value)) {
    if (
      (value !== null && typeof value === "object") ||
      isNaNValue(value) ||
      (isNumber(value) && !Number.isFinite(value))
    ) {
      throw new TypeError("Canonical JSON accepts only JSON values.")
    }
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError("Canonical JSON accepts only JSON values.")
    return serialized
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

export function serializeFeatureContentEnvironment(input: unknown) {
  return canonicalJson(featureContentEnvironmentSchema.parse(input))
}

export const featureMeshPolicySchema = z
  .object({
    chordTolerance: meshToleranceSchema,
    angularTolerance: finiteNumberSchema.min(0.001).max(Math.PI),
  })
  .strict()

export const geometryExportFormatSchema = z.enum(["3mf", "step", "stl"])

function isNormalized(vector: readonly number[]) {
  return Math.abs(Math.hypot(...vector) - 1) <= 1e-6
}

export const topologyKindSchema = z.enum(["vertex", "edge", "face"])
export const topologySignatureSchema = z
  .object({
    kind: topologyKindSchema,
    geometryClass: z.string().min(1).max(64),
    measure: finiteNumberSchema.nonnegative(),
    centroid: topologyVector3Schema,
    bounds: z.object({ min: topologyVector3Schema, max: topologyVector3Schema }).strict(),
    direction: topologyVector3Schema.optional(),
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

const circularEdgeGeometryShape = {
  center: topologyVector3Schema,
  xAxis: topologyVector3Schema,
  yAxis: topologyVector3Schema,
  normal: topologyVector3Schema,
  radius: finiteNumberSchema.positive(),
} as const

function validateCircularEdgeFrame(
  geometry: {
    xAxis: readonly [number, number, number]
    yAxis: readonly [number, number, number]
    normal: readonly [number, number, number]
  },
  context: z.RefinementCtx,
) {
  const axes = [geometry.xAxis, geometry.yAxis, geometry.normal]
  if (axes.some((axis) => !isNormalized(axis))) {
    context.addIssue({ code: "custom", message: "Circular edge axes must be normalized." })
    return
  }
  if (
    Math.abs(vectorDot(geometry.xAxis, geometry.yAxis)) > 1e-6 ||
    Math.abs(vectorDot(geometry.xAxis, geometry.normal)) > 1e-6 ||
    Math.abs(vectorDot(geometry.yAxis, geometry.normal)) > 1e-6
  ) {
    context.addIssue({ code: "custom", message: "Circular edge axes must be orthogonal." })
    return
  }
  if (vectorDot(vectorCross(geometry.xAxis, geometry.yAxis), geometry.normal) < 1 - 1e-6) {
    context.addIssue({ code: "custom", message: "Circular edge axes must be right-handed." })
  }
}

function circularPointError(
  geometry: { center: readonly number[]; radius: number },
  point: readonly number[],
) {
  const distance = Math.hypot(
    (point[0] ?? 0) - (geometry.center[0] ?? 0),
    (point[1] ?? 0) - (geometry.center[1] ?? 0),
    (point[2] ?? 0) - (geometry.center[2] ?? 0),
  )
  return Math.abs(distance - geometry.radius)
}

function circularPointPlaneError(
  geometry: {
    center: readonly [number, number, number]
    normal: readonly [number, number, number]
  },
  point: readonly [number, number, number],
) {
  return Math.abs(
    vectorDot(
      [point[0] - geometry.center[0], point[1] - geometry.center[1], point[2] - geometry.center[2]],
      geometry.normal,
    ),
  )
}

const circleEdgeReferenceGeometrySchema = z
  .object({ kind: z.literal("circle-edge"), ...circularEdgeGeometryShape })
  .strict()
  .superRefine(validateCircularEdgeFrame)

const arcEdgeReferenceGeometrySchema = z
  .object({
    kind: z.literal("arc-edge"),
    ...circularEdgeGeometryShape,
    start: topologyVector3Schema,
    middle: topologyVector3Schema,
    end: topologyVector3Schema,
  })
  .strict()
  .superRefine((geometry, context) => {
    validateCircularEdgeFrame(geometry, context)
    for (const key of ["start", "middle", "end"] as const) {
      const tolerance = 1e-6 * Math.max(1, geometry.radius)
      if (
        circularPointError(geometry, geometry[key]) > tolerance ||
        circularPointPlaneError(geometry, geometry[key]) > tolerance
      ) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Circular arc points must lie on the analytical circle.",
        })
      }
    }
    if (
      Math.hypot(
        geometry.end[0] - geometry.start[0],
        geometry.end[1] - geometry.start[1],
        geometry.end[2] - geometry.start[2],
      ) <= 1e-9
    ) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Circular arc endpoints must be distinct.",
      })
    }
  })

const ellipticalEdgeGeometryShape = {
  center: topologyVector3Schema,
  xAxis: topologyVector3Schema,
  yAxis: topologyVector3Schema,
  normal: topologyVector3Schema,
  majorRadius: finiteNumberSchema.min(0.001),
  minorRadius: finiteNumberSchema.min(0.001),
}

function validateEllipticalEdgeFrame(
  geometry: z.infer<z.ZodObject<typeof ellipticalEdgeGeometryShape>>,
  context: z.RefinementCtx,
) {
  const axes = [geometry.xAxis, geometry.yAxis, geometry.normal]
  if (axes.some((axis) => !normalizedVector(axis))) {
    context.addIssue({ code: "custom", message: "Elliptical edge axes must be normalized." })
    return
  }
  if (
    Math.abs(vectorDot(geometry.xAxis, geometry.yAxis)) > 1e-6 ||
    Math.abs(vectorDot(geometry.xAxis, geometry.normal)) > 1e-6 ||
    Math.abs(vectorDot(geometry.yAxis, geometry.normal)) > 1e-6
  ) {
    context.addIssue({ code: "custom", message: "Elliptical edge axes must be orthogonal." })
  } else if (vectorDot(vectorCross(geometry.xAxis, geometry.yAxis), geometry.normal) < 1 - 1e-6) {
    context.addIssue({ code: "custom", message: "Elliptical edge axes must be right-handed." })
  }
  if (geometry.majorRadius < geometry.minorRadius) {
    context.addIssue({
      code: "custom",
      path: ["majorRadius"],
      message: "Major radius must be at least minor radius.",
    })
  }
}

function ellipticalPointError(
  geometry: {
    center: readonly [number, number, number]
    xAxis: readonly [number, number, number]
    yAxis: readonly [number, number, number]
    majorRadius: number
    minorRadius: number
  },
  point: readonly [number, number, number],
) {
  const offset = [
    point[0] - geometry.center[0],
    point[1] - geometry.center[1],
    point[2] - geometry.center[2],
  ] as const
  const x = vectorDot(offset, geometry.xAxis) / geometry.majorRadius
  const y = vectorDot(offset, geometry.yAxis) / geometry.minorRadius
  const plane = vectorDot(offset, vectorCross(geometry.xAxis, geometry.yAxis))
  return {
    radial: Math.abs(x * x + y * y - 1),
    plane: Math.abs(plane),
    distance: Math.hypot(...offset),
  }
}

const ellipseEdgeReferenceGeometrySchema = z
  .object({ kind: z.literal("ellipse-edge"), ...ellipticalEdgeGeometryShape })
  .strict()
  .superRefine(validateEllipticalEdgeFrame)

const ellipticalArcEdgeReferenceGeometrySchema = z
  .object({
    kind: z.literal("elliptical-arc-edge"),
    ...ellipticalEdgeGeometryShape,
    start: topologyVector3Schema,
    middle: topologyVector3Schema,
    end: topologyVector3Schema,
  })
  .strict()
  .superRefine((geometry, context) => {
    validateEllipticalEdgeFrame(geometry, context)
    for (const key of ["start", "middle", "end"] as const) {
      const tolerance = 1e-6 * Math.max(1, geometry.majorRadius)
      const error = ellipticalPointError(geometry, geometry[key])
      if (error.radial > 1e-6 || error.plane > tolerance) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Elliptical arc points must lie on the analytical ellipse.",
        })
      }
    }
    if (
      Math.hypot(
        geometry.end[0] - geometry.start[0],
        geometry.end[1] - geometry.start[1],
        geometry.end[2] - geometry.start[2],
      ) <= 1e-9
    ) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Elliptical arc endpoints must be distinct.",
      })
    }
  })

export const topologyReferenceGeometrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("vertex"),
      position: topologyVector3Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("line-edge"),
      start: topologyVector3Schema,
      end: topologyVector3Schema,
    })
    .strict()
    .refine(
      ({ end, start }) =>
        Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) > 1e-9,
      { message: "Topology line-edge endpoints must be distinct.", path: ["end"] },
    ),
  circleEdgeReferenceGeometrySchema,
  arcEdgeReferenceGeometrySchema,
  ellipseEdgeReferenceGeometrySchema,
  ellipticalArcEdgeReferenceGeometrySchema,
])

const topologyCandidateBaseSchema = z
  .object({
    candidateId: identifierSchema,
    kind: topologyKindSchema,
    meshFaceId: nonNegativeIntegerSchema.optional(),
    referenceGeometry: topologyReferenceGeometrySchema.optional(),
    semanticRole: z.string().min(1).max(256).optional(),
    lineageTokens: z.array(z.string().min(1).max(256)).max(256),
    signature: topologySignatureSchema,
  })
  .strict()

const REFERENCE_GEOMETRY_CANDIDATE_KIND = {
  vertex: { geometryClass: "POINT", topologyKind: "vertex" },
  "line-edge": { geometryClass: "LINE", topologyKind: "edge" },
  "circle-edge": { geometryClass: "CIRCLE", topologyKind: "edge" },
  "arc-edge": { geometryClass: "CIRCLE", topologyKind: "edge" },
  "ellipse-edge": { geometryClass: "ELLIPSE", topologyKind: "edge" },
  "elliptical-arc-edge": { geometryClass: "ELLIPSE", topologyKind: "edge" },
} as const satisfies Record<
  z.infer<typeof topologyReferenceGeometrySchema>["kind"],
  Readonly<{ geometryClass: string; topologyKind: z.infer<typeof topologyKindSchema> }>
>

function referenceGeometryMatchesCandidate(candidate: z.infer<typeof topologyCandidateBaseSchema>) {
  const geometry = candidate.referenceGeometry
  if (!geometry) return true
  const expected = REFERENCE_GEOMETRY_CANDIDATE_KIND[geometry.kind]
  return (
    candidate.kind === expected.topologyKind &&
    candidate.signature.geometryClass === expected.geometryClass
  )
}

export const topologyCandidateSchema = topologyCandidateBaseSchema
  .refine((candidate) => candidate.kind === candidate.signature.kind, {
    message: "Topology candidate kind must match its signature kind.",
    path: ["signature", "kind"],
  })
  .refine((candidate) => candidate.meshFaceId === undefined || candidate.kind === "face", {
    message: "Only face topology candidates may declare a tessellation face ID.",
    path: ["meshFaceId"],
  })
  .refine(referenceGeometryMatchesCandidate, {
    message: "Topology reference geometry must match its candidate kind and geometry class.",
    path: ["referenceGeometry", "kind"],
  })

const topologyIntentSchema = z
  .object({
    nearPoint: vector3Schema.optional(),
    expectedDirection: vector3Schema.optional(),
  })
  .strict()
  .refine((intent) => !intent.expectedDirection || isNormalized(intent.expectedDirection), {
    message: "Topology intent directions must be normalized.",
    path: ["expectedDirection"],
  })

const contentReferenceSchema = z
  .object({
    schemaVersion: z.literal(0),
    kind: topologyKindSchema,
    semanticRole: z.string().min(1).max(256).optional(),
    lineageToken: z.string().min(1).max(256).optional(),
    signature: topologySignatureSchema,
    intent: topologyIntentSchema.optional(),
    inputIndex: z.number().int().nonnegative().max(1_023),
  })
  .strict()
  .refine((reference) => reference.kind === reference.signature.kind, {
    message: "Content reference kind must match its signature kind.",
    path: ["signature", "kind"],
  })

export const featureContentIdentitySchema = z
  .object({
    schemaVersion: z.literal(0),
    feature: z
      .object({
        schemaVersion: z.literal(0),
        type: featureTypeSchema,
        parameters: featureContentParametersSchema,
        inputs: z.array(sha256Schema).max(1_024),
        references: z.array(contentReferenceSchema).max(4_096),
      })
      .strict(),
    environment: featureContentEnvironmentSchema,
  })
  .strict()

export function serializeFeatureContentIdentity(input: unknown) {
  return canonicalJson(featureContentIdentitySchema.parse(input))
}

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
export type GeometryExportFormat = z.infer<typeof geometryExportFormatSchema>
export type FeatureContentEnvironment = z.infer<typeof featureContentEnvironmentSchema>
export type FeatureContentIdentity = z.infer<typeof featureContentIdentitySchema>
export type ExtrusionMultiProfileContentParameters = z.infer<
  typeof extrusionMultiProfileFeatureContentParametersSchema
>
export type RevolveMultiProfileContentParameters = z.infer<
  typeof revolveMultiProfileFeatureContentParametersSchema
>
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
