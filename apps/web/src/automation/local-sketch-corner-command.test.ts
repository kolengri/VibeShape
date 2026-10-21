import { describe, expect, it } from "bun:test"
import {
  automationDraftInspectionRequestSchema,
  automationDraftInspectionViewSchema,
} from "@vibeshape/automation-api/draft-inspection"
import {
  applyAutomationDraftCommandRequestSchema,
  automationDraftStateSchema,
} from "@vibeshape/automation-api/drafts"
import { queryDocumentVariables, type SketchSolutionView } from "@vibeshape/automation-api/queries"
import type { LocalSketchCornerOperation } from "@vibeshape/automation-api/sketch-corner-tools"
import type { AutomationHost, AutomationHostDiagnostic } from "@vibeshape/automation-host/host"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain/commands"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import {
  commandIdSchema,
  draftIdSchema,
  sketchConstraintIdSchema,
  sketchEntityIdSchema,
  sketchIdSchema,
} from "@vibeshape/domain/identifiers"
import { createRectangleSketch } from "@vibeshape/domain/rectangle-sketch"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import type { SketchCornerTreatment } from "@vibeshape/domain/sketch-corner-edit"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { type VariableDefinition, variableDefinitionSchema } from "@vibeshape/domain/variables"
import { vi } from "../../../../tests/unit/support/bun-test"
import { executeSketchCornerCommand } from "./local-sketch-corner-command"
import { createLocalToolExecutor } from "./local-tool-executor"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(99),
})
const firstLineId = sketchEntityIdSchema.parse(id(5))
const secondLineId = sketchEntityIdSchema.parse(id(6))
const fillet: SketchCornerTreatment = {
  kind: "fillet",
  firstLineId,
  secondLineId,
  radius: createLengthQuantity(2),
}
const chamfer: SketchCornerTreatment = {
  kind: "chamfer",
  firstLineId,
  secondLineId,
  firstDistance: createLengthQuantity(2),
  secondDistance: createLengthQuantity(3),
}

