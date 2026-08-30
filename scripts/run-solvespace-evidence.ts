import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  type SketchEntityId,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../packages/domain/src/identifiers"
import { type SketchRecord, sketchRecordSchema } from "../packages/domain/src/sketch"
import {
  type CompiledSketchSystem,
  compileSketchSystem,
  type FlatSketchSystemInput,
  type NativeSketchSolverModule,
  type SketchSolveResult,
  SketchSolverSession,
} from "../packages/sketch-solver/src"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"
import {
  createConstraintCoverageFixtures,
  createDegenerateLineFixture,
  createLineFixture,
  createPointAlignmentConflictFixture,
} from "./solvespace-fixtures"

interface SolveSpaceFactoryModule {
  default(options?: { locateFile?: (file: string) => string }): Promise<NativeSketchSolverModule>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "solvespace-build")
const outputRoot = join(artifactRoot, "output")
const modulePath = join(outputRoot, SOLVESPACE_BUILD_INPUTS.outputModule)

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function loadNativeModule() {
  if (!existsSync(modulePath)) {
    throw new Error("Run `bun run solvespace:build` before collecting solver evidence.")
  }

  const imported = (await import(pathToFileURL(modulePath).href)) as SolveSpaceFactoryModule
  return imported.default({ locateFile: (file) => join(outputRoot, file) })
}

function distance(values: Float64Array) {
  const firstX = values[7] as number
  const firstY = values[8] as number
  const secondX = values[9] as number
  const secondY = values[10] as number
  return Math.hypot(secondX - firstX, secondY - firstY)
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? Number.NaN
}

function perturbSystem(system: FlatSketchSystemInput, seed: number): FlatSketchSystemInput {
  const parameterValues = new Float64Array(system.parameterValues)
  let state = seed >>> 0
  for (let index = 0; index < parameterValues.length; index += 1) {
    const group = system.parameterMetadata[index * 2 + 1]
    if (group !== 2) {
      continue
    }
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    parameterValues[index] = (parameterValues[index] ?? 0) + (state / 0xffff_ffff - 0.5) * 0.1
  }
  return { ...system, parameterValues }
}

const successfulStatuses = new Set(["fully-constrained", "under-constrained"])

function requireSuccessfulSolve(result: SketchSolveResult, fixtureName: string) {
  requireCondition(
    successfulStatuses.has(result.status),
    `${fixtureName} failed with ${result.status}.`,
  )
  requireCondition(result.maximumResidual <= 1e-7, `${fixtureName} residual exceeded tolerance.`)
}

function solvedProductionPoint(
  compilation: CompiledSketchSystem,
  result: SketchSolveResult,
  id: SketchEntityId,
  fixtureName: string,
) {
  const binding = compilation.bindings.pointParameters.get(id)
  requireCondition(binding, `${fixtureName} point binding was missing.`)
  return {
    x: Number(result.parameterValues[binding.xIndex]),
    y: Number(result.parameterValues[binding.yIndex]),
  }
}

function solveProductionSketch(
  session: SketchSolverSession,
  sketch: SketchRecord,
  fixtureName: string,
) {
  const compilation = compileSketchSystem({ revision: 1, sketch, variables: [] })
  requireCondition(compilation.ok, `${fixtureName} production compilation failed.`)
  const result = session.solve(compilation.compiled.system)
  requireSuccessfulSolve(result, fixtureName)
  return {
    point: (id: SketchEntityId) =>
      solvedProductionPoint(compilation.compiled, result, id, fixtureName),
    result,
  }
}

function solveNative(module: NativeSketchSolverModule, system: FlatSketchSystemInput) {
  return module.solveFlatSystem(
    system.parameterMetadata,
    system.parameterValues,
    system.entityRecords,
    system.constraintRecords,
    system.constraintValues,
    system.draggedParameters,
    system.solveGroup,
    system.calculateFailedConstraints ?? true,
  )
}

