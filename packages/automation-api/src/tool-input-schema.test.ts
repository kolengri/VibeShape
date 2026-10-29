import { describe, expect, it } from "bun:test"
import { agentSkillTool, callAgentSkillTool } from "./agent-skills"
import { localToolNameSchema, mcpToolInputJsonSchema, parseMcpToolCall } from "./local-tools"
import { toolInputDefaultFixtures } from "./tool-input-schema.test-fixtures"

describe("canonical MCP input JSON schemas", () => {
  it("serializes every registered CAD input, including canonical sketch preprocessing outputs", () => {
    for (const name of localToolNameSchema.options) {
      const schema = mcpToolInputJsonSchema(name)
      expect(schema.type).toBe("object")
      expect(JSON.stringify(schema).length).toBeGreaterThan(0)
    }
  })
  it.each(toolInputDefaultFixtures)("retains accepted omissions for $name", (fixture) => {
    expect(parseMcpToolCall(fixture.name, fixture.arguments).success).toBe(true)
  })
  it("advertises the actual defaulted pagination and no-argument skill inputs", () => {
    expect(mcpToolInputJsonSchema("list_projects").required ?? []).toEqual([])
    expect(mcpToolInputJsonSchema("model_parts").required).toEqual(["revision"])
    expect(mcpToolInputJsonSchema("read_export_chunk").required).toEqual(["exportId", "offset"])
    expect(mcpToolInputJsonSchema("model_sketch_solution").required).toEqual([
      "revision",
      "sketchId",
    ])
    expect(agentSkillTool.inputSchema.required ?? []).toEqual([])
    expect(callAgentSkillTool({}).isError).toBe(false)
  })
})
