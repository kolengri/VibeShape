import {
  type FlatSketchSystemInput,
  SOLVESPACE_CONSTRAINT_TYPE,
  SOLVESPACE_ENTITY_TYPE,
} from "../packages/sketch-solver/src"

type EntityFields = Partial<{
  distance: number
  normal: number
  parameters: readonly number[]
  points: readonly number[]
  workplane: number
}>

type ConstraintFields = Partial<{
  entityA: number
  entityB: number
  entityC: number
  entityD: number
  other: number
  other2: number
  pointA: number
  pointB: number
  value: number
  workplane: number
}>

export interface LineFixture {
  system: FlatSketchSystemInput
  parameterHandles: {
    firstX: number
    firstY: number
    secondX: number
    secondY: number
  }
  constraintHandles: number[]
}

export interface ConstraintCoverageFixture {
  name: string
  constraintTypes: number[]
  system: FlatSketchSystemInput
}

export interface PointAlignmentConflictFixture {
  alignmentConstraintHandle: number
  system: FlatSketchSystemInput
}

class FlatSketchBuilder {
  readonly #parameterMetadata: number[] = []
  readonly #parameterValues: number[] = []
  readonly #entityRecords: number[] = []
  readonly #constraintRecords: number[] = []
  readonly #constraintValues: number[] = []
  #nextParameter = 11
  #nextEntity = 301
  #nextConstraint = 1

  constructor() {
    this.addParameter(0, 1, 1)
    this.addParameter(0, 1, 2)
    this.addParameter(0, 1, 3)
    this.addParameter(1, 1, 4)
    this.addParameter(0, 1, 5)
    this.addParameter(0, 1, 6)
    this.addParameter(0, 1, 7)
    this.addEntity(101, 1, SOLVESPACE_ENTITY_TYPE.pointIn3d, { parameters: [1, 2, 3] })
    this.addEntity(102, 1, SOLVESPACE_ENTITY_TYPE.normalIn3d, {
      parameters: [4, 5, 6, 7],
    })
    this.addEntity(200, 1, SOLVESPACE_ENTITY_TYPE.workplane, {
      normal: 102,
      points: [101],
    })
  }

  addParameter(value: number, group = 2, handle = this.#nextParameter++) {
    this.#parameterMetadata.push(handle, group)
    this.#parameterValues.push(value)
    return handle
  }