function runAbiRejectionEvidence(module: NativeSketchSolverModule) {
  const base = createLineFixture("under").system
  const duplicateMetadata = new Uint32Array(base.parameterMetadata)
  duplicateMetadata[2] = duplicateMetadata[0] as number
  const unknownEntityType = new Uint32Array(base.entityRecords)
  unknownEntityType[2] = 42

  const results = {
    duplicateHandle: solveNative(module, { ...base, parameterMetadata: duplicateMetadata })
      .abiStatus,
    unknownEntityType: solveNative(module, { ...base, entityRecords: unknownEntityType }).abiStatus,
    unknownReference: solveNative(module, {
      ...base,
      draggedParameters: new Uint32Array([99_999]),
    }).abiStatus,
  }
  requireCondition(results.duplicateHandle === -5, "Native ABI accepted a duplicate handle.")
  requireCondition(results.unknownEntityType === -6, "Native ABI accepted an unknown entity type.")
  requireCondition(results.unknownReference === -4, "Native ABI accepted an unknown reference.")
  return results
}

function runStatusEvidence(session: SketchSolverSession) {
  const under = session.solve(createLineFixture("under").system)
  requireCondition(
    under.status === "under-constrained",
    "Under-constrained fixture was misclassified.",
  )

  const fully = session.solve(createLineFixture("fully").system)
  requireCondition(
    fully.status === "fully-constrained",
    "Fully constrained fixture was misclassified.",
  )
  requireCondition(fully.maximumResidual <= 1e-7, "Fully constrained residual exceeded tolerance.")
  requireCondition(Math.abs(distance(fully.parameterValues) - 30) <= 1e-7, "Distance drifted.")

  const over = session.solve(createLineFixture("over").system)
  requireCondition(
    over.status === "over-constrained",
    "Over-constrained fixture was misclassified.",
  )
  requireCondition(over.failedConstraintHandles.length > 0, "Conflict set was empty.")
  return { fully, over, under }
}

function runPointAlignmentConflictEvidence(session: SketchSolverSession) {
  const fixture = createPointAlignmentConflictFixture()
  const result = session.solve(fixture.system)
  requireCondition(result.status === "over-constrained", "Point alignment conflict was not found.")
  requireCondition(
    result.failedConstraintHandles.includes(fixture.alignmentConstraintHandle),
    "Point alignment handle was missing from the conflict set.",
  )
  return result
}

const productionPointAlignmentFixtures = [
  {
    constraintId: "018f0000-0000-7000-8000-000000000107",
    coordinate: "yIndex",
    firstPointId: "018f0000-0000-7000-8000-000000000101",
    label: "Horizontal alignment evidence",
    secondPointId: "018f0000-0000-7000-8000-000000000103",
    sketchId: "018f0000-0000-7000-8000-000000000105",
    type: "horizontal-points",
  },
  {
    constraintId: "018f0000-0000-7000-8000-000000000108",
    coordinate: "xIndex",
    firstPointId: "018f0000-0000-7000-8000-000000000102",
    label: "Vertical alignment evidence",
    secondPointId: "018f0000-0000-7000-8000-000000000104",
    sketchId: "018f0000-0000-7000-8000-000000000106",
    type: "vertical-points",
  },
] as const

function productionPointAlignmentSketch(
  fixture: (typeof productionPointAlignmentFixtures)[number],
) {
  const firstPointId = sketchEntityIdSchema.parse(fixture.firstPointId)
  const secondPointId = sketchEntityIdSchema.parse(fixture.secondPointId)
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchIdSchema.parse(fixture.sketchId),
    label: fixture.label,
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: firstPointId,
        type: "point",
        x: 1,
        y: 2,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: secondPointId,
        type: "point",
        x: 9,
        y: 13,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: sketchConstraintIdSchema.parse(fixture.constraintId),
        type: fixture.type,
        firstPointId,
        secondPointId,
      },
    ],
  })
  return { firstPointId, secondPointId, sketch }
}

function solveProductionPointAlignment(
  session: SketchSolverSession,
  fixture: (typeof productionPointAlignmentFixtures)[number],
) {
  const { firstPointId, secondPointId, sketch } = productionPointAlignmentSketch(fixture)
  const compilation = compileSketchSystem({ revision: 1, sketch, variables: [] })
  requireCondition(compilation.ok, `${fixture.type} production compilation failed.`)
  const result = session.solve(compilation.compiled.system)
  requireSuccessfulSolve(result, `${fixture.type} production solve`)
  const first = compilation.compiled.bindings.pointParameters.get(firstPointId)
  const second = compilation.compiled.bindings.pointParameters.get(secondPointId)
  requireCondition(first && second, `${fixture.type} production point bindings were missing.`)
  requireCondition(
    Math.abs(
      Number(result.parameterValues[first[fixture.coordinate]]) -
        Number(result.parameterValues[second[fixture.coordinate]]),
    ) <= 1e-7,
    `${fixture.type} production solve used the wrong projected axis.`,
  )
  return { type: fixture.type, status: result.status }
}

