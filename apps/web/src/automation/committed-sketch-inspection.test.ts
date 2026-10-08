import { expect, it } from "bun:test"
import type { SketchInspectionResult } from "@vibeshape/application/disposable-sketch-inspection"
import {
  createQueryDispatcher,
  documentCoreQueryHandlers,
  sketchSolutionQuerySchema,
} from "@vibeshape/automation-api/queries"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import { createModuleRegistry, documentCoreModule } from "@vibeshape/domain/modules"
import { createRectangleSketch } from "@vibeshape/domain/rectangle-sketch"
import { sketchSolutionEvidenceSchema } from "@vibeshape/domain/sketch-solution-evidence"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createCommittedSketchInspection } from "./committed-sketch-inspection"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const inspectionId = "d8dc8f8a-bb72-43a2-83f3-956f1f36ad62"
function fixture() {
  let entity = 1,
    constraint = 100
  const sketch = createRectangleSketch({
    id: sketchIdSchema.parse(id(200)),
    label: "Rectangle",
    plane: "xy",
    width: createLengthQuantity(10),
    height: createLengthQuantity(8),
    createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
  })
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(900),
    revision: 4,
    name: "Inspection",
    features: [],
    sketches: [sketch],
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
  })
  let current: typeof snapshot | null = snapshot
  const evidence = sketchSolutionEvidenceSchema.parse({
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 4,
    generation: 2,
    inspectionId,
    sketchId: sketch.id,
    summary: {
      status: "fully-constrained",
      degreesOfFreedom: 0,
      maximumResidual: 0,
      solver: "SolveSpace",
      moduleSha256: "a".repeat(64),
      wasmSha256: "b".repeat(64),
    },
    points: sketch.entities
      .filter((entity) => entity.type === "point")
      .map((point) => ({ entityId: point.id, x: point.x, y: point.y })),
    circles: [],
    failedConstraintIds: [],
    profiles: [],
    diagnostics: [],
  })
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const queries = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!queries.ok) throw new Error(queries.diagnostic.message)
  const inspect = vi.fn(async (): Promise<SketchInspectionResult> => ({ ok: true, evidence }))
  const cancel = vi.fn(),
    dispose = vi.fn()
  const reader = createCommittedSketchInspection({
    queries: queries.dispatcher,
    documents: {
      readSnapshot: () => current,
      compareAndCommitDraft: () => {
        throw new Error("Read-only inspection cannot commit")
      },
    },
    inspection: { inspect, cancel, dispose },
  })
  const query = sketchSolutionQuerySchema.parse({
    kind: "org.vibeshape.sketch.solution",
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 4,
    sketchId: sketch.id,
    section: "points",
    limit: 2,
  })
  return {
    reader,
    inspect,
    cancel,
    dispose,
    snapshot,
    evidence,
    query,
    replace: (next: typeof snapshot | null) => {
      current = next
    },
  }
}
it("caches one committed sketch catalog across bounded sections and rejects cold or expired cursors", async () => {
  const f = fixture()
  await expect(
    f.reader.read({ ...f.query, cursor: { inspectionId, section: "points", offset: 2 } }),
  ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(f.inspect).not.toHaveBeenCalled()
  const first = await f.reader.read(f.query)
  if (!first.ok || first.view.kind !== f.query.kind) throw new Error("Missing point page")
  await expect(f.reader.read({ ...f.query, cursor: first.view.nextCursor })).resolves.toMatchObject(
    { ok: true, view: { nextCursor: null } },
  )
  await expect(f.reader.read({ ...f.query, section: "profiles" })).resolves.toMatchObject({
    ok: true,
  })
  expect(f.inspect).toHaveBeenCalledTimes(1)
  f.reader.cancel()
  await expect(f.reader.read({ ...f.query, cursor: first.view.nextCursor })).resolves.toMatchObject(
    { ok: false, diagnostic: { code: "stale-geometry" } },
  )
  expect(f.cancel).toHaveBeenCalledTimes(1)
  expect(f.inspect).toHaveBeenCalledTimes(1)
})
it("discards a native result when the committed document changes while solving", async () => {
  const f = fixture()
  let release!: (value: SketchInspectionResult) => void
  f.inspect.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const pending = f.reader.read(f.query)
  await vi.waitFor(() => expect(f.inspect).toHaveBeenCalledTimes(1))
  f.replace({ ...f.snapshot, revision: 5 })
  release({ ok: true, evidence: f.evidence })
  await expect(pending).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "stale-query-revision" },
  })
  f.replace(f.snapshot)
  await expect(
    f.reader.read({ ...f.query, cursor: { inspectionId, section: "points", offset: 2 } }),
  ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
})
it("cancellation prevents a late result from repopulating the committed cache", async () => {
  const f = fixture()
  let release!: (value: SketchInspectionResult) => void
  f.inspect.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const pending = f.reader.read(f.query)
  await vi.waitFor(() => expect(f.inspect).toHaveBeenCalledTimes(1))
  f.reader.cancel()
  release({ ok: true, evidence: f.evidence })
  await expect(pending).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "geometry-unavailable" },
  })
  await expect(
    f.reader.read({ ...f.query, cursor: { inspectionId, section: "points", offset: 2 } }),
  ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  f.reader.dispose()
  await expect(f.reader.read(f.query)).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "geometry-unavailable" },
  })
  expect(f.dispose).toHaveBeenCalledTimes(1)
})
it("checks provenance and complete authored entity coverage before exposing committed evidence", async () => {
  const f = fixture()
  f.inspect.mockResolvedValue({ ok: true, evidence: { ...f.evidence, points: [] } })
  await expect(f.reader.read(f.query)).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-geometry-evidence" },
  })
  f.reader.cancel()
  f.inspect.mockResolvedValue({ ok: true, evidence: { ...f.evidence, revision: 3 } })
  await expect(f.reader.read(f.query)).resolves.toMatchObject({
    ok: false,
    diagnostic: { code: "stale-geometry" },
  })
})
