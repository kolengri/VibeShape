import { describe, expect, it, mock } from "bun:test"
import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { DRAWING_CHORD_TOLERANCE_MM } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"

const parts = vi.fn((): unknown[] | null => null)
const partsModule = { ...(await import("@vibeshape/application/authored-parts")) }
mock.module("@vibeshape/application/authored-parts", () => ({
  ...partsModule,
  resolveAuthoredParts: parts,
}))
const { projectSessionDrawing } = await import("./document-drawing")

const projection = { chordTolerance: DRAWING_CHORD_TOLERANCE_MM, bodyCount: 1, views: [] }

function session(revision = 3) {
  const snapshot = { id: "0195b5ac-b220-7a2c-8c33-67a36a7f0001", name: "Bracket", revision }
  return {
    snapshot,
    authoredSnapshot: null,
    projectDrawing: vi.fn(async () => {
      snapshot.revision = revision
      return { ok: true as const, projection }
    }),
  }
}

describe("projectSessionDrawing", () => {
  it("omits body selection for all parts so the worker can skip mesh bodies", async () => {
    const active = session()
    const result = await projectSessionDrawing({
      session: active as never,
      report: {} as PersistentDocumentSessionReport,
      views: ["front"],
      isCurrent: () => true,
    })
    expect(active.projectDrawing).toHaveBeenCalledWith(["front"], {})
    expect(result).toMatchObject({ ok: true, revision: 3, documentName: "Bracket" })
  })

  it("reports a retryable stale revision when the project changes while drawing", async () => {
    const active = session()
    active.projectDrawing.mockImplementationOnce(async () => {
      active.snapshot.revision = 4
      return { ok: true as const, projection }
    })
    expect(
      await projectSessionDrawing({
        session: active as never,
        report: {} as PersistentDocumentSessionReport,
        views: ["top"],
        isCurrent: () => true,
      }),
    ).toMatchObject({ ok: false, diagnostic: { retryable: true, sourceCode: "stale-revision" } })
  })

  it("reports an unknown or bodiless part as non-retryable part-not-found", async () => {
    const solid = "0195b5ac-b220-7a2c-8c33-67a36a7f0101"
    const empty = "0195b5ac-b220-7a2c-8c33-67a36a7f0102"
    parts.mockReturnValue([
      { part: { id: solid }, body: { featureId: "a" } },
      { part: { id: empty }, body: null },
    ])
    const active = { ...session(), authoredSnapshot: { schemaVersion: 6 } }
    for (const partId of ["0195b5ac-b220-7a2c-8c33-67a36a7f0199", empty])
      expect(
        await projectSessionDrawing({
          session: active as never,
          report: {} as PersistentDocumentSessionReport,
          views: ["front"],
          partId,
          isCurrent: () => true,
        }),
      ).toEqual({
        ok: false,
        diagnostic: {
          code: "export-failed",
          message: "The requested part does not exist or has no body to draw.",
          retryable: false,
          sourceCode: "part-not-found",
        },
      })
    expect(active.projectDrawing).not.toHaveBeenCalled()
  })
})