function runProductionPointAlignmentEvidence(session: SketchSolverSession) {
  return productionPointAlignmentFixtures.map((fixture) =>
    solveProductionPointAlignment(session, fixture),
  )
}

const productionArcMidpointFixtures = [
  {
    end: { x: 0, y: 10 },
    label: "Opposite-seeded quarter arc midpoint evidence",
    midpoint: { x: -Math.SQRT1_2 * 10, y: -Math.SQRT1_2 * 10 },
    suffix: "201",
  },
  {
    end: { x: -10, y: 0 },
    label: "Endpoint-edited semicircle midpoint evidence",
    midpoint: { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 },
    suffix: "202",
  },
] as const

function positiveAngle(angle: number) {
  const fullTurn = Math.PI * 2
  const normalized = angle % fullTurn
  return normalized >= 0 ? normalized : normalized + fullTurn
}

function solveProductionArcMidpoint(
  session: SketchSolverSession,
  fixture: (typeof productionArcMidpointFixtures)[number],
) {
  const pointIds = ["1", "2", "3", "4"].map((ordinal) =>
    sketchEntityIdSchema.parse(
      `018f0000-0000-7000-82${fixture.suffix.slice(-1)}0-${ordinal.padStart(12, "0")}`,
    ),
  )
  const [centerPointId, startPointId, endPointId, midpointPointId] = pointIds
  requireCondition(
    centerPointId && startPointId && endPointId && midpointPointId,
    "Arc midpoint evidence IDs were not created.",
  )
  const arcId = sketchEntityIdSchema.parse(
    `018f0000-0000-7000-82${fixture.suffix.slice(-1)}0-000000000005`,
  )
  const constraintId = sketchConstraintIdSchema.parse(
    `018f0000-0000-7000-82${fixture.suffix.slice(-1)}0-000000000006`,
  )
  const sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: sketchIdSchema.parse(`018f0000-0000-7000-82${fixture.suffix.slice(-1)}0-000000000007`),
    label: fixture.label,
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: centerPointId,
        type: "point",
        x: 0,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: startPointId,
        type: "point",
        x: 10,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: endPointId,
        type: "point",
        ...fixture.end,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: midpointPointId,
        type: "point",
        ...fixture.midpoint,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: arcId,
        type: "arc",
        centerPointId,
        startPointId,
        endPointId,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: constraintId,
        type: "arc-midpoint",
        pointId: midpointPointId,
        arcId,
      },
    ],
  })
  const { point: solvedPoint, result } = solveProductionSketch(session, sketch, fixture.label)
  const center = solvedPoint(centerPointId)
  const start = solvedPoint(startPointId)
  const end = solvedPoint(endPointId)
  const midpoint = solvedPoint(midpointPointId)
  const angle = (point: { x: number; y: number }) =>
    Math.atan2(point.y - center.y, point.x - center.x)
  const expectedHalfSweep = positiveAngle(angle(end) - angle(start)) / 2
  const actualMidpointSweep = positiveAngle(angle(midpoint) - angle(start))
  requireCondition(
    Math.abs(actualMidpointSweep - expectedHalfSweep) <= 1e-7,
    `${fixture.label} did not preserve the positive-sweep arc midpoint.`,
  )
  return { label: fixture.label, status: result.status, midpoint }
}

function runProductionArcMidpointEvidence(session: SketchSolverSession) {
  return productionArcMidpointFixtures.map((fixture) =>
    solveProductionArcMidpoint(session, fixture),
  )
}

