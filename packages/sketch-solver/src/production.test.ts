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
  SOLVESPACE_ENTITY_TYPE,
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
const midpointId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000010")
const symmetricId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000011")
const pointC = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000012")
const pointD = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000013")
const offsetLineId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000014")
const offsetId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000015")
const secondSourceLineId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000016")
const secondOffsetLineId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000017")
const ellipseCenterId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000018")
const ellipsePrimaryId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000019")
const ellipseSecondaryId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000020")
const ellipseId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000021")
const ellipticalArcStartId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000022")
const ellipticalArcEndId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000023")
const ellipticalArcId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000024")
const primaryAxisDiameterId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000025")
const secondaryAxisDiameterId = sketchConstraintIdSchema.parse(
  "018f0000-0000-7000-8000-000000000026",
)
const secondEllipticalArcId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000027")

function sketch(distance = createLengthQuantity(10, "mm", "#width")) {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Production solver fixture",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: pointA, type: "point", x: 1, y: 2, construction: false },
      { schemaVersion: 0, id: pointB, type: "point", x: 11, y: 2, construction: false },
      { schemaVersion: 0, id: pointC, type: "point", x: 1, y: 7, construction: false },
      { schemaVersion: 0, id: pointD, type: "point", x: 11, y: 7, construction: false },
      {
        schemaVersion: 0,
        id: offsetLineId,
        type: "line",
        startPointId: pointC,
        endPointId: pointD,
        construction: false,
      },
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
        id: secondSourceLineId,
        type: "line",
        startPointId: pointB,
        endPointId: pointD,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: secondOffsetLineId,
        type: "line",
        startPointId: pointC,
        endPointId: pointA,
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
      { schemaVersion: 0, id: midpointId, type: "midpoint", pointId: pointA, lineId },
      {
        schemaVersion: 0,
        id: symmetricId,
        type: "symmetric",
        firstPointId: pointA,
        secondPointId: pointB,
        lineId,
      },
      { schemaVersion: 0, id: fixedId, type: "fixed", pointId: pointA },
      {
        schemaVersion: 0,
        id: offsetId,
        type: "offset",
        endpointPairs: [],
        linePairs: [
          { sourceLineId: lineId, offsetLineId, distanceScale: 1 },
          {
            sourceLineId: secondSourceLineId,
            offsetLineId: secondOffsetLineId,
            distanceScale: -1,
          },
        ],
        value: createLengthQuantity(-5),
      },
    ],
  })
}

function ellipseSketch() {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Ellipse solver fixture",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: ellipseCenterId,
        type: "point",
        x: 0,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipsePrimaryId,
        type: "point",
        x: 10,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipseSecondaryId,
        type: "point",
        x: 0,
        y: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipseId,
        type: "ellipse",
        centerPointId: ellipseCenterId,
        primaryAxisPointId: ellipsePrimaryId,
        secondaryAxisPointId: ellipseSecondaryId,
        construction: false,
      },
    ],
    constraints: [],
  })
}

