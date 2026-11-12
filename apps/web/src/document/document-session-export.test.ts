import { describe, expect, it } from "bun:test"
import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { vi } from "../../../../tests/unit/support/bun-test"
import { exportSessionGeometry } from "./document-session-export"

const rebuildFailed = {
  code: "rebuild-failed" as const,
  message: "The committed document could not be rebuilt. Its semantic revision remains saved.",
  retryable: true,
  sourceCode: null,
}
/** A report at `revision` whose rebuild succeeded or failed. */
function report(revision = 3, rebuilt = true) {
  return {
    snapshot: { revision },
    rebuild: rebuilt
      ? { ok: true, response: { geometry: [] } }
      : { ok: false, diagnostic: rebuildFailed },
  } as unknown as PersistentDocumentSessionReport
}

/** A session at revision 3 whose worker exports the given rebuild revision. */
function session(produced = 3) {
  return {
    snapshot: { id: "0195b5ac-b220-7a2c-8c33-67a36a7f0001", name: "Bracket", revision: 3 },
    authoredSnapshot: null,
    exportDocument: vi.fn(async () => ({
      ok: true as const,
      response: {
        revision: produced,
        format: "step" as const,
        file: new Uint8Array([1, 2, 3]),
        bodyCount: 1,
      },
    })),
  }
}

function exported(active: ReturnType<typeof session>, current: PersistentDocumentSessionReport) {
  return exportSessionGeometry({
    session: active as never,
    report: current,
    format: "step",
    isCurrent: () => true,
  })
}

describe("exportSessionGeometry", () => {
  it("exports the captured revision when report and worker are current", async () => {
    const active = session()
    expect(await exported(active, report())).toMatchObject({
      ok: true,
      format: "step",
      bodyCount: 1,
      documentName: "Bracket",
    })
  })

  it("refuses a report that lags the session without exporting", async () => {
    const active = session()
    expect(await exported(active, report(2))).toMatchObject({
      ok: false,
      diagnostic: { retryable: true, sourceCode: "stale-revision" },
    })
    expect(active.exportDocument).not.toHaveBeenCalled()
  })

  it("reports a failed rebuild as final without exporting an earlier rebuild", async () => {
    const active = session()
    expect(await exported(active, report(3, false))).toMatchObject({
      ok: false,
      diagnostic: { retryable: false, sourceCode: "rebuild-failed" },
    })
    expect(active.exportDocument).not.toHaveBeenCalled()
  })

  it("rejects geometry the worker produced from an older revision", async () => {
    expect(await exported(session(2), report())).toMatchObject({
      ok: false,
      diagnostic: { retryable: true, sourceCode: "stale-revision" },
    })
  })

  it("reports a retryable stale revision when the project changes during export", async () => {
    const active = session()
    active.exportDocument.mockImplementationOnce(async () => {
      active.snapshot.revision = 4
      return {
        ok: true as const,
        response: { revision: 3, format: "step" as const, file: new Uint8Array([1]), bodyCount: 1 },
      }
    })
    expect(await exported(active, report())).toMatchObject({
      ok: false,
      diagnostic: { retryable: true, sourceCode: "stale-revision" },
    })
  })
})
