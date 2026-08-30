import { describe, expect, test, vi } from "vitest"
import {
  type FlatSketchSystemInput,
  type NativeFlatSolveResult,
  type NativeSketchSolverModule,
  SKETCH_SOLVER_ABI,
  SOLVESPACE_CONSTRAINT_TYPE,
  SOLVESPACE_ENTITY_TYPE,
} from "./abi"
import { SketchSolverSession, solveSketchSystem } from "./solver"

const emptySystem: FlatSketchSystemInput = {
  parameterMetadata: new Uint32Array(),
  parameterValues: new Float64Array(),
  entityRecords: new Uint32Array(),
  constraintRecords: new Uint32Array(),
  constraintValues: new Float64Array(),
  draggedParameters: new Uint32Array(),
  solveGroup: 2,
}

function createModule(result: Partial<NativeFlatSolveResult> = {}): NativeSketchSolverModule {
  return {
    PARAMETER_METADATA_STRIDE: SKETCH_SOLVER_ABI.parameterMetadataStride,
    ENTITY_RECORD_STRIDE: SKETCH_SOLVER_ABI.entityRecordStride,
    CONSTRAINT_RECORD_STRIDE: SKETCH_SOLVER_ABI.constraintRecordStride,
    solveFlatSystem: vi.fn(() => ({
      abiStatus: 0,
      solverStatus: 0,
      degreesOfFreedom: 0,
      maximumResidual: 1e-12,
      parameterValues: new Float64Array(),
      failedConstraints: new Uint32Array(),
      ...result,
    })),
    getHeapCapacityBytes: () => 16 * 1024 * 1024,
  }
}

describe("solveSketchSystem", () => {
  test.each([
    [0, 0, "fully-constrained"],
    [0, 3, "under-constrained"],
    [1, 0, "over-constrained"],
    [4, 0, "over-constrained"],
    [2, 0, "failed"],
    [3, 0, "failed"],
  ] as const)("maps native status %i with %i DOF", (solverStatus, degreesOfFreedom, status) => {
    const module = createModule({ solverStatus, degreesOfFreedom })
    expect(solveSketchSystem(module, emptySystem).status).toBe(status)
  })

  test("rejects a malformed typed-array layout before calling native code", () => {
    const module = createModule()
    const invalidSystem = { ...emptySystem, entityRecords: new Uint32Array(1) }

    expect(() => solveSketchSystem(module, invalidSystem)).toThrow(/Entity records/)
    expect(module.solveFlatSystem).not.toHaveBeenCalled()
  })

  test("rejects incompatible native ABI strides", () => {
    const module = { ...createModule(), ENTITY_RECORD_STRIDE: 15 }
    expect(() => solveSketchSystem(module, emptySystem)).toThrow(/ABI strides/)
  })

  test("accepts the bounded elliptical-arc half-plane native constraint type", () => {
    const module = createModule()
    const system = {
      ...emptySystem,
      entityRecords: new Uint32Array([
        1,
        1,
        SOLVESPACE_ENTITY_TYPE.workplane,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        1,
        SOLVESPACE_ENTITY_TYPE.pointIn2d,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        3,
        1,
        SOLVESPACE_ENTITY_TYPE.pointIn2d,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        4,
        1,
        SOLVESPACE_ENTITY_TYPE.pointIn2d,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
      constraintRecords: new Uint32Array([
        1,
        2,
        SOLVESPACE_CONSTRAINT_TYPE.pointInOrientedChordHalfPlane,
        1,
        2,
        3,
        4,
        0,
        0,
        0,
        0,
        0,
      ]),
      constraintValues: new Float64Array([0]),
    }

    solveSketchSystem(module, system)
    expect(module.solveFlatSystem).toHaveBeenCalledOnce()
  })

  test("rejects a malformed bounded elliptical-arc half-plane record before native code", () => {
    const module = createModule()
    const system = {
      ...emptySystem,
      constraintRecords: new Uint32Array([
        1,
        2,
        SOLVESPACE_CONSTRAINT_TYPE.pointInOrientedChordHalfPlane,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
      constraintValues: new Float64Array([0]),
    }

    expect(() => solveSketchSystem(module, system)).toThrow(/reviewed ABI shape/)
    expect(module.solveFlatSystem).not.toHaveBeenCalled()
  })

  test("rejects native constraint types beyond the reviewed range", () => {
    const module = createModule()
    const system = {
      ...emptySystem,
      constraintRecords: new Uint32Array([1, 2, 100_039, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      constraintValues: new Float64Array([0]),
    }

    expect(() => solveSketchSystem(module, system)).toThrow(/unsupported native type/)
    expect(module.solveFlatSystem).not.toHaveBeenCalled()
  })

  test("rejects non-finite input before crossing the native boundary", () => {
    const module = createModule()
    const invalidSystem = {
      ...emptySystem,
      parameterMetadata: new Uint32Array([1, 2]),
      parameterValues: new Float64Array([Number.NaN]),
    }

    expect(() => solveSketchSystem(module, invalidSystem)).toThrow(/Parameter values/)
    expect(module.solveFlatSystem).not.toHaveBeenCalled()
  })

  test("rejects duplicate handles and unknown references before native code", () => {
    const module = createModule()
    const duplicateParameters = {
      ...emptySystem,
      parameterMetadata: new Uint32Array([11, 2, 11, 2]),
      parameterValues: new Float64Array([0, 1]),
    }
    const unknownDraggedParameter = {
      ...emptySystem,
      draggedParameters: new Uint32Array([99]),
    }

    expect(() => solveSketchSystem(module, duplicateParameters)).toThrow(/unique/)
    expect(() => solveSketchSystem(module, unknownDraggedParameter)).toThrow(/unknown/)
    expect(module.solveFlatSystem).not.toHaveBeenCalled()
  })

  test("prevents use after a stateless session is disposed", () => {
    const session = new SketchSolverSession(createModule())
    session.dispose()
    expect(() => session.solve(emptySystem)).toThrow(/disposed/)
  })
})
