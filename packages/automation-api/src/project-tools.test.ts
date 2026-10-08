import { describe, expect, it } from "bun:test"
import { localOperationSchema, mcpToolInputSchema, parseMcpToolCall } from "./local-tools"
import { projectResultContextMatches } from "./project-result-context"

const a = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
const b = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"

describe("project MCP contracts", () => {
  it("requires explicit source identity and revision for project transitions", () => {
    expect(parseMcpToolCall("create_project", { name: "Part" }).success).toBe(false)
    expect(parseMcpToolCall("open_project", { projectId: b }).success).toBe(false)
    expect(
      parseMcpToolCall("create_project", {
        name: " Part ",
        expectedProjectId: a,
        expectedRevision: 1,
      }).success,
    ).toBe(false)
    expect(parseMcpToolCall("list_projects", { limit: 101 }).success).toBe(false)
    expect(parseMcpToolCall("list_projects", {}).success).toBe(true)
  })
  it("separates a CAD target guard from strict command payloads", () => {
    const result = parseMcpToolCall("create_draft", { projectId: a, baseRevision: 4 })
    expect(result.success && result.data).toEqual<unknown>({
      tool: "create_draft",
      projectId: a,
      arguments: { baseRevision: 4 },
    })
    expect(parseMcpToolCall("create_draft", { projectId: "wrong", baseRevision: 4 }).success).toBe(
      false,
    )
    expect(
      parseMcpToolCall("create_draft", { projectId: a, baseRevision: 4, script: "anything" })
        .success,
    ).toBe(false)
    expect(
      mcpToolInputSchema("render_preview").safeParse({ source: "model", revision: 4, projectId: a })
        .success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "model_info",
        arguments: {},
        projectId: a,
        token: "unexpected",
      }).success,
    ).toBe(false)
  })
  it("binds project receipts to the requested destination and source", () => {
    const operation = localOperationSchema.parse({
      tool: "open_project",
      arguments: { projectId: b, expectedProjectId: a, expectedRevision: 4 },
    })
    if (operation.tool !== "open_project") throw new Error("Unexpected tool")
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { projectId: a, name: "Source", revision: 4 } },
        a,
      ),
    ).toBe(false)
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { projectId: b, name: "Target", revision: 2 } },
        b,
      ),
    ).toBe(false)
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { projectId: b, name: "Target", revision: 2 } },
        a,
      ),
    ).toBe(true)
  })
  it("rejects oversized, duplicate and out-of-order catalog pages", () => {
    const operation = localOperationSchema.parse({ tool: "list_projects", arguments: { limit: 1 } })
    if (operation.tool !== "list_projects") throw new Error("Unexpected tool")
    const project = {
      projectId: a,
      name: "Source",
      revision: 4,
      updatedAt: "2026-10-04T00:00:00.000Z",
    }
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { activeProjectId: a, projects: [project, project], nextCursor: null } },
        a,
      ),
    ).toBe(false)
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { activeProjectId: a, projects: [project], nextCursor: b } },
        a,
      ),
    ).toBe(false)
    expect(
      projectResultContextMatches(
        operation,
        { ok: true, value: { activeProjectId: a, projects: [project], nextCursor: a } },
        a,
      ),
    ).toBe(true)
  })
})
