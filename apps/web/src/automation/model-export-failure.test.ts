import { describe, expect, it } from "bun:test"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createBinaryExportSession } from "./binary-export-session"
import { modelExportFailure, preparedModelExport } from "./model-export-failure"

const documentId = "0195b5ac-b250-7a2c-8c33-000000000001"
const actor = { type: "mcp", clientId: "org.example.client", sessionId: documentId }
const rebuildFailed = {
  code: "rebuild-failed",
  message: "The committed document could not be rebuilt.",
  retryable: false,
  sourceCode: "rebuild-failed",
}

describe("model export failures over MCP", () => {
  it.each([
    [rebuildFailed, { code: "rebuild-failed", retryable: false }],
    [
      { code: "export-failed", message: "Changed.", retryable: true, sourceCode: "stale-revision" },
      { code: "stale-revision", retryable: true },
    ],
    [
      { code: "stale-revision", message: "Changed before export.", retryable: true },
      { code: "stale-revision", retryable: true },
    ],
    [
      { code: "export-failed", message: "No bodies.", retryable: false, sourceCode: "x" },
      { code: "export-failed", retryable: false },
    ],
    [
      { code: "export-failed", message: "Worker lost.", retryable: true, sourceCode: null },
      { code: "export-failed", retryable: true },
    ],
  ])("maps %o", (diagnostic, expected) => {
    expect(modelExportFailure(diagnostic)).toEqual({ ...expected, message: diagnostic.message })
  })

  it("reports a failed rebuild from prepare_model_export as final", async () => {
    const session = createBinaryExportSession({
      documentId,
      currentRevision: () => 4,
      isActive: () => true,
      prepare: vi.fn(async (format, revision) =>
        preparedModelExport({ ok: false, diagnostic: rebuildFailed }, documentId, revision, format),
      ),
      hash: vi.fn().mockResolvedValue("a".repeat(64)),
    })
    expect(
      await session.execute(actor, {
        tool: "prepare_model_export",
        arguments: { revision: 4, format: "step" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "rebuild-failed", retryable: false } })
  })
})
