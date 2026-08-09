import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import { createLengthQuantity } from "@vibeshape/domain/units"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f41ac"
const constrainedSketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f4201"
const dragSketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f4301"
const largeSketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f4401"
const profileSketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f4501"
const variableId = "0195b5ac-b240-7a2c-8c33-67a36a7f41ac"
const heightVariableId = "0195b5ac-b240-7a2c-8c33-67a36a7f41ad"

function entityId(index: number) {
  return `0195b5ac-b220-7a2c-8c33-${index.toString(16).padStart(12, "0")}`
}

function constraintId(index: number) {
  return `0195b5ac-b230-7a2c-8c33-${index.toString(16).padStart(12, "0")}`
}

const constrainedPointA = entityId(1)
const constrainedPointB = entityId(2)
const constrainedLine = entityId(3)
const dragPointA = entityId(4)
const dragPointB = entityId(5)
const dragLine = entityId(6)
const profilePointA = entityId(20)
const profilePointB = entityId(21)
const profilePointC = entityId(22)
const profilePointD = entityId(23)
const profileLineA = entityId(24)
const profileLineB = entityId(25)
const profileLineC = entityId(26)
const profileLineD = entityId(27)

function constrainedSketch() {
  return {
    schemaVersion: 0,
    id: constrainedSketchId,
    label: "Variable-driven line",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: constrainedPointA,
        type: "point",
        x: 10,
        y: 20,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: constrainedPointB,
        type: "point",
        x: 39,
        y: 20.2,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: constrainedLine,
        type: "line",
        startPointId: constrainedPointA,
        endPointId: constrainedPointB,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: constraintId(1),
        type: "horizontal",
        lineId: constrainedLine,
      },
      {
        schemaVersion: 0,
        id: constraintId(2),
        type: "distance",
        firstPointId: constrainedPointA,
        secondPointId: constrainedPointB,
        value: createLengthQuantity(30, "mm", "#width"),
      },
      {
        schemaVersion: 0,
        id: constraintId(3),
        type: "fixed",
        pointId: constrainedPointA,
      },
    ],
  }
}

function dragSketch() {
  return {
    schemaVersion: 0,
    id: dragSketchId,
    label: "Drag continuation line",
    plane: "xy",
    entities: [
      {
        schemaVersion: 0,
        id: dragPointA,
        type: "point",
        x: 0,
        y: 0,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: dragPointB,
        type: "point",
        x: 20,
        y: 0.2,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: dragLine,
        type: "line",
        startPointId: dragPointA,
        endPointId: dragPointB,
        construction: false,
      },
    ],
    constraints: [
      {
        schemaVersion: 0,
        id: constraintId(4),
        type: "horizontal",
        lineId: dragLine,
      },
    ],
  }
}

function profileSketch() {
  return {
    schemaVersion: 0,
    id: profileSketchId,
    label: "Variable-driven rectangular profile",
    plane: "xy",
    entities: [
      { schemaVersion: 0, id: profilePointA, type: "point", x: 0, y: 0, construction: false },
      { schemaVersion: 0, id: profilePointB, type: "point", x: 29.9, y: 0.1, construction: false },
      {
        schemaVersion: 0,
        id: profilePointC,
        type: "point",
        x: 30.1,
        y: 11.9,
        construction: false,
      },
      { schemaVersion: 0, id: profilePointD, type: "point", x: 0.1, y: 12, construction: false },
      {
        schemaVersion: 0,
        id: profileLineA,
        type: "line",
        startPointId: profilePointA,
        endPointId: profilePointB,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: profileLineB,
        type: "line",
        startPointId: profilePointB,
        endPointId: profilePointC,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: profileLineC,
        type: "line",
        startPointId: profilePointC,
        endPointId: profilePointD,
        construction: false,
      },
      {
        schemaVersion: 0,
        id: profileLineD,
        type: "line",
        startPointId: profilePointD,
        endPointId: profilePointA,
        construction: false,
      },
    ],
    constraints: [
      { schemaVersion: 0, id: constraintId(20), type: "fixed", pointId: profilePointA },
      { schemaVersion: 0, id: constraintId(21), type: "horizontal", lineId: profileLineA },
      { schemaVersion: 0, id: constraintId(22), type: "vertical", lineId: profileLineB },
      { schemaVersion: 0, id: constraintId(23), type: "horizontal", lineId: profileLineC },
      { schemaVersion: 0, id: constraintId(24), type: "vertical", lineId: profileLineD },
      {
        schemaVersion: 0,
        id: constraintId(25),
        type: "horizontal-distance",
        firstPointId: profilePointA,
        secondPointId: profilePointB,
        value: createLengthQuantity(30, "mm", "#width"),
      },
      {
        schemaVersion: 0,
        id: constraintId(26),
        type: "vertical-distance",
        firstPointId: profilePointB,
        secondPointId: profilePointC,
        value: createLengthQuantity(12, "mm", "#height"),
      },
    ],
  }
}

