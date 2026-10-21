import { describe, expect, test } from "bun:test"
import { assistantConnectionTestResultSchema, assistantConnectionTestSchema } from "./assistant"

describe("assistant connection-test protocol", () => {
  test("accepts bounded diagnostics and adapter-only success", () => {
    expect(assistantConnectionTestResultSchema.parse({ ok: true, checks: ["agent"] })).toEqual({
      ok: true,
      checks: ["agent"],
    })
    expect(
      assistantConnectionTestResultSchema.parse({
        ok: false,
        stage: "jev",
        code: "request-failed",
        httpStatus: 401,
      }),
    ).toEqual({ ok: false, stage: "jev", code: "request-failed", httpStatus: 401 })
  })
  test.each([
    { ok: true, checks: [] },
    { ok: true, checks: ["agent", "agent"] },
    { ok: true, checks: ["cad"] },
    { ok: false, code: "request-failed" },
    { ok: false, code: "request-failed", stage: "jev", httpStatus: "401" },
    { ok: false, code: "request-failed", stage: "jev", httpStatus: 600 },
    { ok: false, code: "request-failed", stage: "jev", message: "provider secret" },
  ])("rejects malformed or secret-bearing result %j", (result) => {
    expect(assistantConnectionTestResultSchema.safeParse(result).success).toBe(false)
  })
  test("accepts no session, model context, MCP setup or credentials for external agents", () => {
    const input = { projectId: "project", agent: { command: "adapter", args: [] } }
    expect(assistantConnectionTestSchema.safeParse(input).success).toBe(true)
    for (const extra of [
      { resumeSessionId: "session" },
      { mcpServers: [] },
      { model: {} },
      { jevCredentials: { apiKey: "secret" } },
    ]) {
      expect(assistantConnectionTestSchema.safeParse({ ...input, ...extra }).success).toBe(false)
    }
  })
})
