import { readFileSync } from "node:fs"
import {
  applyAutomationDraftCommandRequestSchema,
  automationDraftStateSchema,
} from "@vibeshape/automation-api/drafts"
import { isLocalSketchTextOperation } from "@vibeshape/automation-api/local-sketch-text-tools"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import type { AutomationHost } from "@vibeshape/automation-host/host"
import { commandActorSchema, parseDocumentCommand } from "@vibeshape/domain/commands"
import { type SketchRecord, sketchRecordSchema } from "@vibeshape/domain/sketch"
import { BUNDLED_SKETCH_TEXT_FONT } from "@vibeshape/domain/sketch-text"
import { describe, expect, it, vi } from "vitest"
import { loadSketchTextFont } from "../features/sketch/text/text-font"
import { createLocalToolExecutor } from "./local-tool-executor"

const font = Uint8Array.from(
  readFileSync("packages/formats/src/text-outline/fonts/NotoSans-Regular.ttf"),
)
vi.mock("../features/sketch/text/text-font", async (original) => ({
  ...(await original<typeof import("../features/sketch/text/text-font")>()),
  loadSketchTextFont: vi.fn(async () => Uint8Array.from(font)),
}))
const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.client",
  sessionId: id(99),
})
const intent = {
  text: "O",
  heightMm: 10,
  trackingMm: 0,
  alignment: { horizontal: "left", vertical: "baseline" },
  kerning: true,
}
function fixture(
  sketch = sketchRecordSchema.parse({
    schemaVersion: 0,
    id: id(1),
    label: "Text sketch",
    plane: "xy",
    entities: [],
    constraints: [],
  }),
) {
  let current = sketch
  const readOwnedSketch = vi.fn<NonNullable<AutomationHost["readOwnedSketch"]>>(async () => ({
    ok: true as const,
    value: sketchRecordSchema.parse(current),
  }))
  const applyCommand = vi.fn<AutomationHost["applyCommand"]>(async (_actor, input) => {
    const parsed = parseDocumentCommand(
      applyAutomationDraftCommandRequestSchema.parse(input).command,
    )
    if (!parsed.ok || parsed.command.kind !== "org.vibeshape.sketch.update")
      throw new Error("Expected a registered sketch update.")
    current = parsed.command.payload.sketch
    return {
      ok: true as const,
      value: automationDraftStateSchema.parse({
        schemaVersion: 1,
        draftId: id(20),
        documentId: id(10),
        baseRevision: 2,
        revision: parsed.command.baseRevision + 1,
        commandCount: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }
  })
  const host = {
    readOwnedSketch,
    applyCommand,
    createDraft: vi.fn(),
    inspectDraft: vi.fn(),
    previewDraft: vi.fn(),
    commitDraft: vi.fn(),
    discardDraft: vi.fn(),
  }
  const executor = createLocalToolExecutor(
    {
      host,
      documentId: id(10),
      revision: 0,
      readInfo: () => null,
      readCad: vi.fn(),
      exportRevisionBound: vi.fn(),
    },
    actor,
  )
  return {
    executor,
    host,
    current: () => current,
    replace: (value: SketchRecord) => {
      current = value
    },
  }
}
function operation(tool = "create_sketch_text", extra: Record<string, unknown> = {}) {
  const value = localOperationSchema.parse({
    tool,
    arguments: {
      draftId: id(20),
      baseRevision: 2,
      commandId: id(21),
      sketchId: id(1),
      groupId: id(2),
      ...(tool === "detach_sketch_text" ? {} : { intent, origin: [12, -8] }),
      ...extra,
    },
  })
  if (!isLocalSketchTextOperation(value)) throw new Error("Expected a named text operation.")
  return value
}
describe("owned sketch text MCP commands", () => {
  it("prepares a full supported 64-scalar text group without transporting its generated geometry as tool input", async () => {
    const f = fixture()
    expect(
      await f.executor.execute(
        operation("create_sketch_text", { intent: { ...intent, text: "I".repeat(64) } }),
      ),
    ).toMatchObject({ ok: true })
    expect(f.current().textGroups?.[0]?.parameters.text).toHaveLength(64)
    expect(f.current().entities.length).toBeGreaterThan(64)
    expect(f.current().textGroups?.[0]?.outlineDigest).toMatch(/^[a-f0-9]{64}$/)
  })
  it("generates pinned exact outlines, updates stable text intent and detaches without changing geometry", async () => {
    const f = fixture()
    expect(await f.executor.execute(operation())).toMatchObject({ ok: true })
    const created = f.current(),
      group = created.textGroups?.[0]
    expect(group).toMatchObject({
      id: id(2),
      origin: [12, -8],
      parameters: { text: "O", font: BUNDLED_SKETCH_TEXT_FONT },
    })
    expect(created.entities.some(({ type }) => type === "cubic-bezier")).toBe(true)
    expect(
      await f.executor.execute(
        operation("update_sketch_text", {
          intent: { ...intent, text: "D" },
          removeAttachedConstraints: false,
        }),
      ),
    ).toMatchObject({ ok: true })
    const updated = f.current()
    expect(updated.textGroups?.[0]).toMatchObject({ id: id(2), parameters: { text: "D" } })
    expect(updated.textGroups?.[0]?.outlineDigest).not.toBe(group?.outlineDigest)
    expect(await f.executor.execute(operation("detach_sketch_text"))).toMatchObject({ ok: true })
    expect(f.current().entities).toEqual(updated.entities)
    expect(f.current().constraints).toEqual(updated.constraints)
    expect(f.current().textGroups).toEqual([])
    expect(f.host.readOwnedSketch).toHaveBeenCalledWith(actor, {
      schemaVersion: 1,
      draftId: id(20),
      revision: 2,
      sketchId: id(1),
    })
  })
  it("preserves attached constraints until explicit regeneration removal and rejects unknown group identities", async () => {
    const f = fixture()
    await f.executor.execute(operation())
    const point = f.current().textGroups?.[0]?.pointIds[0]
    if (!point) throw new Error("Expected generated outline points.")
    f.replace(
      sketchRecordSchema.parse({
        ...f.current(),
        constraints: [{ schemaVersion: 0, id: id(30), type: "fixed", pointId: point }],
      }),
    )
    const captured = f.current()
    expect(
      await f.executor.execute(
        operation("update_sketch_text", { removeAttachedConstraints: false }),
      ),
    ).toMatchObject({ ok: false })
    expect(f.current()).toEqual(captured)
    expect(
      await f.executor.execute(
        operation("update_sketch_text", { removeAttachedConstraints: true }),
      ),
    ).toMatchObject({ ok: true })
    expect(f.current().constraints).toEqual([])
    expect(
      await f.executor.execute(operation("detach_sketch_text", { groupId: id(31) })),
    ).toMatchObject({ ok: false, diagnostic: { code: "text-group-mismatch" } })
  })
  it("forwards stale/expired/foreign owner rejection before font work or command dispatch", async () => {
    const f = fixture()
    f.host.readOwnedSketch.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "draft-owner-mismatch",
        message: "Foreign draft",
        retryable: false,
        issues: [],
      },
    })
    expect(await f.executor.execute(operation())).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-owner-mismatch" },
    })
    expect(f.host.applyCommand).not.toHaveBeenCalled()
  })
  it("does not dispatch a prepared outline after cancellation while font bytes are loading", async () => {
    const f = fixture(),
      controller = new AbortController()
    vi.mocked(loadSketchTextFont).mockImplementationOnce(async () => {
      controller.abort()
      return font
    })
    expect(await f.executor.execute(operation(), controller.signal)).toMatchObject({
      ok: false,
      diagnostic: { code: "request-cancelled" },
    })
    expect(f.host.applyCommand).not.toHaveBeenCalled()
  })
  it("rechecks document authority after asynchronous font preparation before dispatch", async () => {
    const f = fixture()
    vi.mocked(loadSketchTextFont).mockImplementationOnce(async () => {
      f.host.readOwnedSketch.mockResolvedValueOnce({
        ok: false,
        diagnostic: {
          code: "stale-revision",
          message: "The committed document changed during preparation.",
          retryable: true,
          issues: [],
        },
      })
      return font
    })
    const captured = f.current()
    expect(await f.executor.execute(operation())).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(f.host.applyCommand).not.toHaveBeenCalled()
    expect(f.current()).toEqual(captured)
  })
})