  addPoint(x: number, y: number) {
    const xParameter = this.addParameter(x)
    const yParameter = this.addParameter(y)
    const entity = this.#nextEntity++
    this.addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [xParameter, yParameter],
      workplane: 200,
    })
    return { entity, xParameter, yParameter }
  }

  addLine(first: number, second: number) {
    const entity = this.#nextEntity++
    this.addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.lineSegment, {
      points: [first, second],
      workplane: 200,
    })
    return entity
  }

  addDistance(value: number) {
    const parameter = this.addParameter(value)
    const entity = this.#nextEntity++
    this.addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.distance, {
      parameters: [parameter],
      workplane: 200,
    })
    return entity
  }

  addCircle(center: number, radius: number) {
    const entity = this.#nextEntity++
    this.addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.circle, {
      distance: radius,
      normal: 102,
      points: [center],
      workplane: 200,
    })
    return entity
  }

  addArc(center: number, start: number, end: number) {
    const entity = this.#nextEntity++
    this.addEntity(entity, 2, SOLVESPACE_ENTITY_TYPE.arcOfCircle, {
      normal: 102,
      points: [center, start, end],
      workplane: 200,
    })
    return entity
  }

  addReferenceAxis(direction: "horizontal" | "vertical") {
    const firstX = this.addParameter(0, 1)
    const firstY = this.addParameter(0, 1)
    const secondX = this.addParameter(direction === "horizontal" ? 1 : 0, 1)
    const secondY = this.addParameter(direction === "vertical" ? 1 : 0, 1)
    const first = this.#nextEntity++
    const second = this.#nextEntity++
    const line = this.#nextEntity++
    this.addEntity(first, 1, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [firstX, firstY],
      workplane: 200,
    })
    this.addEntity(second, 1, SOLVESPACE_ENTITY_TYPE.pointIn2d, {
      parameters: [secondX, secondY],
      workplane: 200,
    })
    this.addEntity(line, 1, SOLVESPACE_ENTITY_TYPE.lineSegment, {
      points: [first, second],
      workplane: 200,
    })
    return line
  }

  addEntity(handle: number, group: number, type: number, fields: EntityFields = {}) {
    const {
      distance = 0,
      normal = 0,
      parameters: sourceParameters = [],
      points: sourcePoints = [],
      workplane = 0,
    } = fields
    const points = [...sourcePoints, 0, 0, 0, 0].slice(0, 4)
    const parameters = [...sourceParameters, 0, 0, 0, 0].slice(0, 4)
    this.#entityRecords.push(
      handle,
      group,
      type,
      workplane,
      ...points,
      normal,
      distance,
      ...parameters,
    )
  }

  addConstraint(type: number, fields: ConstraintFields = {}) {
    const {
      entityA = 0,
      entityB = 0,
      entityC = 0,
      entityD = 0,
      other = 0,
      other2 = 0,
      pointA = 0,
      pointB = 0,
      value = 0,
      workplane = 200,
    } = fields
    const handle = this.#nextConstraint++
    this.#constraintRecords.push(
      handle,
      2,
      type,
      workplane,
      pointA,
      pointB,
      entityA,
      entityB,
      entityC,
      entityD,
      other,
      other2,
    )
    this.#constraintValues.push(value)
    return handle
  }

  build(draggedParameters: readonly number[] = []): FlatSketchSystemInput {
    return {
      parameterMetadata: new Uint32Array(this.#parameterMetadata),
      parameterValues: new Float64Array(this.#parameterValues),
      entityRecords: new Uint32Array(this.#entityRecords),
      constraintRecords: new Uint32Array(this.#constraintRecords),
      constraintValues: new Float64Array(this.#constraintValues),
      draggedParameters: new Uint32Array(draggedParameters),
      solveGroup: 2,
      calculateFailedConstraints: true,
    }
  }
}

export function createLineFixture(mode: "under" | "fully" | "over", perturbation = 0): LineFixture {
  const builder = new FlatSketchBuilder()
  const first = builder.addPoint(10 + perturbation, 20 - perturbation)
  const second = builder.addPoint(37 - perturbation, 28 + perturbation)
  const line = builder.addLine(first.entity, second.entity)
  const constraintHandles = [
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.horizontal, { entityA: line }),
  ]

  if (mode !== "under") {
    constraintHandles.push(
      builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance, {
        pointA: first.entity,
        pointB: second.entity,
        value: 30,
      }),
      builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.whereDragged, { pointA: first.entity }),
    )
  }
  if (mode === "over") {
    constraintHandles.push(
      builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance, {
        pointA: first.entity,
        pointB: second.entity,
        value: 40,
      }),
    )
  }

  return {
    system: builder.build([first.xParameter, first.yParameter]),
    parameterHandles: {
      firstX: first.xParameter,
      firstY: first.yParameter,
      secondX: second.xParameter,
      secondY: second.yParameter,
    },
    constraintHandles,
  }
}

function singleLineConstraintFixture(
  name: string,
  type: number,
  firstCoordinates: readonly [number, number],
  secondCoordinates: readonly [number, number],
): ConstraintCoverageFixture {
  const builder = new FlatSketchBuilder()
  const first = builder.addPoint(...firstCoordinates)
  const second = builder.addPoint(...secondCoordinates)
  const line = builder.addLine(first.entity, second.entity)
  builder.addConstraint(type, { entityA: line })
  return { name, constraintTypes: [type], system: builder.build() }
}

