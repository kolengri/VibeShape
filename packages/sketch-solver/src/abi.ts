import { z } from "zod"

export const SKETCH_SOLVER_ABI = {
  parameterMetadataStride: 2,
  entityRecordStride: 14,
  constraintRecordStride: 12,
  maximumParameterCount: 10_000,
  maximumEntityCount: 5_000,
  maximumConstraintCount: 10_000,
} as const

export const SOLVESPACE_ENTITY_TYPE = {
  pointIn3d: 50_000,
  pointIn2d: 50_001,
  normalIn3d: 60_000,
  normalIn2d: 60_001,
  distance: 70_000,
  workplane: 80_000,
  lineSegment: 80_001,
  cubic: 80_002,
  circle: 80_003,
  arcOfCircle: 80_004,
} as const

export const SOLVESPACE_CONSTRAINT_TYPE = {
  pointsCoincident: 100_000,
  pointPointDistance: 100_001,
  pointLineDistance: 100_003,
  pointOnLine: 100_006,
  equalLengthLines: 100_008,
  horizontal: 100_019,
  vertical: 100_020,
  diameter: 100_021,
  pointOnCircle: 100_022,
  angle: 100_024,
  parallel: 100_025,
  perpendicular: 100_026,
  arcLineTangent: 100_027,
  equalRadius: 100_029,
  projectedPointDistance: 100_030,
  whereDragged: 100_031,
  curveCurveTangent: 100_032,
} as const

const uint32ArraySchema = z.custom<Uint32Array>(
  (value) => value instanceof Uint32Array,
  "Expected a Uint32Array.",
)
const float64ArraySchema = z.custom<Float64Array>(
  (value) => value instanceof Float64Array,
  "Expected a Float64Array.",
)

function hasOnlyFiniteValues(values: Float64Array) {
  return values.every(Number.isFinite)
}

function hasUniqueRecordHandles(records: Uint32Array, stride: number) {
  const handles = new Set<number>()
  for (let offset = 0; offset < records.length; offset += stride) {
    const handle = records[offset]
    const group = records[offset + 1]
    if (!handle || !group || handles.has(handle)) {
      return false
    }
    handles.add(handle)
  }
  return true
}

function hasSupportedEntityTypes(records: Uint32Array) {
  const supportedTypes = new Set<number>(Object.values(SOLVESPACE_ENTITY_TYPE))
  for (let offset = 0; offset < records.length; offset += SKETCH_SOLVER_ABI.entityRecordStride) {
    if (!supportedTypes.has(records[offset + 2] as number)) {
      return false
    }
  }
  return true
}

function hasSupportedConstraintTypes(records: Uint32Array) {
  for (
    let offset = 0;
    offset < records.length;
    offset += SKETCH_SOLVER_ABI.constraintRecordStride
  ) {
    const type = records[offset + 2] as number
    if (type < 100_000 || type > 100_037) {
      return false
    }
  }
  return true
}

function collectHandles(records: Uint32Array, stride: number) {
  const handles = new Set<number>()
  for (let offset = 0; offset < records.length; offset += stride) {
    handles.add(records[offset] as number)
  }
  return handles
}

function hasValidReferences(system: {
  constraintRecords: Uint32Array
  draggedParameters: Uint32Array
  entityRecords: Uint32Array
  parameterMetadata: Uint32Array
}) {
  const parameterHandles = collectHandles(
    system.parameterMetadata,
    SKETCH_SOLVER_ABI.parameterMetadataStride,
  )
  const entityHandles = collectHandles(system.entityRecords, SKETCH_SOLVER_ABI.entityRecordStride)
  const containsEntity = (handle: number) => handle === 0 || entityHandles.has(handle)
  const containsParameter = (handle: number) => handle === 0 || parameterHandles.has(handle)

  for (
    let offset = 0;
    offset < system.entityRecords.length;
    offset += SKETCH_SOLVER_ABI.entityRecordStride
  ) {
    if (!system.entityRecords.slice(offset + 3, offset + 10).every(containsEntity)) {
      return false
    }
    if (!system.entityRecords.slice(offset + 10, offset + 14).every(containsParameter)) {
      return false
    }
  }
  for (
    let offset = 0;
    offset < system.constraintRecords.length;
    offset += SKETCH_SOLVER_ABI.constraintRecordStride
  ) {
    if (!system.constraintRecords.slice(offset + 3, offset + 10).every(containsEntity)) {
      return false
    }
  }
  return system.draggedParameters.every((handle) => parameterHandles.has(handle))
}

