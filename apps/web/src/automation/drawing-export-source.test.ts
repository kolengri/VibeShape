import { describe, expect, it } from "bun:test"
import { binaryExportDescriptorSchema } from "@vibeshape/automation-api/binary-exports"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { DRAWING_CHORD_TOLERANCE_MM, type DrawingViewId } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { ActiveDocumentDrawingResult } from "../document/document-drawing"
import { createBinaryExportSession } from "./binary-export-session"
import { createDrawingExportPreparer } from "./drawing-export-source"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = { type: "mcp", clientId: "org.example.client", sessionId: id(2) }

function drawn(views: readonly DrawingViewId[], revision = 4): ActiveDocumentDrawingResult {
  return {
    ok: true,
    documentId: id(1),
    revision,
    documentName: "Bracket",
    projection: {
      chordTolerance: DRAWING_CHORD_TOLERANCE_MM,
      bodyCount: 1,
      views: views.map((view) => ({
        view,
        bounds: { min: [0, 0], max: [40, 10] },
        edges: [
          {
            visibility: "visible",
            edgeClass: "sharp",
            curve: { kind: "line", start: [0, 0], end: [40, 10] },
          },
        ],
      })),
    },
  }
}

function fixture(project = vi.fn(async (views: readonly DrawingViewId[]) => drawn(views))) {
  let revision = 4
  const session = createBinaryExportSession({
    documentId: id(1),
    currentRevision: () => revision,
    isActive: () => true,
    prepare: vi.fn(),
    prepareDrawing: createDrawingExportPreparer({
      documentId: id(1),
      currentRevision: () => revision,
      project,
    }),
    hash: async () => "b".repeat(64),
    now: () => Date.parse("2026-11-11T00:00:00Z"),
    createExportId: () => id(9),
  })
  return { session, project, setRevision: (value: number) => (revision = value) }
}

function operation(argumentsValue: unknown) {
  const parsed = localOperationSchema.parse({
    tool: "prepare_drawing_export",
    arguments: argumentsValue,
  })
  if (parsed.tool !== "prepare_drawing_export") throw new Error("Expected a drawing export.")
  return parsed
}

describe("prepare_drawing_export", () => {
  it.each([
    ["svg", "drawing.svg", "image/svg+xml", "<?xml"],
    ["dxf", "drawing.dxf", "image/vnd.dxf", "0\r\nSECTION"],
    ["pdf", "drawing.pdf", "application/pdf", "%PDF-1.4"],
  ] as const)(
    "prepares a %s sheet through the dialog writers",
    async (format, filename, mimeType, head) => {
      const f = fixture()
      const result = await f.session.execute(actor, operation({ revision: 4, format }))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("Expected a prepared drawing.")
      const descriptor = binaryExportDescriptorSchema.parse(result.value)
      expect(descriptor).toMatchObject({ format, filename, mimeType, revision: 4 })
      expect(f.project).toHaveBeenCalledWith(["front", "top", "right", "isometric"], undefined)
      const chunk = await f.session.execute(actor, {
        tool: "read_export_chunk",
        arguments: { exportId: descriptor.exportId, offset: 0, limit: 64 },
      })
      if (!chunk.ok) throw new Error("Expected a chunk.")
      const text = atob((chunk.value as { base64: string }).base64)
      expect(text.startsWith(head)).toBe(true)
    },
  )

  it("applies settings and part selection and reports kernel failures", async () => {
    const project = vi.fn(async (views: readonly DrawingViewId[]) => drawn(views))
    const f = fixture(project)
    const partId = id(7)
    await f.session.execute(
      actor,
      operation({
        revision: 4,
        format: "svg",
        partId,
        settings: { views: ["isometric", "front"], projection: "third-angle" },
      }),
    )
    expect(project).toHaveBeenCalledWith(["front", "isometric"], partId)
    project.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "export-failed",
        message: "Drawings require exact solids; triangle-mesh parts cannot be projected.",
        retryable: true,
        sourceCode: "export-failed",
      },
    })
    expect(await f.session.execute(actor, operation({ revision: 4, format: "pdf" }))).toMatchObject(
      {
        ok: false,
        diagnostic: { code: "drawing-failed", message: expect.stringContaining("triangle-mesh") },
      },
    )
  })

  it("rejects stale revisions and projections of another revision", async () => {
    const project = vi.fn(async (views: readonly DrawingViewId[]) => drawn(views, 5))
    const f = fixture(project)
    expect(await f.session.execute(actor, operation({ revision: 4, format: "dxf" }))).toMatchObject(
      {
        ok: false,
      },
    )
    f.setRevision(6)
    expect(await f.session.execute(actor, operation({ revision: 4, format: "dxf" }))).toMatchObject(
      {
        ok: false,
        diagnostic: { code: "stale-revision" },
      },
    )
  })

  it("validates arguments before preparation", () => {
    for (const invalid of [
      { revision: 4, format: "png" },
      { revision: 4, format: "pdf", settings: { views: [] } },
      {
        revision: 4,
        format: "pdf",
        settings: { scale: { mode: "explicit", numerator: 0, denominator: 1 } },
      },
      { revision: 4, format: "pdf", extra: true },
    ])
      expect(
        localOperationSchema.safeParse({ tool: "prepare_drawing_export", arguments: invalid })
          .success,
      ).toBe(false)
  })
})