function runProductionEllipseQuadrantEvidence(session: SketchSolverSession) {
  const centerPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8300-000000000001")
  const primaryAxisPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8300-000000000002")
  const secondaryAxisPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8300-000000000003")
  const quadrantPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8300-000000000004")
  const ellipseId = sketchEntityIdSchema.parse("018f0000-0000-7000-8300-000000000005")
  const constraintId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8300-000000000006")
  const fixtures = [
    {
      axis: "primary",
      label: "Axis-inverted positive-primary ellipse quadrant evidence",
      point: { x: 9, y: 1 },
      primary: { x: -6, y: -8 },
      secondary: { x: 4, y: -3 },
      side: "positive",
    },
    {
      axis: "primary",
      label: "Rotated negative-primary ellipse quadrant evidence",
      point: { x: -9, y: 1 },
      primary: { x: 6, y: 8 },
      secondary: { x: -4, y: 3 },
      side: "negative",
    },
    {
      axis: "secondary",
      label: "Rotated positive-secondary ellipse quadrant evidence",
      point: { x: 2, y: 5 },
      primary: { x: 6, y: 8 },
      secondary: { x: -4, y: 3 },
      side: "positive",
    },
    {
      axis: "secondary",
      label: "Rotated negative-secondary ellipse quadrant evidence",
      point: { x: -2, y: -5 },
      primary: { x: 6, y: 8 },
      secondary: { x: -4, y: 3 },
      side: "negative",
    },
  ] as const
  return fixtures.map((fixture) => {
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchIdSchema.parse("018f0000-0000-7000-8300-000000000007"),
      label: fixture.label,
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: centerPointId,
          type: "point",
          x: 0,
          y: 0,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: primaryAxisPointId,
          type: "point",
          ...fixture.primary,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: secondaryAxisPointId,
          type: "point",
          ...fixture.secondary,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: quadrantPointId,
          type: "point",
          ...fixture.point,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: ellipseId,
          type: "ellipse",
          centerPointId,
          primaryAxisPointId,
          secondaryAxisPointId,
          construction: false,
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId,
          type: "ellipse-quadrant",
          pointId: quadrantPointId,
          ellipseId,
          axis: fixture.axis,
          side: fixture.side,
        },
      ],
    })
    const { point: solvedPoint, result } = solveProductionSketch(session, sketch, fixture.label)
    const center = solvedPoint(centerPointId)
    const axisPoint = solvedPoint(
      fixture.axis === "primary" ? primaryAxisPointId : secondaryAxisPointId,
    )
    const quadrant = solvedPoint(quadrantPointId)
    const axis = { x: axisPoint.x - center.x, y: axisPoint.y - center.y }
    const offset = { x: quadrant.x - center.x, y: quadrant.y - center.y }
    const cross = axis.x * offset.y - axis.y * offset.x
    const dot = axis.x * offset.x + axis.y * offset.y
    requireCondition(Math.abs(cross) <= 1e-7, `${fixture.label} left its selected axis.`)
    requireCondition(
      fixture.side === "positive" ? dot > 0 : dot < 0,
      `${fixture.label} switched to the opposite side.`,
    )
    requireCondition(
      Math.abs(Math.hypot(offset.x, offset.y) - Math.hypot(axis.x, axis.y)) <= 1e-7,
      `${fixture.label} left the exact selected-axis radius.`,
    )
    return {
      axis: fixture.axis,
      label: fixture.label,
      quadrant,
      side: fixture.side,
      status: result.status,
    }
  })
}

function ellipseLocusInvariant(
  center: { x: number; y: number },
  primaryPoint: { x: number; y: number },
  secondaryPoint: { x: number; y: number },
  locusPoint: { x: number; y: number },
) {
  const primary = { x: primaryPoint.x - center.x, y: primaryPoint.y - center.y }
  const secondary = { x: secondaryPoint.x - center.x, y: secondaryPoint.y - center.y }
  const offset = { x: locusPoint.x - center.x, y: locusPoint.y - center.y }
  const primaryRadius = Math.hypot(primary.x, primary.y)
  const secondaryRadius = Math.hypot(secondary.x, secondary.y)
  requireCondition(primaryRadius > 0 && secondaryRadius > 0, "Solved ellipse axes degenerated.")
  const primaryCoordinate = (offset.x * primary.x + offset.y * primary.y) / primaryRadius
  const secondaryCoordinate = (offset.x * secondary.x + offset.y * secondary.y) / secondaryRadius
  return (
    (primaryCoordinate * primaryCoordinate) / (primaryRadius * primaryRadius) +
    (secondaryCoordinate * secondaryCoordinate) / (secondaryRadius * secondaryRadius)
  )
}