export const flatSketchSystemSchema = z
  .object({
    parameterMetadata: uint32ArraySchema,
    parameterValues: float64ArraySchema,
    entityRecords: uint32ArraySchema,
    constraintRecords: uint32ArraySchema,
    constraintValues: float64ArraySchema,
    draggedParameters: uint32ArraySchema,
    solveGroup: z.number().int().positive(),
    calculateFailedConstraints: z.boolean().default(true),
  })
  .strict()
  .refine(
    (system) =>
      system.parameterMetadata.length ===
      system.parameterValues.length * SKETCH_SOLVER_ABI.parameterMetadataStride,
    {
      message: "Parameter metadata does not match the parameter value count.",
      path: ["parameterMetadata"],
    },
  )
  .refine((system) => system.entityRecords.length % SKETCH_SOLVER_ABI.entityRecordStride === 0, {
    message: "Entity records do not align to the ABI stride.",
    path: ["entityRecords"],
  })
  .refine(
    (system) =>
      system.constraintRecords.length ===
      system.constraintValues.length * SKETCH_SOLVER_ABI.constraintRecordStride,
    {
      message: "Constraint records do not match the constraint value count.",
      path: ["constraintRecords"],
    },
  )
  .refine((system) => hasOnlyFiniteValues(system.parameterValues), {
    message: "Parameter values must be finite.",
    path: ["parameterValues"],
  })
  .refine((system) => hasOnlyFiniteValues(system.constraintValues), {
    message: "Constraint values must be finite.",
    path: ["constraintValues"],
  })
  .refine((system) => system.parameterValues.length <= SKETCH_SOLVER_ABI.maximumParameterCount, {
    message: "Sketch system exceeds the parameter safety limit.",
  })
  .refine(
    (system) =>
      system.entityRecords.length / SKETCH_SOLVER_ABI.entityRecordStride <=
      SKETCH_SOLVER_ABI.maximumEntityCount,
    { message: "Sketch system exceeds the entity safety limit." },
  )
  .refine((system) => system.constraintValues.length <= SKETCH_SOLVER_ABI.maximumConstraintCount, {
    message: "Sketch system exceeds the constraint safety limit.",
  })
  .refine((system) => system.draggedParameters.length <= system.parameterValues.length, {
    message: "Sketch system exceeds the dragged-parameter safety limit.",
  })
  .refine(
    (system) =>
      hasUniqueRecordHandles(system.parameterMetadata, SKETCH_SOLVER_ABI.parameterMetadataStride),
    { message: "Parameter handles must be nonzero and unique, and groups must be nonzero." },
  )
  .refine(
    (system) => hasUniqueRecordHandles(system.entityRecords, SKETCH_SOLVER_ABI.entityRecordStride),
    { message: "Entity handles must be nonzero and unique, and groups must be nonzero." },
  )
  .refine(
    (system) =>
      hasUniqueRecordHandles(system.constraintRecords, SKETCH_SOLVER_ABI.constraintRecordStride),
    { message: "Constraint handles must be nonzero and unique, and groups must be nonzero." },
  )
  .refine((system) => hasSupportedEntityTypes(system.entityRecords), {
    message: "Entity records contain an unsupported native type.",
  })
  .refine((system) => hasSupportedConstraintTypes(system.constraintRecords), {
    message: "Constraint records contain an unsupported native type.",
  })
  .refine((system) => hasValidReferences(system), {
    message: "Sketch system contains an unknown parameter or entity reference.",
  })

export type FlatSketchSystemInput = z.input<typeof flatSketchSystemSchema>
export type FlatSketchSystem = z.output<typeof flatSketchSystemSchema>

export interface NativeFlatSolveResult {
  abiStatus: number
  solverStatus: number
  degreesOfFreedom: number
  maximumResidual: number
  parameterValues: Float64Array
  failedConstraints: Uint32Array
}

export interface NativeSketchSolverModule {
  readonly PARAMETER_METADATA_STRIDE: number
  readonly ENTITY_RECORD_STRIDE: number
  readonly CONSTRAINT_RECORD_STRIDE: number
  solveFlatSystem(
    parameterMetadata: Uint32Array,
    parameterValues: Float64Array,
    entityRecords: Uint32Array,
    constraintRecords: Uint32Array,
    constraintValues: Float64Array,
    draggedParameters: Uint32Array,
    solveGroup: number,
    calculateFailedConstraints: boolean,
  ): NativeFlatSolveResult
  getHeapCapacityBytes(): number
}

export const nativeFlatSolveResultSchema = z
  .object({
    abiStatus: z.number().int(),
    solverStatus: z.number().int(),
    degreesOfFreedom: z.number().int(),
    maximumResidual: z.number().nonnegative(),
    parameterValues: float64ArraySchema,
    failedConstraints: uint32ArraySchema,
  })
  .strict()
