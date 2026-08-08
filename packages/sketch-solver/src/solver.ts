import {
  flatSketchSystemSchema,
  nativeFlatSolveResultSchema,
  SKETCH_SOLVER_ABI,
  type FlatSketchSystemInput,
  type NativeSketchSolverModule,
} from "./abi"

export type SketchSolveStatus =
  | "fully-constrained"
  | "under-constrained"
  | "over-constrained"
  | "failed"

export interface SketchSolveResult {
  status: SketchSolveStatus
  degreesOfFreedom: number
  maximumResidual: number
  parameterValues: Float64Array
  failedConstraintHandles: Uint32Array
  nativeStatus: number
  heapCapacityBytes: number
}

function assertCompatibleModule(module: NativeSketchSolverModule) {
  const nativeStrides = [
    module.PARAMETER_METADATA_STRIDE,
    module.ENTITY_RECORD_STRIDE,
    module.CONSTRAINT_RECORD_STRIDE,
  ]
  const expectedStrides = [
    SKETCH_SOLVER_ABI.parameterMetadataStride,
    SKETCH_SOLVER_ABI.entityRecordStride,
    SKETCH_SOLVER_ABI.constraintRecordStride,
  ]

  if (nativeStrides.some((value, index) => value !== expectedStrides[index])) {
    throw new Error("The native sketch solver ABI strides do not match the TypeScript adapter.")
  }
}

function mapSolveStatus(nativeStatus: number, degreesOfFreedom: number): SketchSolveStatus {
  switch (nativeStatus) {
    case 0:
      return degreesOfFreedom === 0 ? "fully-constrained" : "under-constrained"
    case 1:
    case 4:
      return "over-constrained"
    case 2:
    case 3:
      return "failed"
    default:
      throw new Error(`Unknown native sketch solver status: ${nativeStatus}.`)
  }
}

export function solveSketchSystem(
  module: NativeSketchSolverModule,
  input: FlatSketchSystemInput,
): SketchSolveResult {
  assertCompatibleModule(module)
  const system = flatSketchSystemSchema.parse(input)
  const nativeResult = nativeFlatSolveResultSchema.parse(
    module.solveFlatSystem(
      system.parameterMetadata,
      system.parameterValues,
      system.entityRecords,
      system.constraintRecords,
      system.constraintValues,
      system.draggedParameters,
      system.solveGroup,
      system.calculateFailedConstraints,
    ),
  )

  if (nativeResult.abiStatus !== 0) {
    throw new Error(`Native sketch solver rejected the flat ABI input: ${nativeResult.abiStatus}.`)
  }
  if (nativeResult.parameterValues.length !== system.parameterValues.length) {
    throw new Error("Native sketch solver returned an unexpected parameter count.")
  }

  return {
    status: mapSolveStatus(nativeResult.solverStatus, nativeResult.degreesOfFreedom),
    degreesOfFreedom: nativeResult.degreesOfFreedom,
    maximumResidual: nativeResult.maximumResidual,
    parameterValues: nativeResult.parameterValues,
    failedConstraintHandles: nativeResult.failedConstraints,
    nativeStatus: nativeResult.solverStatus,
    heapCapacityBytes: module.getHeapCapacityBytes(),
  }
}

export class SketchSolverSession {
  readonly #module: NativeSketchSolverModule
  #disposed = false

  constructor(module: NativeSketchSolverModule) {
    assertCompatibleModule(module)
    this.#module = module
  }

  solve(input: FlatSketchSystemInput) {
    if (this.#disposed) {
      throw new Error("Sketch solver session has been disposed.")
    }
    return solveSketchSystem(this.#module, input)
  }

  dispose() {
    this.#disposed = true
  }
}