function runProductionEllipseLocusEvidence(session: SketchSolverSession) {
  const centerPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8310-000000000001")
  const primaryAxisPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8310-000000000002")
  const secondaryAxisPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8310-000000000003")
  const locusPointId = sketchEntityIdSchema.parse("018f0000-0000-7000-8310-000000000004")
  const ellipseId = sketchEntityIdSchema.parse("018f0000-0000-7000-8310-000000000005")
  const constraintId = sketchConstraintIdSchema.parse("018f0000-0000-7000-8310-000000000006")
  const fixtures = [
    {
      label: "Rotated primary-major ellipse locus evidence",
      point: { x: 5, y: 2 },
      primary: { x: 6, y: 8 },
      secondary: { x: -4, y: 3 },
    },
    {
      label: "Rotated secondary-major ellipse locus evidence",
      point: { x: -2, y: 7 },
      primary: { x: 3, y: 4 },
      secondary: { x: -8, y: 6 },
    },
    {
      label: "Axis-inverted ellipse locus evidence",
      point: { x: -7, y: -1 },
      primary: { x: -6, y: -8 },
      secondary: { x: 4, y: -3 },
    },
  ] as const
  return fixtures.map((fixture, index) => {
    const sketch = sketchRecordSchema.parse({
      schemaVersion: 0,
      id: sketchIdSchema.parse(`018f0000-0000-7000-8310-${String(index + 7).padStart(12, "0")}`),
      label: fixture.label,
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: centerPointId,
          type: "point",
          x: 0,
          y: 0,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: primaryAxisPointId,
          type: "point",
          ...fixture.primary,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: secondaryAxisPointId,
          type: "point",
          ...fixture.secondary,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: locusPointId,
          type: "point",
          ...fixture.point,
          construction: false,
        },
        {
          schemaVersion: 0,
          id: ellipseId,
          type: "ellipse",
          centerPointId,
          primaryAxisPointId,
          secondaryAxisPointId,
          construction: false,
        },
      ],
      constraints: [
        {
          schemaVersion: 0,
          id: constraintId,
          type: "point-on-ellipse",
          pointId: locusPointId,
          ellipseId,
        },
      ],
    })
    const { point: solvedPoint, result } = solveProductionSketch(session, sketch, fixture.label)
    const invariant = ellipseLocusInvariant(
      solvedPoint(centerPointId),
      solvedPoint(primaryAxisPointId),
      solvedPoint(secondaryAxisPointId),
      solvedPoint(locusPointId),
    )
    requireCondition(
      Math.abs(invariant - 1) <= 1e-7,
      `${fixture.label} left the exact full-ellipse locus.`,
    )
    return { invariant, label: fixture.label, status: result.status }
  })
}

function requirePointAlignmentCoordinates(name: string, parameterValues: ArrayLike<number>) {
  if (name === "horizontal point alignment") {
    requireCondition(
      Math.abs(Number(parameterValues[8]) - Number(parameterValues[10])) <= 1e-7,
      "Horizontal point alignment did not solve equal Y coordinates.",
    )
  }
  if (name === "vertical point alignment") {
    requireCondition(
      Math.abs(Number(parameterValues[7]) - Number(parameterValues[9])) <= 1e-7,
      "Vertical point alignment did not solve equal X coordinates.",
    )
  }
}

function runCoverageEvidence(session: SketchSolverSession) {
  const fixtures = createConstraintCoverageFixtures()
  const results = fixtures.map((fixture) => {
    const result = session.solve(fixture.system)
    requireSuccessfulSolve(result, fixture.name)
    requirePointAlignmentCoordinates(fixture.name, result.parameterValues)
    return {
      name: fixture.name,
      constraintTypes: fixture.constraintTypes,
      status: result.status,
      maximumResidual: result.maximumResidual,
    }
  })
  return { fixtures, results }
}

function runConstraintPerturbations(
  session: SketchSolverSession,
  fixtures: ReturnType<typeof createConstraintCoverageFixtures>,
) {
  let maximumResidual = 0
  for (const fixture of fixtures) {
    for (let index = 0; index < 100; index += 1) {
      const result = session.solve(perturbSystem(fixture.system, index + 1))
      requireSuccessfulSolve(result, `${fixture.name} perturbation ${index}`)
      maximumResidual = Math.max(maximumResidual, result.maximumResidual)
    }
  }
  requireCondition(maximumResidual > 0, "Residual capture did not observe a solved equation error.")
  return maximumResidual
}

function runCanonicalLinePerturbations(session: SketchSolverSession) {
  let maximumResidual = 0
  for (let index = 0; index < 100; index += 1) {
    const perturbation = ((index * 37) % 101) / 10 - 5
    const result = session.solve(createLineFixture("fully", perturbation).system)
    requireCondition(result.status === "fully-constrained", `Perturbation ${index} did not solve.`)
    requireCondition(Math.abs(distance(result.parameterValues) - 30) <= 1e-7, "Distance drifted.")
    maximumResidual = Math.max(maximumResidual, result.maximumResidual)
  }
  return maximumResidual
}

