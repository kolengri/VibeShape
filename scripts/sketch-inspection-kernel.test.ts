// @vitest-environment node

import { expect, it, vi } from "vitest"
import { createDisposableSketchInspection } from "../packages/application/src/disposable-sketch-inspection"
import type { DocumentRebuildPort } from "../packages/application/src/persistent-document-session"
import { type DocumentSnapshot, documentSnapshotSchema } from "../packages/domain/src/document"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "../packages/domain/src/identifiers"
import { createRectangleSketch } from "../packages/domain/src/rectangle-sketch"
import { createLengthQuantity } from "../packages/domain/src/units"
import { DOCUMENT_PROTOCOL_VERSION, solvedSketchWireSchema } from "../packages/protocol/src/index"
import initializeSolver from "../packages/sketch-solver/runtime/vibeshape_slvs.mjs"
import { solveSketchRecord } from "../packages/sketch-solver/src/production"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const inspectionId = "d8dc8f8a-bb72-43a2-83f3-956f1f36ad62"
function snapshot() {
  let entity = 1,
    constraint = 100
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(900),
    revision: 4,
    name: "Inspection",
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    features: [],
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
    sketches: [
      createRectangleSketch({
        id: sketchIdSchema.parse(id(200)),
        label: "Rectangle",
        plane: "xy",
        width: createLengthQuantity(10),
        height: createLengthQuantity(8),
        createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
        createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
      }),
    ],
  })
}
function envelope(document: DocumentSnapshot) {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(901),
    documentId: document.id,
    revision: document.revision,
    generation: 1,
  }
}
async function fixture(
  document: DocumentSnapshot,
  solveGate?: Promise<void>,
  externalPoint = false,
) {
  const solver = await initializeSolver({
    locateFile: () =>
      new URL("../packages/sketch-solver/runtime/vibeshape_slvs.wasm", import.meta.url).pathname,
  })
  const terminate = vi.fn()
  const solveSketch = vi.fn(
    async ({ sketchId }: Parameters<DocumentRebuildPort["solveSketch"]>[0]) => {
      await solveGate
      const sketch = document.sketches.find(({ id }) => id === sketchId)
      if (!sketch) throw new Error("Missing fixture sketch")
      const solved = solveSketchRecord(solver, {
        sketch,
        revision: document.revision,
        variables: [...document.variables],
        externalPoints: externalPoint
          ? [
              {
                id: sketchEntityIdSchema.parse(id(800)),
                type: "point",
                schemaVersion: 0,
                x: 12,
                y: 12,
                construction: true,
              },
            ]
          : [],
      })
      if (!solved.ok) throw new Error(solved.diagnostic.message)
      return {
        ...envelope(document),
        type: "sketchSolved" as const,
        solution: solvedSketchWireSchema.parse(solved.solution),
      }
    },
  )
  const port: DocumentRebuildPort = {
    rebuild: async () => ({
      ...envelope(document),
      type: "documentRebuilt",
      evaluation: {
        records: [],
        dirtyFeatureIds: [],
        evaluatedFeatureIds: [],
        reusedFeatureIds: [],
      },
      geometry: [],
      sketches: [],
      modelReferenceEvidence: [],
    }),
    solveSketch,
    terminate,
    dispose: async () => undefined,
    exportDocument: vi.fn(),
  }
  const inspection = createDisposableSketchInspection({
    mesh: { chordTolerance: 0.1, angularTolerance: 0.5 },
    createRebuildPort: () => port,
    createInspectionId: () => inspectionId,
  })
  return { inspection, terminate, solveSketch, port }
}
it("projects native solved coordinates and stable profile boundaries before terminating the isolated worker", async () => {
  const document = snapshot(),
    before = structuredClone(document)
  const fixturePort = await fixture(document)
  const result = await fixturePort.inspection.inspect(document, sketchIdSchema.parse(id(200)))
  expect(result).toMatchObject({
    ok: true,
    evidence: {
      documentId: document.id,
      revision: 4,
      inspectionId,
      summary: { status: "fully-constrained", degreesOfFreedom: 0 },
      failedConstraintIds: [],
    },
  })
  if (!result.ok) throw new Error(result.code)
  expect(result.evidence.points).toHaveLength(4)
  expect(result.evidence.profiles).toHaveLength(1)
  expect(result.evidence.profiles[0]).toMatchObject({
    area: 80,
    perimeter: 36,
    selector: {
      sketchId: id(200),
      outerBoundaryEntityIds: [id(5), id(6), id(7), id(8)],
      holeBoundaryEntityIds: [],
    },
  })
  expect(result.evidence.summary.maximumResidual).toBeLessThan(1e-7)
  expect(document).toEqual(before)
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})
it("reports native degrees of freedom without mutating authored point positions", async () => {
  const document = snapshot()
  const sketch = document.sketches[0]
  if (!sketch) throw new Error("Missing sketch")
  const free = documentSnapshotSchema.parse({
    ...document,
    sketches: [{ ...sketch, constraints: [] }],
  })
  const fixturePort = await fixture(free)
  const result = await fixturePort.inspection.inspect(free, sketch.id)
  expect(result).toMatchObject({
    ok: true,
    evidence: {
      summary: { status: "under-constrained", degreesOfFreedom: 8 },
      failedConstraintIds: [],
    },
  })
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})
it("cancels a pending solve immediately and ignores a late native result", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const document = snapshot()
  const fixturePort = await fixture(document, gate)
  const result = fixturePort.inspection.inspect(document, sketchIdSchema.parse(id(200)))
  await vi.waitFor(() => expect(fixturePort.solveSketch).toHaveBeenCalledOnce())
  fixturePort.inspection.cancel()
  await expect(result).resolves.toEqual({ ok: false, code: "preview-cancelled" })
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
  release()
  await Promise.resolve()
  fixturePort.inspection.dispose()
  await expect(
    fixturePort.inspection.inspect(document, sketchIdSchema.parse(id(200))),
  ).resolves.toEqual({ ok: false, code: "preview-disposed" })
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})
it("rejects wrong source revision and sketch identity without retaining native evidence", async () => {
  const document = snapshot()
  const fixturePort = await fixture(document)
  const original = fixturePort.solveSketch.getMockImplementation()
  if (!original) throw new Error("Missing solve mock")
  fixturePort.solveSketch.mockImplementation(async (input) => {
    const result = await original(input)
    return { ...result, solution: { ...result.solution, sourceRevision: 3 } }
  })
  await expect(
    fixturePort.inspection.inspect(document, sketchIdSchema.parse(id(200))),
  ).resolves.toEqual({ ok: false, code: "stale-geometry" })
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})