function largeSketch(pointCount = 1_000) {
  return {
    schemaVersion: 0,
    id: largeSketchId,
    label: "Large sketch budget",
    plane: "xy",
    entities: Array.from({ length: pointCount }, (_, index) => ({
      schemaVersion: 0,
      id: entityId(1_000 + index),
      type: "point",
      x: index % 100,
      y: Math.floor(index / 100),
      construction: true,
    })),
    constraints: [],
  }
}

function point(
  solution: { points: readonly { entityId: string; x: number; y: number }[] },
  id: string,
) {
  const value = solution.points.find((candidate) => candidate.entityId === id)
  if (!value) throw new Error(`Solved sketch point ${id} is missing.`)
  return value
}

async function runEvidence() {
  const session = createDocumentWorkerSession(documentId)
  try {
    await session.rebuild({
      document: {
        schemaVersion: 0,
        id: documentId,
        revision: 1,
        name: "Sketch worker evidence",
        variables: [
          { schemaVersion: 0, id: variableId, name: "width", expression: "30 mm" },
          { schemaVersion: 0, id: heightVariableId, name: "height", expression: "12 mm" },
        ],
        sketches: [constrainedSketch(), dragSketch(), profileSketch(), largeSketch()],
        features: [],
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
      mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    })

    const constrained = await session.solveSketch({ sketchId: constrainedSketchId })
    const firstDrag = await session.solveSketch({
      sketchId: dragSketchId,
      draggedPoints: [{ entityId: dragPointA, x: 12, y: 8 }],
    })
    const continuation = {
      schemaVersion: 0 as const,
      sketchId: firstDrag.solution.sketchId,
      sourceRevision: firstDrag.solution.sourceRevision,
      points: firstDrag.solution.points,
      circles: firstDrag.solution.circles,
    }
    const secondDrag = await session.solveSketch({
      sketchId: dragSketchId,
      continuation,
      draggedPoints: [{ entityId: dragPointA, x: 18, y: 14 }],
    })
    const profile = await session.solveSketch({ sketchId: profileSketchId })
    const largeStartedAt = performance.now()
    const large = await session.solveSketch({ sketchId: largeSketchId })
    const largeSolveMs = performance.now() - largeStartedAt
    const constrainedStart = point(constrained.solution, constrainedPointA)
    const constrainedEnd = point(constrained.solution, constrainedPointB)
    const firstDraggedPoint = point(firstDrag.solution, dragPointA)
    const secondDraggedPoint = point(secondDrag.solution, dragPointA)

    return {
      constrained: {
        status: constrained.solution.status,
        degreesOfFreedom: constrained.solution.degreesOfFreedom,
        length: Math.hypot(
          constrainedEnd.x - constrainedStart.x,
          constrainedEnd.y - constrainedStart.y,
        ),
        maximumResidual: constrained.solution.maximumResidual,
      },
      continuation: {
        first: firstDraggedPoint,
        second: secondDraggedPoint,
        status: secondDrag.solution.status,
      },
      profile: {
        status: profile.solution.status,
        degreesOfFreedom: profile.solution.degreesOfFreedom,
        profiles: profile.solution.profileResult.profiles,
        loopCount: profile.solution.profileResult.loops.length,
        diagnostics: profile.solution.profileResult.diagnostics,
      },
      large: {
        pointCount: large.solution.points.length,
        status: large.solution.status,
        degreesOfFreedom: large.solution.degreesOfFreedom,
        solveMs: largeSolveMs,
        heapCapacityBytes: large.solution.heapCapacityBytes,
      },
      solverBuild: large.solution.solverBuild,
    }
  } finally {
    await session.dispose().catch(() => undefined)
    session.terminate()
  }
}

const resultElement = document.querySelector<HTMLPreElement>("#result")
if (!resultElement) throw new Error("Sketch worker evidence output is missing.")

runEvidence().then(
  (report) => {
    resultElement.dataset.status = "complete"
    resultElement.textContent = JSON.stringify(report)
  },
  (error) => {
    resultElement.dataset.status = "failed"
    resultElement.textContent = error instanceof Error ? error.message : String(error)
  },
)
