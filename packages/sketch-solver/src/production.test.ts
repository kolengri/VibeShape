import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
  variableIdSchema,
} from "@vibeshape/domain/identifiers"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { variableDefinitionsSchema } from "@vibeshape/domain/variables"
import { describe, expect, test, vi } from "vitest"
import {
  type NativeFlatSolveResult,
  type NativeSketchSolverModule,
  SKETCH_SOLVER_ABI,
  SOLVESPACE_CONSTRAINT_TYPE,
} from "./abi"
import { compileSketchSystem, solveSketchRecord } from "./production"

const sketchId = sketchIdSchema.parse("018f0000-0000-7000-8000-000000000001")
const pointA = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000002")
const pointB = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000003")
const lineId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000004")
const circleId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000005")
const distanceId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000006")
const radiusId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000007")
const fixedId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000008")
const variableId = variableIdSchema.parse("018f0000-0000-7000-8000-000000000009")

function sketch(distance = createLengthQuantity(10, "mm", "#width")) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Production solver fixture",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 1, y: 2, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 11, y: 2, construction: false },
      {
        schemaVersion: 0,
        id: lineId,
        type: "line",
        startPointId: pointA,
        endPointId: pointB,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: circleId,
        type: "circle",
        centerPointId: pointA,
        radius: 4,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: distanceId,
        type: "horizontal-distance",
        firstPointId: pointA,
        secondPointId: pointB,
        value: distance,
      },
      {
        schemaVersion: 0,
        id: radiusId,
        type: "radius",
        curveId: circleId,
        value: createLengthQuantity(4),
      },
      { schemaVersion: 0, id: fixedId, type: "fixed", pointId: pointA },
    ],
  })
}

const variables = variableDefinitionsSchema.parse([
  { schemaVersion: 0, id: variableId, name: "width", expression: "25 mm" },
])

function createModule(
  result: (values: Float64Array) => Partial<NativeFlatSolveResult> = () => ({}),
): NativeSketchSolverModule {
  return {
    PARAMETER_METADATA_STRIDE: SKETCH_SOLVER_ABI.parameterMetadataStride,
    ENTITY_RECORD_STRIDE: SKETCH_SOLVER_ABI.entityRecordStride,
    CONSTRAINT_RECORD_STRIDE: SKETCH_SOLVER_ABI.constraintRecordStride,
    solveFlatSystem: vi.fn(
      (
        _parameterMetadata,
        parameterValues,
        _entityRecords,
        _constraintRecords,
        _constraintValues,
      ) => ({
        abiStatus: 0,
        solverStatus: 0,
        degreesOfFreedom: 2,
        maximumResidual: 1e-10,
        parameterValues: parameterValues.slice(),
        failedConstraints: new Uint32Array(),
        ...result(parameterValues),
      }),
    ),
    getHeapCapacityBytes: () => 16 * 1024 * 1024,
  }
}

describe("production sketch compilation", () => {
  test("maps semantic records and resolved dimensions to the private flat ABI", () => {
    const result = compileSketchSystem({ revision: 4, sketch: sketch(), variables })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { constraintRecords, constraintValues, entityRecords } = result.compiled.system
    const constraintTypes = Array.from(
      { length: constraintValues.length },
      (_, index) => constraintRecords[index * SKETCH_SOLVER_ABI.constraintRecordStride + 2],
    )
    const entityTypes = Array.from(
      { length: entityRecords.length / SKETCH_SOLVER_ABI.entityRecordStride },
      (_, index) => entityRecords[index * SKETCH_SOLVER_ABI.entityRecordStride + 2],
    )

    expect(constraintTypes).toEqual([
      SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance,
      SOLVESPACE_CONSTRAINT_TYPE.diameter,
      SOLVESPACE_CONSTRAINT_TYPE.whereDragged,
    ])
    expect(constraintValues).toEqual(new Float64Array([25, 8, 0]))
    expect(entityTypes).toContain(80_000)
    expect(entityTypes).toContain(80_001)
    expect(result.compiled.system.solveGroup).toBe(2)
  })

  test("uses stable continuation values, applies drag targets last, and decodes stable IDs", () => {
    const compilation = compileSketchSystem({
      revision: 5,
      sketch: sketch(),
      variables,
      continuation: {
        schemaVersion: 0,
        sketchId,
        sourceRevision: 4,
        points: [
          { entityId: pointA, x: 5, y: 6 },
          { entityId: pointB, x: 30, y: 6 },
        ],
        circles: [{ entityId: circleId, radius: 7 }],
      },
      draggedPoints: [{ entityId: pointA, x: 8, y: 9 }],
    })
    expect(compilation.ok).toBe(true)
    if (!compilation.ok) return
    const pointBinding = compilation.compiled.bindings.pointParameters.get(pointA)
    const circleIndex = compilation.compiled.bindings.circleRadiusParameters.get(circleId)
    expect(pointBinding).toBeDefined()
    expect(circleIndex).toBeDefined()
    if (!pointBinding || circleIndex === undefined) return
    expect(compilation.compiled.system.parameterValues[pointBinding.xIndex]).toBe(8)
    expect(compilation.compiled.system.parameterValues[pointBinding.yIndex]).toBe(9)
    expect(compilation.compiled.system.parameterValues[circleIndex]).toBe(7)
    expect(compilation.compiled.system.draggedParameters).toHaveLength(2)

    const module = createModule((values) => {
      const solved = values.slice()
      solved[pointBinding.xIndex] = 10
      solved[pointBinding.yIndex] = 12
      solved[circleIndex] = 6
      return {
        solverStatus: 1,
        degreesOfFreedom: 0,
        parameterValues: solved,
        failedConstraints: new Uint32Array([1]),
      }
    })
    const solved = solveSketchRecord(module, {
      revision: 5,
      sketch: sketch(),
      variables,
      draggedPoints: [{ entityId: pointA, x: 8, y: 9 }],
    })
    expect(solved.ok).toBe(true)
    if (!solved.ok) return
    expect(solved.solution).toMatchObject({
      sketchId,
      sourceRevision: 5,
      status: "over-constrained",
      failedConstraintIds: [distanceId],
    })
    expect(solved.solution.points.find((point) => point.entityId === pointA)).toEqual({
      entityId: pointA,
      x: 10,
      y: 12,
    })
    expect(solved.solution.circles).toEqual([{ entityId: circleId, radius: 6 }])
  })

  test("rejects stale identity, future continuation, incompatible targets, and dimensions", () => {
    const wrongSketch = compileSketchSystem({
      revision: 5,
      sketch: sketch(),
      variables,
      continuation: {
        schemaVersion: 0,
        sketchId: "018f0000-0000-7000-8000-000000000099",
        sourceRevision: 4,
        points: [],
        circles: [],
      },
    })
    const future = compileSketchSystem({
      revision: 5,
      sketch: sketch(),
      variables,
      continuation: {
        schemaVersion: 0,
        sketchId,
        sourceRevision: 6,
        points: [],
        circles: [],
      },
    })
    const incompatibleDrag = compileSketchSystem({
      revision: 5,
      sketch: sketch(),
      variables,
      draggedPoints: [{ entityId: lineId, x: 1, y: 2 }],
    })
    const wrongDimension = compileSketchSystem({
      revision: 5,
      sketch: sketch(createLengthQuantity(1, "mm", "90 deg")),
      variables,
    })

    expect(wrongSketch).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-continuation" },
    })
    expect(future).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-continuation" },
    })
    expect(incompatibleDrag).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-continuation" },
    })
    expect(wrongDimension).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-dimension" },
    })
  })
})