it("keeps native fixed external bindings out of authored solved point evidence", async () => {
  const document = snapshot(),
    fixturePort = await fixture(document, undefined, true)
  const result = await fixturePort.inspection.inspect(document, sketchIdSchema.parse(id(200)))
  expect(result).toMatchObject({
    ok: true,
    evidence: { summary: { status: "fully-constrained", degreesOfFreedom: 0 } },
  })
  if (!result.ok) throw new Error(result.code)
  expect(result.evidence.points.map(({ entityId }) => entityId)).toEqual([
    id(1),
    id(2),
    id(3),
    id(4),
  ])
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})
it("reports native conflicting authored constraints without inventing a usable profile", async () => {
  const document = snapshot(),
    sketch = document.sketches[0]
  if (!sketch) throw new Error("Missing sketch")
  const dimensional = sketch.constraints.find(
    (constraint) => constraint.type === "horizontal-distance",
  )
  if (dimensional?.type !== "horizontal-distance") throw new Error("Missing dimension")
  const conflictId = sketchConstraintIdSchema.parse(id(700))
  const conflicting = documentSnapshotSchema.parse({
    ...document,
    sketches: [
      {
        ...sketch,
        constraints: [
          ...sketch.constraints,
          { ...dimensional, id: conflictId, value: createLengthQuantity(15) },
        ],
      },
    ],
  })
  const fixturePort = await fixture(conflicting),
    result = await fixturePort.inspection.inspect(conflicting, sketch.id)
  expect(result).toMatchObject({
    ok: true,
    evidence: { summary: { status: "over-constrained" }, profiles: [] },
  })
  if (!result.ok) throw new Error(result.code)
  expect(result.evidence.failedConstraintIds.length).toBeGreaterThan(0)
  expect(
    result.evidence.failedConstraintIds.every((id) =>
      conflicting.sketches[0]?.constraints.some((constraint) => constraint.id === id),
    ),
  ).toBe(true)
  expect(fixturePort.terminate).toHaveBeenCalledOnce()
})