function operation(treatment = fillet): LocalSketchCornerOperation {
  return {
    tool: "treat_sketch_corner",
    arguments: {
      draftId: draftIdSchema.parse(id(20)),
      baseRevision: 2,
      commandId: commandIdSchema.parse(id(21)),
      sketchId: sketchIdSchema.parse(id(200)),
      treatment,
    },
  }
}
function rectangle() {
  let entity = 1,
    constraint = 100
  return createRectangleSketch({
    id: sketchIdSchema.parse(id(200)),
    label: "Corner",
    plane: "xy",
    width: createLengthQuantity(10, "mm", "#width"),
    height: createLengthQuantity(8),
    createEntityId: () => sketchEntityIdSchema.parse(id(entity++)),
    createConstraintId: () => sketchConstraintIdSchema.parse(id(constraint++)),
  })
}
function variable(n: number, name: string, expression: string) {
  return variableDefinitionSchema.parse({ schemaVersion: 0, id: id(n), name, expression })
}
function fixture(
  sketch = rectangle(),
  variables: readonly VariableDefinition[] = [
    variable(300, "width", "10 mm"),
    variable(301, "cornerSize", "2 mm"),
  ],
  solvedSource = sketch,
) {
  let current = sketch
  const state = automationDraftStateSchema.parse({
    schemaVersion: 1,
    draftId: id(20),
    documentId: id(10),
    baseRevision: 2,
    revision: 2,
    commandCount: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
  })
  const points = solvedSource.entities.flatMap((entity) =>
    entity.type === "point" ? [{ entityId: entity.id, x: entity.x + 100, y: entity.y + 50 }] : [],
  )
  const summary: SketchSolutionView["summary"] = {
    status: "fully-constrained",
    degreesOfFreedom: 0,
    maximumResidual: 0,
    solver: "SolveSpace",
    moduleSha256: "a".repeat(64),
    wasmSha256: "b".repeat(64),
  }
  function inspect(input: unknown) {
    const request = automationDraftInspectionRequestSchema.parse(input)
    const query = request.query
    if (query.kind === "org.vibeshape.variable.list") {
      const result = queryDocumentVariables(
        documentSnapshotSchema.parse({
          schemaVersion: 0,
          id: id(10),
          revision: 2,
          name: "Corner draft",
          variables,
          sketches: [sketch],
          createdAt: "2026-10-20T00:00:00.000Z",
          updatedAt: "2026-10-20T00:00:00.000Z",
        }),
        query,
      )
      if (!result.ok) throw new Error(result.diagnostic.message)
      return automationDraftInspectionViewSchema.parse({
        schemaVersion: 1,
        draft: state,
        view: result.view,
      })
    }
    if (query.kind !== "org.vibeshape.sketch.solution")
      throw new Error("Expected a draft preparation query.")
    const offset = query.cursor?.offset ?? 0
    const items = points.slice(offset, offset + query.limit)
    const next = offset + items.length
    return automationDraftInspectionViewSchema.parse({
      schemaVersion: 1,
      draft: state,
      view: {
        kind: query.kind,
        schemaVersion: 1,
        documentId: id(10),
        revision: 2,
        generation: 2,
        classification: "derived",
        inspectionId: id(22),
        sketchId: sketch.id,
        summary,
        counts: {
          points: points.length,
          circles: 0,
          failedConstraints: 0,
          profiles: 0,
          diagnostics: 0,
        },
        units: { length: "mm", area: "mm2" },
        nextCursor:
          next < points.length ? { inspectionId: id(22), section: "points", offset: next } : null,
        data: { section: "points", items, total: points.length },
      },
    })
  }
  const readOwnedSketch = vi.fn<NonNullable<AutomationHost["readOwnedSketch"]>>(async () => ({
    ok: true,
    value: sketchRecordSchema.parse(current),
  }))
  const inspectDraft = vi.fn<AutomationHost["inspectDraft"]>(async (_actor, input) => ({
    ok: true,
    value: inspect(input),
  }))
  const applyCommand = vi.fn<AutomationHost["applyCommand"]>(async (_actor, input) => {
    const request = applyAutomationDraftCommandRequestSchema.parse(input)
    const parsed = parseDocumentCommand(request.command)
    if (!parsed.ok || parsed.command.kind !== "org.vibeshape.sketch.update")
      throw new Error("Expected one ordinary sketch update.")
    current = parsed.command.payload.sketch
    return { ok: true, value: { ...state, revision: 3, commandCount: 1 } }
  })
  const host = {
    readOwnedSketch,
    inspectDraft,
    applyCommand,
    createDraft: vi.fn(),
    previewDraft: vi.fn(),
    commitDraft: vi.fn(),
    discardDraft: vi.fn(),
  }
  return {
    host,
    state,
    points,
    summary,
    inspect,
    current: () => current,
    execute: (treatment = fillet, signal?: AbortSignal) =>
      executeSketchCornerCommand(host, actor, id(10), operation(treatment), signal),
  }
}
function rejection(code: AutomationHostDiagnostic["code"]) {
  return {
    ok: false as const,
    diagnostic: {
      code,
      message: "Draft authority rejected preparation.",
      retryable: true,
      issues: [],
    },
  }
}

