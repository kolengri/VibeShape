import {
  boxFeatureType,
  createLengthQuantity,
  type DocumentSnapshot,
  documentSnapshotSchema,
  sketchRecordSchema,
} from "@vibeshape/domain"
import { fdmFeatureType } from "@vibeshape/domain/part-design-fdm"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerResponse,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"
import { detectSketchProfiles, SKETCH_SOLVER_BUILD } from "@vibeshape/sketch-solver"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { DocumentWorkerRuntime, type SketchSolvePort } from "./runtime"

const engine = new ReplicadGeometryEngine()
const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f3000"
const baseId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
const fdmId = "0195b5ac-b220-7a2c-8c33-67a36a7f3102"
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f3201"
const startId = "0195b5ac-b220-7a2c-8c33-67a36a7f3211"
const endId = "0195b5ac-b220-7a2c-8c33-67a36a7f3212"
const lineId = "0195b5ac-b220-7a2c-8c33-67a36a7f3213"
beforeAll(async () => {
  const fs = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const bytes = fs.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => engine.disposeDocument(documentId))

const solveOpenLines: SketchSolvePort = (input) => {
  const sketch = sketchRecordSchema.parse(input.sketch)
  const points = sketch.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x, y: entity.y }] : [],
  )
  return {
    ok: true,
    solution: {
      schemaVersion: 0,
      sketchId: sketch.id,
      sourceRevision: input.revision,
      status: "under-constrained",
      degreesOfFreedom: 4,
      maximumResidual: 0,
      points,
      circles: [],
      failedConstraintIds: [],
      profileResult: detectSketchProfiles(sketch, { points, circles: [] }),
      heapCapacityBytes: 1024,
      solverBuild: SKETCH_SOLVER_BUILD,
    },
  }
}
function fixture(style: "web" | "rib") {
  const reference = {
    schemaVersion: 0,
    featureId: baseId,
    kind: "face",
    semanticRole: style === "web" ? "primitive.box.cap.end" : "primitive.box.side.y-min",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: style === "web" ? 400 : 40,
      centroid: style === "web" ? [0, 0, 2] : [0, -10, 1],
      bounds:
        style === "web"
          ? { min: [-10, -10, 2], max: [10, 10, 2] }
          : { min: [-10, -10, 0], max: [10, -10, 2] },
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  }
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 1,
    name: "Production FDM rebuild",
    variables: [
      {
        schemaVersion: 0,
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f3301",
        name: "skin",
        expression: "1.2 mm",
      },
    ],
    sketches: [
      {
        schemaVersion: 0,
        id: sketchId,
        label: "Supported open line",
        plane: "xy",
        support: { kind: "feature-face", reference },
        entities: [
          { schemaVersion: 0, id: startId, type: "point", x: -5, y: 0, construction: false },
          { schemaVersion: 0, id: endId, type: "point", x: 5, y: 0, construction: false },
          {
            schemaVersion: 0,
            id: lineId,
            type: "line",
            startPointId: startId,
            endPointId: endId,
            construction: false,
          },
        ],
        constraints: [],
      },
    ],
    features: [
      {
        schemaVersion: 0,
        id: baseId,
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(20),
          depth: createLengthQuantity(20),
          height: createLengthQuantity(2),
          centered: false,
        },
        dependencies: [],
        references: [],
        suppressed: false,
      },
      {
        schemaVersion: 0,
        id: fdmId,
        type: fdmFeatureType.type,
        parameters: {
          kind: "web",
          targetBody: { schemaVersion: 0, featureId: baseId, outputRole: "result" },
          sketchId,
          lineIds: [lineId],
          thickness: createLengthQuantity(1.2, "mm", "#skin"),
          depth: createLengthQuantity(6),
          direction: "forward",
          style,
          extendToWalls: false,
          ...(style === "web"
            ? { stopPlane: { kind: "explicit-plane", origin: [0, 0, 10], normal: [0, 0, 1] } }
            : {}),
        },
        dependencies: [baseId],
        references: [reference],
        suppressed: false,
      },
    ],
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
  })
}
async function rebuild(
  runtime: DocumentWorkerRuntime,
  messages: DocumentWorkerResponse[],
  document: DocumentSnapshot,
) {
  const requestId = `fdm-production-${document.revision}`
  await runtime.handle({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId,
    revision: document.revision,
    generation: 1,
    type: "rebuildDocument",
    document,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  })
  const result = messages.find(
    (message) => message.requestId === requestId && message.type === "documentRebuilt",
  )
  if (result?.type !== "documentRebuilt") throw new Error(JSON.stringify(messages))
  expect(documentWorkerResponseSchema.safeParse(result).success).toBe(true)
  expect(result.evaluation.records).toMatchObject([
    { featureId: baseId, status: "succeeded" },
    { featureId: fdmId, status: "succeeded" },
  ])
  const geometry = result.geometry.find(({ featureId }) => featureId === fdmId)
  if (!geometry) throw new Error(JSON.stringify(result.evaluation.records))
  expect(geometry.geometry.shape).toMatchObject({ valid: true, solidCount: 1 })
  return geometry
}
function expectedVolume(style: "web" | "rib", length: number, thickness: number) {
  // Web stops at Z=10 from its Z=2 box face. Rib overlaps the side face below Z=2.
  const area = style === "web" ? length * 8 : (length * 6) / 2 - (length * (2 - 2 ** 2 / 12)) / 2
  return 800 + area * thickness
}
describe("production FDM document-worker routing with the real exact kernel", () => {
  it.each(["web", "rib"] as const)(
    "prepares saved %s content and rebuilds associated edits through the production predicate",
    async (style) => {
      const messages: DocumentWorkerResponse[] = []
      const solve = vi.fn(solveOpenLines)
      const runtime = new DocumentWorkerRuntime(
        engine,
        { postMessage: (message) => messages.push(message) },
        undefined,
        solve,
      )
      const original = fixture(style)
      const authoredParameters = JSON.stringify(original.features[1]?.parameters)
      try {
        const first = await rebuild(runtime, messages, original)
        expect(first.geometry.shape.volume).toBeCloseTo(expectedVolume(style, 10, 1.2), 5)
        if (style === "web") expect(first.geometry.shape.bounds.max[2]).toBeCloseTo(10, 5)
        const changedLine = documentSnapshotSchema.parse({
          ...original,
          revision: 2,
          sketches: original.sketches.map((sketch) => ({
            ...sketch,
            entities: sketch.entities.map((entity) =>
              entity.id === endId && entity.type === "point" ? { ...entity, x: 7 } : entity,
            ),
          })),
        })
        const second = await rebuild(runtime, messages, changedLine)
        expect(second.contentHash).not.toBe(first.contentHash)
        expect(second.geometry.shape.volume).toBeCloseTo(expectedVolume(style, 12, 1.2), 5)
        const changedQuantity = documentSnapshotSchema.parse({
          ...changedLine,
          revision: 3,
          variables: changedLine.variables.map((variable) => ({ ...variable, expression: "2 mm" })),
        })
        const third = await rebuild(runtime, messages, changedQuantity)
        expect(third.contentHash).not.toBe(second.contentHash)
        expect(third.geometry.shape.volume).toBeCloseTo(expectedVolume(style, 12, 2), 5)
        expect(JSON.stringify(changedQuantity.features[1]?.parameters)).toBe(authoredParameters)
        expect(solve).toHaveBeenCalledTimes(3)
        expect(engine.getHealth().ownedShapeCount).toBe(2)
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
})