function ellipticalArcSketch() {
  return sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchId,
    label: "Elliptical arc solver fixture",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: ellipseCenterId,
        type: "point",
        x: 0,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipsePrimaryId,
        type: "point",
        x: 10,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipseSecondaryId,
        type: "point",
        x: 0,
        y: 5,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipticalArcStartId,
        type: "point",
        x: 6,
        y: 4,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipticalArcEndId,
        type: "point",
        x: -10,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: ellipticalArcId,
        type: "elliptical-arc",
        centerPointId: ellipseCenterId,
        primaryAxisPointId: ellipsePrimaryId,
        secondaryAxisPointId: ellipseSecondaryId,
        startPointId: ellipticalArcStartId,
        endPointId: ellipticalArcEndId,
        construction: false,
      },
    ],
    constraints: [],
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
  test("compiles an ellipse as perpendicular solver-owned axis lines", () => {
    const result = compileSketchSystem({ revision: 4, sketch: ellipseSketch(), variables: [] })
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

    expect(entityTypes.filter((type) => type === SOLVESPACE_ENTITY_TYPE.lineSegment)).toHaveLength(
      2,
    )
    expect(constraintTypes).toEqual([SOLVESPACE_CONSTRAINT_TYPE.perpendicular])
    expect(constraintValues).toEqual(new Float64Array([0]))
    expect(result.compiled.bindings.constraintIdsByHandle.size).toBe(0)
  })

  test("compiles primary and secondary ellipse diameters as axis radii", () => {
    const fixture = ellipseSketch()
    const result = compileSketchSystem({
      revision: 4,
      sketch: {
        ...fixture,
        constraints: [
          {
            schemaVersion: 0,
            id: primaryAxisDiameterId,
            type: "primary-axis-diameter",
            curveId: ellipseId,
            value: createLengthQuantity(30),
          },
          {
            schemaVersion: 0,
            id: secondaryAxisDiameterId,
            type: "secondary-axis-diameter",
            curveId: ellipseId,
            value: createLengthQuantity(12),
          },
        ],
      },
      variables: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { constraintRecords, constraintValues } = result.compiled.system
    const constraintTypes = Array.from(
      { length: constraintValues.length },
      (_, index) => constraintRecords[index * SKETCH_SOLVER_ABI.constraintRecordStride + 2],
    )
    expect(constraintTypes).toEqual([
      SOLVESPACE_CONSTRAINT_TYPE.perpendicular,
      SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance,
      SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance,
    ])
    expect(constraintValues).toEqual(new Float64Array([0, 15, 6]))
    expect(Array.from(result.compiled.bindings.constraintIdsByHandle.values())).toEqual([
      primaryAxisDiameterId,
      secondaryAxisDiameterId,
    ])
  })

  test("compiles exact elliptical-arc endpoint loci through solver-owned trammels", () => {
    const result = compileSketchSystem({
      revision: 4,
      sketch: ellipticalArcSketch(),
      variables: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { constraintRecords, constraintValues, entityRecords, parameterValues } =
      result.compiled.system
    const constraintTypes = Array.from(
      { length: constraintValues.length },
      (_, index) => constraintRecords[index * SKETCH_SOLVER_ABI.constraintRecordStride + 2],
    )
    const entityTypes = Array.from(
      { length: entityRecords.length / SKETCH_SOLVER_ABI.entityRecordStride },
      (_, index) => entityRecords[index * SKETCH_SOLVER_ABI.entityRecordStride + 2],
    )

    expect(entityTypes.filter((type) => type === SOLVESPACE_ENTITY_TYPE.lineSegment)).toHaveLength(
      6,
    )
    expect(entityTypes.filter((type) => type === SOLVESPACE_ENTITY_TYPE.pointIn2d)).toHaveLength(9)
    expect(constraintTypes).toEqual([
      SOLVESPACE_CONSTRAINT_TYPE.perpendicular,
      SOLVESPACE_CONSTRAINT_TYPE.pointOnLine,
      SOLVESPACE_CONSTRAINT_TYPE.pointOnLine,
      SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines,
      SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines,
      SOLVESPACE_CONSTRAINT_TYPE.parallel,
      SOLVESPACE_CONSTRAINT_TYPE.pointOnLine,
      SOLVESPACE_CONSTRAINT_TYPE.pointOnLine,
      SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines,
      SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines,
      SOLVESPACE_CONSTRAINT_TYPE.parallel,
    ])
    expect(parameterValues).toHaveLength(25)
    expect(result.compiled.bindings.pointParameters.size).toBe(5)
    expect(result.compiled.bindings.constraintIdsByHandle.size).toBe(0)
  })

  test("shares solver-owned ellipse axes and endpoint loci across complementary arcs", () => {
    const fixture = ellipticalArcSketch()
    const source = fixture.entities.find((entity) => entity.type === "elliptical-arc")
    if (!source) throw new Error("The fixture requires one elliptical arc.")
    const result = compileSketchSystem({
      revision: 4,
      sketch: {
        ...fixture,
        entities: [
          ...fixture.entities,
          {
            ...source,
            id: secondEllipticalArcId,
            startPointId: source.endPointId,
            endPointId: source.startPointId,
          },
        ],
      },
      variables: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { constraintValues, entityRecords, parameterValues } = result.compiled.system
    const entityTypes = Array.from(
      { length: entityRecords.length / SKETCH_SOLVER_ABI.entityRecordStride },
      (_, index) => entityRecords[index * SKETCH_SOLVER_ABI.entityRecordStride + 2],
    )
    expect(entityTypes.filter((type) => type === SOLVESPACE_ENTITY_TYPE.lineSegment)).toHaveLength(
      6,
    )
    expect(entityTypes.filter((type) => type === SOLVESPACE_ENTITY_TYPE.pointIn2d)).toHaveLength(9)
    expect(constraintValues).toHaveLength(11)
    expect(parameterValues).toHaveLength(25)
    expect(result.compiled.bindings.constraintIdsByHandle.size).toBe(0)
  })

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
      SOLVESPACE_CONSTRAINT_TYPE.atMidpoint,
      SOLVESPACE_CONSTRAINT_TYPE.symmetricLine,
      SOLVESPACE_CONSTRAINT_TYPE.whereDragged,
      SOLVESPACE_CONSTRAINT_TYPE.parallel,
      SOLVESPACE_CONSTRAINT_TYPE.pointLineDistance,
      SOLVESPACE_CONSTRAINT_TYPE.parallel,
      SOLVESPACE_CONSTRAINT_TYPE.pointLineDistance,
    ])
    expect(constraintValues).toEqual(new Float64Array([25, 8, 0, 0, 0, 0, 5, 0, -5]))
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
    expect(solved.solution.profileResult).toMatchObject({
      profiles: [],
      diagnostics: [{ code: "invalid-solution" }],
    })
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

  test("compiles a fixed external line as a relationship target outside profile geometry", () => {
    const externalStartId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000201")
    const externalEndId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000202")
    const externalLineId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000203")
    const parallelId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8000-000000000204")
    const record = sketchRecordSchema.parse({
      ...sketch(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000205",
          kind: "line",
          sourceSketchId: "018f0000-0000-7000-8000-000000000206",
          sourceLineId: "018f0000-0000-7000-8000-000000000207",
          projectedLineId: externalLineId,
          projectedStartPointId: externalStartId,
          projectedEndPointId: externalEndId,
        },
      ],
      constraints: [
        ...sketch().constraints,
        {
          schemaVersion: 0,
          id: parallelId,
          type: "parallel",
          firstEntityId: lineId,
          secondEntityId: externalLineId,
        },
      ],
    })
    const result = compileSketchSystem({
      revision: 5,
      sketch: record,
      variables,
      externalLines: [
        {
          startPoint: {
            schemaVersion: 0,
            id: externalStartId,
            type: "point",
            x: 0,
            y: 20,
            construction: true,
          },
          endPoint: {
            schemaVersion: 0,
            id: externalEndId,
            type: "point",
            x: 20,
            y: 20,
            construction: true,
          },
          line: {
            schemaVersion: 0,
            id: externalLineId,
            type: "line",
            startPointId: externalStartId,
            endPointId: externalEndId,
            construction: true,
          },
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const constraintTypes: number[] = []
    for (
      let offset = 0;
      offset < result.compiled.system.constraintRecords.length;
      offset += SKETCH_SOLVER_ABI.constraintRecordStride
    ) {
      constraintTypes.push(result.compiled.system.constraintRecords[offset + 2] as number)
    }
    expect(constraintTypes).toContain(SOLVESPACE_CONSTRAINT_TYPE.parallel)
  })

  test("compiles a fixed external circle as an associative curve target", () => {
    const externalCenterId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000208")
    const externalCircleId = sketchEntityIdSchema.parse("018f0000-0000-7000-8000-000000000209")
    const record = sketchRecordSchema.parse({
      ...sketch(),
      externalReferences: [
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000210",
          kind: "curve",
          sourceSketchId: "018f0000-0000-7000-8000-000000000211",
          sourceEntityId: "018f0000-0000-7000-8000-000000000212",
          sourceType: "circle",
          projectedEntityId: externalCircleId,
          projectedType: "circle",
          projectedPointIds: [externalCenterId],
        },
      ],
      constraints: [
        ...sketch().constraints,
        {
          schemaVersion: 0,
          id: "018f0000-0000-7000-8000-000000000213",
          type: "point-on-curve",
          pointId: pointA,
          curveId: externalCircleId,
        },
      ],
    })
    const result = compileSketchSystem({
      revision: 5,
      sketch: record,
      variables,
      externalCurves: [
        {
          points: [
            {
              schemaVersion: 0,
              id: externalCenterId,
              type: "point",
              x: 12,
              y: 8,
              construction: true,
            },
          ],
          curve: {
            schemaVersion: 0,
            id: externalCircleId,
            type: "circle",
            centerPointId: externalCenterId,
            radius: 6,
            construction: true,
          },
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const constraintTypes: number[] = []
    for (
      let offset = 0;
      offset < result.compiled.system.constraintRecords.length;
      offset += SKETCH_SOLVER_ABI.constraintRecordStride
    ) {
      constraintTypes.push(result.compiled.system.constraintRecords[offset + 2] as number)
    }
    expect(constraintTypes).toContain(SOLVESPACE_CONSTRAINT_TYPE.diameter)
    expect(constraintTypes).toContain(SOLVESPACE_CONSTRAINT_TYPE.pointOnCircle)
  })
})