describe("owned sketch corner commands", () => {
  it("routes the named tool through the ordinary local executor", async () => {
    const f = fixture()
    const executor = createLocalToolExecutor(
      {
        host: f.host,
        documentId: id(10),
        revision: 2,
        readInfo: () => null,
        readCad: vi.fn(),
        exportRevisionBound: vi.fn(),
      },
      actor,
    )
    expect(await executor.execute(operation())).toEqual({
      ok: true,
      value: { ...f.state, revision: 3, commandCount: 1 },
    })
    expect(f.host.applyCommand).toHaveBeenCalledTimes(1)
  })
  it.each([fillet, chamfer])(
    "applies one $kind update with stable authored IDs, retained constraints and host-generated IDs",
    async (treatment) => {
      const f = fixture(),
        before = structuredClone(f.current())
      expect(await f.execute(treatment)).toEqual({
        ok: true,
        value: { ...f.state, revision: 3, commandCount: 1 },
      })
      expect(f.host.applyCommand).toHaveBeenCalledTimes(1)
      expect(f.host.applyCommand).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          draftId: id(20),
          command: expect.objectContaining({
            kind: "org.vibeshape.sketch.update",
            commandId: id(21),
            baseRevision: 2,
            documentId: id(10),
            actor,
          }),
        }),
      )
      const next = f.current()
      expect(next.id).toBe(before.id)
      for (const source of before.entities)
        expect(next.entities.some(({ id }) => id === source.id)).toBe(true)
      for (const source of before.constraints)
        expect(next.constraints.find(({ id }) => id === source.id)).toMatchObject({
          id: source.id,
          type: source.type,
        })
      expect(next.constraints.find(({ id: value }) => value === id(105))).toEqual(
        before.constraints.find(({ id: value }) => value === id(105)),
      )
      const horizontal = next.constraints.find(({ id: value }) => value === id(101))
      if (horizontal?.type !== "horizontal")
        throw new Error("Expected the original horizontal constraint.")
      expect(horizontal.lineId).not.toBe(firstLineId)
      expect(next.entities.find(({ id }) => id === horizontal.lineId)).toMatchObject({
        type: "line",
        construction: true,
      })
      const newIds = [
        ...next.entities.filter((entity) => !before.entities.some(({ id }) => id === entity.id)),
        ...next.constraints.filter(
          (constraint) => !before.constraints.some(({ id }) => id === constraint.id),
        ),
      ].map(({ id }) => id)
      expect(new Set(newIds).size).toBe(newIds.length)
      for (const value of newIds)
        expect(value).toMatch(
          /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        )
      expect(next.constraints.filter(({ type }) => type === "tangent")).toHaveLength(
        treatment.kind === "fillet" ? 2 : 0,
      )
      expect(f.host.readOwnedSketch).toHaveBeenCalledTimes(2)
      expect(f.host.commitDraft).not.toHaveBeenCalled()
    },
  )

  it.each([fillet, chamfer])(
    "uses solved draft points instead of authored seeds for $kind",
    async (treatment) => {
      const source = rectangle()
      const seeds = sketchRecordSchema.parse({
        ...source,
        entities: source.entities.map((entity) =>
          entity.type === "point" ? { ...entity, x: 0, y: 0 } : entity,
        ),
      })
      const f = fixture(seeds, undefined, source)
      expect(await f.execute(treatment)).toMatchObject({ ok: true })
      const next = f.current(),
        first = next.entities.find(({ id }) => id === firstLineId),
        second = next.entities.find(({ id }) => id === secondLineId)
      if (first?.type !== "line" || second?.type !== "line")
        throw new Error("Expected stable trimmed lines.")
      expect(next.entities.find(({ id }) => id === first.endPointId)).toMatchObject({
        x: 108,
        y: 50,
      })
      expect(next.entities.find(({ id }) => id === second.startPointId)).toMatchObject({
        x: 110,
        y: treatment.kind === "fillet" ? 52 : 53,
      })
      expect(next.entities.find(({ id: value }) => value === id(2))).toMatchObject({
        x: 110,
        y: 50,
        construction: true,
      })
    },
  )

  it.each(["fillet", "chamfer"] as const)(
    "resolves %s expressions against draft variables while preserving expression and source units",
    async (kind) => {
      const f = fixture()
      const quantity = createLengthQuantity(50, "cm", "#cornerSize")
      const treatment: SketchCornerTreatment =
        kind === "fillet"
          ? { ...fillet, radius: quantity }
          : {
              ...chamfer,
              firstDistance: quantity,
              secondDistance: createLengthQuantity(50, "mm", "#cornerSize + 1 mm"),
            }
      expect(await f.execute(treatment)).toMatchObject({ ok: true })
      expect(
        f
          .current()
          .constraints.find(({ type }) => type === (kind === "fillet" ? "radius" : "distance")),
      ).toMatchObject({
        value: { value: 2, source: { value: 0.2, unit: "cm", expression: "#cornerSize" } },
      })
      if (kind === "chamfer")
        expect(f.current().constraints.filter(({ type }) => type === "distance")[1]).toMatchObject({
          value: { value: 3, source: { expression: "#cornerSize + 1 mm" } },
        })
      expect(quantity.value).toBe(500)
    },
  )

  it.each(["#missing", "1 deg", "0 mm", "-2 mm", "20 mm"])(
    "rejects unusable expression %s without changing the draft",
    async (expression) => {
      const f = fixture(),
        before = structuredClone(f.current())
      expect(
        await f.execute({ ...fillet, radius: createLengthQuantity(2, "mm", expression) }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch-corner" } })
      expect(f.current()).toEqual(before)
      expect(f.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it("reads all solved points and variable pages before treating a corner", async () => {
    const source = rectangle()
    const sketch = sketchRecordSchema.parse({
      ...source,
      entities: [
        ...source.entities,
        ...Array.from({ length: 201 }, (_, n) => ({
          schemaVersion: 0,
          id: id(1000 + n),
          type: "point",
          x: n + 20,
          y: 20,
          construction: true,
        })),
      ],
    })
    const variables = Array.from({ length: 201 }, (_, n) => variable(2000 + n, `size${n}`, "2 mm"))
    const f = fixture(sketch, variables)
    expect(
      await f.execute({ ...fillet, radius: createLengthQuantity(1, "mm", "#size200") }),
    ).toMatchObject({ ok: true })
    expect(f.host.inspectDraft).toHaveBeenCalledTimes(4)
    expect(f.host.inspectDraft).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        query: expect.objectContaining({
          kind: "org.vibeshape.sketch.solution",
          cursor: { inspectionId: id(22), section: "points", offset: 200 },
        }),
      }),
    )
    expect(f.host.inspectDraft).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        query: expect.objectContaining({ kind: "org.vibeshape.variable.list", cursor: "200" }),
      }),
    )
  })

  it.each(["collinear", "branched", "construction", "nonadjacent", "oversized"])(
    "rejects an unsupported %s corner atomically",
    async (reason) => {
      const source = rectangle()
      const sketch = sketchRecordSchema.parse({
        ...source,
        entities: [
          ...source.entities.map((entity) => {
            if (reason === "collinear" && entity.type === "point" && entity.id === id(3))
              return { ...entity, x: 20, y: 0 }
            if (reason === "construction" && entity.id === firstLineId)
              return { ...entity, construction: true }
            return entity
          }),
          ...(reason === "branched"
            ? [
                {
                  schemaVersion: 0,
                  id: id(500),
                  type: "line",
                  startPointId: id(2),
                  endPointId: id(4),
                  construction: false,
                },
              ]
            : []),
        ],
      })
      const f = fixture(sketch),
        before = structuredClone(sketch)
      expect(
        await f.execute({
          ...fillet,
          secondLineId: reason === "nonadjacent" ? sketchEntityIdSchema.parse(id(7)) : secondLineId,
          radius: createLengthQuantity(reason === "oversized" ? 9 : 2),
        }),
      ).toMatchObject({ ok: false, diagnostic: { code: "invalid-sketch-corner" } })
      expect(f.current()).toEqual(before)
      expect(f.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it.each(["stale-query-revision", "draft-owner-mismatch", "draft-expired"] as const)(
    "forwards %s before solving and after asynchronous preparation",
    async (code) => {
      const f = fixture(),
        failure = rejection(code),
        before = structuredClone(f.current())
      f.host.readOwnedSketch.mockResolvedValueOnce(failure)
      expect(await f.execute()).toMatchObject({
        ok: false,
        diagnostic: {
          code: failure.diagnostic.code,
          message: failure.diagnostic.message,
          retryable: true,
        },
      })
      expect(f.host.inspectDraft).not.toHaveBeenCalled()
      f.host.inspectDraft.mockImplementationOnce(async (_actor, input) => {
        await Promise.resolve()
        f.host.readOwnedSketch.mockResolvedValueOnce(failure)
        return { ok: true, value: f.inspect(input) }
      })
      expect(await f.execute()).toMatchObject({
        ok: false,
        diagnostic: {
          code: failure.diagnostic.code,
          message: failure.diagnostic.message,
          retryable: true,
        },
      })
      expect(f.current()).toEqual(before)
      expect(f.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it("forwards solver and final command authority failures without a fallback mutation", async () => {
    const f = fixture(),
      before = structuredClone(f.current()),
      failure = rejection("stale-query-revision")
    f.host.inspectDraft.mockResolvedValueOnce(failure)
    expect(await f.execute()).toMatchObject({
      ok: false,
      diagnostic: {
        code: failure.diagnostic.code,
        message: failure.diagnostic.message,
        retryable: true,
      },
    })
    expect(f.host.applyCommand).not.toHaveBeenCalled()
    f.host.applyCommand.mockResolvedValueOnce(rejection("draft-expired"))
    expect(await f.execute()).toMatchObject({ ok: false, diagnostic: { code: "draft-expired" } })
    expect(f.current()).toEqual(before)
  })

  it.each(["before", "solve", "variables", "recheck"])(
    "cancels at %s without dispatching a prepared update",
    async (stage) => {
      const f = fixture(),
        controller = new AbortController()
      if (stage === "before") controller.abort()
      if (stage === "solve" || stage === "variables")
        f.host.inspectDraft.mockImplementation(async (_actor, input) => {
          const value = f.inspect(input)
          if (
            (stage === "solve" && value.view.kind === "org.vibeshape.sketch.solution") ||
            (stage === "variables" && value.view.kind === "org.vibeshape.variable.list")
          )
            controller.abort()
          return { ok: true, value }
        })
      if (stage === "recheck")
        f.host.readOwnedSketch
          .mockResolvedValueOnce({ ok: true, value: f.current() })
          .mockImplementationOnce(async () => {
            controller.abort()
            return { ok: true, value: f.current() }
          })
      expect(
        await f.execute(
          { ...fillet, radius: createLengthQuantity(2, "mm", "#cornerSize") },
          controller.signal,
        ),
      ).toMatchObject({ ok: false, diagnostic: { code: "request-cancelled" } })
      expect(f.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it.each(["failed", "over-constrained"] as const)(
    "rejects a %s solve instead of using authored coordinates",
    async (status) => {
      const f = fixture()
      f.summary.status = status
      expect(await f.execute()).toMatchObject({
        ok: false,
        diagnostic: { code: "invalid-sketch-solution" },
      })
      expect(f.host.applyCommand).not.toHaveBeenCalled()
    },
  )

  it("rejects incomplete or duplicate solved points and unavailable preparation", async () => {
    const f = fixture()
    f.points.pop()
    expect(await f.execute()).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-sketch-solution" },
    })
    const duplicate = fixture(),
      point = duplicate.points[0]
    if (!point) throw new Error("Expected solved corner points.")
    duplicate.points[1] = point
    expect(await duplicate.execute()).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-sketch-solution" },
    })
    const { readOwnedSketch: _read, ...host } = f.host
    expect(await executeSketchCornerCommand(host, actor, id(10), operation())).toMatchObject({
      ok: false,
      diagnostic: { code: "sketch-corner-unavailable" },
    })
    expect(f.host.applyCommand).not.toHaveBeenCalled()
    expect(duplicate.host.applyCommand).not.toHaveBeenCalled()
  })
})