function runLifecycleEvidence(
  nativeModule: NativeSketchSolverModule,
  session: SketchSolverSession,
) {
  const heapBeforeBytes = nativeModule.getHeapCapacityBytes()
  const solveTimes: number[] = []
  for (let index = 0; index < 1_000; index += 1) {
    const cycle = new SketchSolverSession(nativeModule)
    const solveStartedAt = performance.now()
    const result = cycle.solve(createLineFixture("fully", (index % 17) / 100).system)
    solveTimes.push(performance.now() - solveStartedAt)
    requireCondition(result.status === "fully-constrained", `Lifecycle cycle ${index} failed.`)
    cycle.dispose()
  }
  const heapAfterBytes = nativeModule.getHeapCapacityBytes()
  requireCondition(
    heapAfterBytes <= heapBeforeBytes * 2,
    `WASM heap grew unexpectedly from ${heapBeforeBytes} to ${heapAfterBytes} bytes.`,
  )
  session.dispose()
  return { heapAfterBytes, heapBeforeBytes, solveTimes }
}

async function main() {
  assertLocalSolveSpaceBuild()
  const initializationStartedAt = performance.now()
  const nativeModule = await loadNativeModule()
  const initializationMs = performance.now() - initializationStartedAt
  const session = new SketchSolverSession(nativeModule)
  const startedAt = performance.now()
  const abiRejections = runAbiRejectionEvidence(nativeModule)

  const { fully, over, under } = runStatusEvidence(session)
  const pointAlignmentConflict = runPointAlignmentConflictEvidence(session)
  const productionPointAlignment = runProductionPointAlignmentEvidence(session)
  const productionArcMidpoint = runProductionArcMidpointEvidence(session)
  const productionEllipseQuadrant = runProductionEllipseQuadrantEvidence(session)
  const productionEllipseLocus = runProductionEllipseLocusEvidence(session)
  const { fixtures: coverageFixtures, results: constraintCoverage } = runCoverageEvidence(session)
  const largestConstraintPerturbationResidual = runConstraintPerturbations(
    session,
    coverageFixtures,
  )

  const degenerate = session.solve(createDegenerateLineFixture())
  requireCondition(
    new Set(["failed", "under-constrained"]).has(degenerate.status),
    `Degenerate line returned the unexpected status ${degenerate.status}.`,
  )

  const largestPerturbationResidual = runCanonicalLinePerturbations(session)
  const { heapAfterBytes, heapBeforeBytes, solveTimes } = runLifecycleEvidence(
    nativeModule,
    session,
  )

  const report = {
    schemaVersion: 1,
    sourceRevision: SOLVESPACE_BUILD_INPUTS.sources.solvespace.revision,
    initializationMs,
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    abiRejections,
    statusClassification: {
      fullyConstrained: fully.status,
      underConstrained: under.status,
      overConstrained: over.status,
      conflictSet: [...over.failedConstraintHandles],
      pointAlignmentConflictSet: [...pointAlignmentConflict.failedConstraintHandles],
    },
    constraintCoverage,
    productionArcMidpoint,
    productionEllipseLocus,
    productionEllipseQuadrant,
    productionPointAlignment,
    degenerateGeometry: {
      status: degenerate.status,
      maximumResidual: degenerate.maximumResidual,
    },
    perturbations: {
      canonicalLineCount: 100,
      canonicalLineMaximumResidual: largestPerturbationResidual,
      constraintCorpusCases: coverageFixtures.length,
      constraintCorpusCount: coverageFixtures.length * 100,
      constraintCorpusMaximumResidual: largestConstraintPerturbationResidual,
    },
    lifecycle: {
      cycles: 1_000,
      heapBeforeBytes,
      heapAfterBytes,
      solveP50Ms: percentile(solveTimes, 0.5),
      solveP95Ms: percentile(solveTimes, 0.95),
      solveMaximumMs: Math.max(...solveTimes),
    },
  }
  mkdirSync(artifactRoot, { recursive: true })
  writeFileSync(join(artifactRoot, "evidence-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown SolveSpace evidence failure.")
  process.exitCode = 1
})
