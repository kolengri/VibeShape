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
import { expect, it } from "vitest"
import { createQueryDispatcher, documentCoreQueryHandlers } from "./queries"
import {
  sketchSolutionPageMatches,
  sketchSolutionQuerySchema,
  sketchSolutionViewSchema,
} from "./sketch-solution-queries"

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
    diagnostics: [],
    profiles: [
      {
        selector: {
          schemaVersion: 0,
          sketchId: sketch.id,
          outerBoundaryEntityIds: [id(5), id(6), id(7), id(8)],
          holeBoundaryEntityIds: [],
        },
        area: 80,
        perimeter: 36,
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 8 },
      },
    ],
  })
  const modules = createModuleRegistry([documentCoreModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const queries = createQueryDispatcher(modules.registry, documentCoreQueryHandlers)
  if (!queries.ok) throw new Error(queries.diagnostic.message)
  const query = sketchSolutionQuerySchema.parse({
    kind: "org.vibeshape.sketch.solution",
    schemaVersion: 1,
    documentId: snapshot.id,
    revision: 4,
    sketchId: sketch.id,
    section: "points",
    limit: 2,
  })
  return { snapshot, evidence, query, dispatch: queries.dispatcher.dispatch }
}
it("pages solved points and stable profile selectors with one opaque inspection identity", () => {
  const f = fixture(),
    before = documentSnapshotSchema.parse(f.snapshot)
  const first = f.dispatch(f.snapshot, f.query, { sketchSolution: f.evidence })
  expect(first).toMatchObject({
    ok: true,
    view: {
      inspectionId,
      revision: 4,
      generation: 2,
      counts: { points: 4, profiles: 1 },
      nextCursor: { inspectionId, section: "points", offset: 2 },
      data: { section: "points", items: f.evidence.points.slice(0, 2), total: 4 },
    },
  })
  if (!first.ok || first.view.kind !== f.query.kind) throw new Error("Missing first page")
  expect(
    f.dispatch(
      f.snapshot,
      { ...f.query, cursor: first.view.nextCursor },
      { sketchSolution: f.evidence },
    ),
  ).toMatchObject({
    ok: true,
    view: { nextCursor: null, data: { items: f.evidence.points.slice(2) } },
  })
  expect(
    f.dispatch(f.snapshot, { ...f.query, section: "profiles" }, { sketchSolution: f.evidence }),
  ).toMatchObject({ ok: true, view: { data: { items: f.evidence.profiles } } })
  expect(f.snapshot).toEqual(before)
})
it("rejects stale provenance, cross-section cursors, expired inspections and out-of-range offsets", () => {
  const f = fixture(),
    context = { sketchSolution: f.evidence }
  for (const cursor of [
    { inspectionId, section: "profiles", offset: 0 },
    { inspectionId: "6218a2a7-1599-47bd-8dd9-fa57220b15f3", section: "points", offset: 2 },
  ])
    expect(f.dispatch(f.snapshot, { ...f.query, cursor }, context)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-geometry" },
    })
  expect(
    f.dispatch(
      f.snapshot,
      { ...f.query, cursor: { inspectionId, section: "points", offset: 5 } },
      context,
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "invalid-query" } })
  expect(
    f.dispatch(f.snapshot, f.query, { sketchSolution: { ...f.evidence, revision: 3 } }),
  ).toMatchObject({ ok: false, diagnostic: { code: "stale-geometry" } })
  expect(f.dispatch(f.snapshot, { ...f.query, revision: 3 }, context)).toMatchObject({
    ok: false,
    diagnostic: { code: "stale-query-revision" },
  })
  expect(f.dispatch(f.snapshot, f.query)).toMatchObject({
    ok: false,
    diagnostic: { code: "geometry-unavailable" },
  })
})
it("rejects incomplete, duplicate or foreign solved entities, constraints and profile boundaries", () => {
  const f = fixture()
  for (const overrides of [
    { points: f.evidence.points.slice(1) },
    { points: [...f.evidence.points.slice(1), f.evidence.points[1]] },
    { points: [...f.evidence.points.slice(1), { ...f.evidence.points[0], entityId: id(800) }] },
    { failedConstraintIds: [id(800)] },
    {
      profiles: [
        {
          ...f.evidence.profiles[0],
          selector: { ...f.evidence.profiles[0]?.selector, outerBoundaryEntityIds: [id(1)] },
        },
      ],
    },
    { diagnostics: [{ code: "open-chain", message: "Foreign entity", entityIds: [id(800)] }] },
  ])
    expect(
      f.dispatch(f.snapshot, f.query, { sketchSolution: { ...f.evidence, ...overrides } }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry-evidence" } })
})
it("bounds verbose diagnostic pages without truncating a successful result", () => {
  const f = fixture(),
    evidence = {
      ...f.evidence,
      diagnostics: Array.from({ length: 200 }, () => ({
        code: "open-chain",
        message: "x".repeat(300),
        entityIds: Array(64).fill(id(1)),
      })),
    }
  expect(
    f.dispatch(
      f.snapshot,
      { ...f.query, section: "diagnostics", limit: 200 },
      { sketchSolution: evidence },
    ),
  ).toMatchObject({ ok: false, diagnostic: { code: "query-result-too-large", retryable: true } })
  expect(
    f.dispatch(
      f.snapshot,
      { ...f.query, section: "diagnostics", limit: 1 },
      { sketchSolution: evidence },
    ),
  ).toMatchObject({ ok: true, view: { data: { total: 200 }, nextCursor: { offset: 1 } } })
})

it("correlates every solved page count and cursor before accepting browser transport results", () => {
  const f = fixture(),
    result = f.dispatch(f.snapshot, f.query, { sketchSolution: f.evidence })
  if (!result.ok) throw new Error("Missing point page")
  const view = sketchSolutionViewSchema.parse(result.view)
  expect(sketchSolutionPageMatches(view, f.query)).toBe(true)
  for (const changed of [
    { ...view, data: { ...view.data, total: 3 } },
    { ...view, data: { ...view.data, items: view.data.items.slice(1) } },
    { ...view, nextCursor: null },
    { ...view, nextCursor: { inspectionId, section: "points", offset: 3 } },
    { ...view, nextCursor: { inspectionId, section: "profiles", offset: 2 } },
    {
      ...view,
      nextCursor: {
        inspectionId: "6218a2a7-1599-47bd-8dd9-fa57220b15f3",
        section: "points",
        offset: 2,
      },
    },
  ])
    expect(sketchSolutionPageMatches(sketchSolutionViewSchema.parse(changed), f.query)).toBe(false)
  expect(
    sketchSolutionPageMatches(view, {
      ...f.query,
      cursor: { inspectionId, section: "profiles", offset: 0 },
    }),
  ).toBe(false)
})

it("rejects a foreign-sketch profile selector at the public page boundary", () => {
  const f = fixture(),
    result = f.dispatch(
      f.snapshot,
      { ...f.query, section: "profiles" },
      { sketchSolution: f.evidence },
    )
  if (!result.ok) throw new Error("Missing profile page")
  const view = sketchSolutionViewSchema.parse(result.view)
  if (view.data.section !== "profiles") throw new Error("Missing profiles")
  const foreign = {
    ...view,
    data: {
      ...view.data,
      items: view.data.items.map((profile) => ({
        ...profile,
        selector: { ...profile.selector, sketchId: id(201) },
      })),
    },
  }
  expect(sketchSolutionViewSchema.safeParse(foreign).success).toBe(false)
})