function twoLineConstraintFixture(
  name: string,
  type: number,
  coordinates: readonly [number, number, number, number, number, number, number, number],
  value = 0,
): ConstraintCoverageFixture {
  const builder = new FlatSketchBuilder()
  const firstA = builder.addPoint(coordinates[0], coordinates[1])
  const firstB = builder.addPoint(coordinates[2], coordinates[3])
  const secondA = builder.addPoint(coordinates[4], coordinates[5])
  const secondB = builder.addPoint(coordinates[6], coordinates[7])
  const firstLine = builder.addLine(firstA.entity, firstB.entity)
  const secondLine = builder.addLine(secondA.entity, secondB.entity)
  builder.addConstraint(type, { entityA: firstLine, entityB: secondLine, value })
  return { name, constraintTypes: [type], system: builder.build() }
}

export function createConstraintCoverageFixtures(): ConstraintCoverageFixture[] {
  const coincidence = (() => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(4, 7)
    const second = builder.addPoint(4.1, 6.9)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointsCoincident, {
      pointA: first.entity,
      pointB: second.entity,
    })
    return {
      name: "coincidence and concentric-center primitive",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.pointsCoincident],
      system: builder.build(),
    }
  })()

  const pointOnLine = (() => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(0, 0)
    const second = builder.addPoint(10, 0)
    const target = builder.addPoint(4, 0.2)
    const line = builder.addLine(first.entity, second.entity)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointOnLine, {
      pointA: target.entity,
      entityA: line,
    })
    return {
      name: "point on line",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.pointOnLine],
      system: builder.build(),
    }
  })()

  const pointOnCircle = (() => {
    const builder = new FlatSketchBuilder()
    const center = builder.addPoint(0, 0)
    const target = builder.addPoint(9.8, 0.4)
    const radius = builder.addDistance(10)
    const circle = builder.addCircle(center.entity, radius)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointOnCircle, {
      pointA: target.entity,
      entityA: circle,
    })
    return {
      name: "point on curve",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.pointOnCircle],
      system: builder.build(),
    }
  })()

  const midpoint = (() => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(0, 0)
    const second = builder.addPoint(10, 0)
    const target = builder.addPoint(4.9, 0.2)
    const line = builder.addLine(first.entity, second.entity)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.atMidpoint, {
      pointA: target.entity,
      entityA: line,
    })
    return {
      name: "point at midpoint",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.atMidpoint],
      system: builder.build(),
    }
  })()

  const symmetric = (() => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(-5, 2)
    const second = builder.addPoint(5.2, 2.1)
    const axis = builder.addReferenceAxis("vertical")
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.symmetricLine, {
      pointA: first.entity,
      pointB: second.entity,
      entityA: axis,
    })
    return {
      name: "points symmetric about line",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.symmetricLine],
      system: builder.build(),
    }
  })()

  const fixed = (() => {
    const builder = new FlatSketchBuilder()
    const point = builder.addPoint(6, 8)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.whereDragged, { pointA: point.entity })
    return {
      name: "fixed point",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.whereDragged],
      system: builder.build([point.xParameter, point.yParameter]),
    }
  })()

  const distance = (() => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(0, 0)
    const second = builder.addPoint(9, 5)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance, {
      pointA: first.entity,
      pointB: second.entity,
      value: 10,
    })
    return {
      name: "general distance",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.pointPointDistance],
      system: builder.build(),
    }
  })()

  const projectedDistances = (["horizontal", "vertical"] as const).map((direction) => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(1, 2)
    const second = builder.addPoint(9, 13)
    const axis = builder.addReferenceAxis(direction)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance, {
      pointA: first.entity,
      pointB: second.entity,
      entityA: axis,
      value: direction === "horizontal" ? 10 : 12,
      workplane: 0,
    })
    return {
      name: `${direction} distance`,
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance],
      system: builder.build(),
    }
  })

  const pointAlignments = (["horizontal", "vertical"] as const).map((direction) => {
    const builder = new FlatSketchBuilder()
    const first = builder.addPoint(1, 2)
    const second = builder.addPoint(9, 13)
    const axis = builder.addReferenceAxis(direction === "horizontal" ? "vertical" : "horizontal")
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance, {
      pointA: first.entity,
      pointB: second.entity,
      entityA: axis,
      value: 0,
      workplane: 0,
    })
    return {
      name: `${direction} point alignment`,
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance],
      system: builder.build(),
    }
  })

  const diameter = (() => {
    const builder = new FlatSketchBuilder()
    const center = builder.addPoint(0, 0)
    const radius = builder.addDistance(8)
    const circle = builder.addCircle(center.entity, radius)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.diameter, {
      entityA: circle,
      value: 20,
      workplane: 0,
    })
    return {
      name: "radius and diameter",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.diameter],
      system: builder.build(),
    }
  })()

  const tangent = (() => {
    const builder = new FlatSketchBuilder()
    const center = builder.addPoint(0, 0)
    const start = builder.addPoint(10, 0)
    const end = builder.addPoint(0, 10)
    const lineEnd = builder.addPoint(10.2, 10)
    const arc = builder.addArc(center.entity, start.entity, end.entity)
    const line = builder.addLine(start.entity, lineEnd.entity)
    builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.arcLineTangent, {
      entityA: arc,
      entityB: line,
      other: 0,
    })
    return {
      name: "tangent",
      constraintTypes: [SOLVESPACE_CONSTRAINT_TYPE.arcLineTangent],
      system: builder.build(),
    }
  })()

  return [
    coincidence,
    singleLineConstraintFixture(
      "horizontal",
      SOLVESPACE_CONSTRAINT_TYPE.horizontal,
      [0, 1],
      [10, 1.2],
    ),
    singleLineConstraintFixture("vertical", SOLVESPACE_CONSTRAINT_TYPE.vertical, [1, 0], [1.2, 10]),
    twoLineConstraintFixture(
      "parallel",
      SOLVESPACE_CONSTRAINT_TYPE.parallel,
      [0, 0, 10, 0, 0, 5, 9.8, 5.2],
    ),
    twoLineConstraintFixture(
      "perpendicular",
      SOLVESPACE_CONSTRAINT_TYPE.perpendicular,
      [0, 0, 10, 0, 0, 0, 0.2, 10],
    ),
    twoLineConstraintFixture(
      "equal length",
      SOLVESPACE_CONSTRAINT_TYPE.equalLengthLines,
      [0, 0, 10, 0, 0, 5, 9, 5],
    ),
    tangent,
    midpoint,
    symmetric,
    pointOnLine,
    pointOnCircle,
    fixed,
    distance,
    ...projectedDistances,
    ...pointAlignments,
    twoLineConstraintFixture(
      "angle",
      SOLVESPACE_CONSTRAINT_TYPE.angle,
      [0, 0, 10, 0, 0, 0, 7, 7.2],
      45,
    ),
    diameter,
  ]
}

export function createPointAlignmentConflictFixture(): PointAlignmentConflictFixture {
  const builder = new FlatSketchBuilder()
  const first = builder.addPoint(0, 0)
  const second = builder.addPoint(10, 5)
  builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.whereDragged, { pointA: first.entity })
  builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.whereDragged, { pointA: second.entity })
  const axis = builder.addReferenceAxis("vertical")
  const alignmentConstraintHandle = builder.addConstraint(
    SOLVESPACE_CONSTRAINT_TYPE.projectedPointDistance,
    {
      pointA: first.entity,
      pointB: second.entity,
      entityA: axis,
      value: 0,
      workplane: 0,
    },
  )
  return { alignmentConstraintHandle, system: builder.build() }
}

export function createDegenerateLineFixture(): FlatSketchSystemInput {
  const builder = new FlatSketchBuilder()
  const first = builder.addPoint(5, 5)
  const second = builder.addPoint(5, 5)
  const line = builder.addLine(first.entity, second.entity)
  builder.addConstraint(SOLVESPACE_CONSTRAINT_TYPE.horizontal, { entityA: line })
  return builder.build()
}
