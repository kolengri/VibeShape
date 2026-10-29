import { describe, expect, it } from "bun:test"
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { localFailure, localToolNameSchema } from "@vibeshape/automation-api/local-tools"
import { z } from "zod"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "../../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { toolInputDefaultFixtures } from "../../../../packages/automation-api/src/tool-input-schema.test-fixtures"
import { apiProviderTools, apiQuestionInputSchema, createApiCadGateway } from "./api-cad-tools"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const otherProjectId = "0195b5ac-b250-7a2c-8c33-000000000102"
const signal = new AbortController().signal
const pageSchema = z.object({
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: z.unknown() })),
  total: z.number(),
  nextCursor: z.number().nullable(),
})

describe("browser CAD gateway", () => {
  it("offers CAD gateway and structured-question functions and discovers the full project-safe canonical catalog by pages", async () => {
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => true,
      execute: async () => {
        throw new Error("Discovery must not execute CAD.")
      },
    })
    const names: string[] = []
    let cursor: number | null = 0
    while (cursor !== null) {
      const page = pageSchema.parse(
        await gateway("discover_cad_tools", { cursor, limit: 6 }, signal),
      )
      names.push(...page.tools.map((tool) => tool.name))
      cursor = page.nextCursor
    }
    expect(apiProviderTools.map((tool) => tool.function.name)).toEqual([
      "discover_cad_tools",
      "call_cad_tool",
      "ask_user_question",
    ])
    expect(names).toEqual([
      "read_agent_skill",
      ...localToolNameSchema.options.filter(
        (name) =>
          ![
            "list_projects",
            "open_project",
            "create_project",
            "get_numerical_job",
            "cancel_numerical_job",
            "read_project_chat",
          ].includes(name),
      ),
    ])
    const box = pageSchema.parse(
      await gateway("discover_cad_tools", { query: "create box" }, signal),
    )
    expect(box.tools.some((tool) => tool.name === "create_box" && Boolean(tool.inputSchema))).toBe(
      true,
    )
    const dependencies = pageSchema.parse(
      await gateway("discover_cad_tools", { query: "model_dependencies" }, signal),
    ).tools[0]
    expect(dependencies?.inputSchema).toMatchObject({ required: ["revision", "entity"] })
    const usage = pageSchema.parse(
      await gateway("discover_cad_tools", { query: "model_variable_usage" }, signal),
    ).tools[0]
    expect(usage?.inputSchema).toMatchObject({ required: ["revision", "variableId"] })
    expect(
      await gateway("call_cad_tool", { name: "read_agent_skill", arguments: {} }, signal),
    ).toMatchObject({ ok: true, value: { mimeType: "application/json" } })
  })
  it("discovers client-valid default omissions and canonical sketches through the browser catalog", async () => {
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => true,
      execute: async () => {
        throw new Error("Discovery must not execute CAD.")
      },
    })
    const validator = new AjvJsonSchemaValidator()
    const fixtures = toolInputDefaultFixtures.filter(({ name }) => name !== "list_projects")
    for (const fixture of [...fixtures, { name: "read_agent_skill", arguments: {} }]) {
      const page = pageSchema.parse(
        await gateway("discover_cad_tools", { query: fixture.name, limit: 6 }, signal),
      )
      const tool = page.tools.find(({ name }) => name === fixture.name)
      if (!tool) throw new Error(`Missing discovered ${fixture.name} tool.`)
      const { inputSchema } = ToolSchema.parse(tool)
      // SDK validation follows the same advertised JSON contract as external clients.
      const validate = validator.getValidator({
        ...inputSchema,
        properties: inputSchema.properties ?? {},
        required: inputSchema.required ?? [],
      })
      expect(validate(fixture.arguments).valid).toBe(true)
    }
  })
  it("retains shared field bounds while rejecting secret requests and invalid question forms", () => {
    const input = {
      message: "Choose a size",
      fields: [{ id: "size", label: "Size", required: true, minLength: 2, maxLength: 10 }],
    }
    expect(apiQuestionInputSchema.parse(input).fields[0]?.secret).toBe(false)
    expect(
      apiQuestionInputSchema.safeParse({ ...input, fields: [{ ...input.fields[0], secret: true }] })
        .success,
    ).toBe(false)
    expect(
      apiQuestionInputSchema.safeParse({
        ...input,
        fields: [{ ...input.fields[0], minLength: 11 }],
      }).success,
    ).toBe(false)
  })

  it("rejects project switching, invalid tool arguments, foreign project IDs and stale sessions before execution", async () => {
    let calls = 0,
      active = true
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => active,
      execute: async () => {
        calls += 1
        return localFailure("not-available", "Unavailable")
      },
    })
    for (const name of [
      "create_project",
      "open_project",
      "list_projects",
      "get_numerical_job",
      "cancel_numerical_job",
      "read_project_chat",
    ])
      await expect(gateway("call_cad_tool", { name, arguments: {} }, signal)).rejects.toMatchObject(
        { code: "invalid-tool" },
      )
    await expect(
      gateway("call_cad_tool", { name: "create_box", arguments: { widthMm: "bad" } }, signal),
    ).rejects.toMatchObject({ code: "invalid-tool" })
    await expect(
      gateway(
        "call_cad_tool",
        { name: "model_info", arguments: { projectId: otherProjectId } },
        signal,
      ),
    ).rejects.toMatchObject({ code: "invalid-tool" })
    active = false
    await expect(
      gateway("call_cad_tool", { name: "model_info", arguments: {} }, signal),
    ).rejects.toMatchObject({ code: "stale-project" })
    expect(calls).toBe(0)
    active = true
    expect(
      await gateway("call_cad_tool", { name: "model_info", arguments: {} }, signal),
    ).toMatchObject({ ok: false })
    expect(calls).toBe(1)
  })

  it("contains unexpected CAD failures without misreporting them as provider network errors", async () => {
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => true,
      execute: async () => {
        throw new Error("Private CAD implementation details")
      },
    })
    await expect(
      gateway("call_cad_tool", { name: "model_info", arguments: {} }, signal),
    ).rejects.toMatchObject({ code: "tool-failed", message: "tool-failed" })
  })

  it("accepts final numerical evidence and rejects MCP receipts in the direct API gateway", async () => {
    const operation = quickLightweightingOperation()
    let result: unknown = {
      ok: true,
      value: { ...quickLightweightingValue(), documentId: projectId },
    }
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => true,
      execute: async () => result,
    })
    const input = { name: operation.tool, arguments: operation.arguments }
    expect(await gateway("call_cad_tool", input, signal)).toEqual(result)
    result = {
      ok: true,
      value: {
        jobId: otherProjectId,
        tool: operation.tool,
        documentId: projectId,
        baseRevision: 4,
        status: "running",
      },
    }
    await expect(gateway("call_cad_tool", input, signal)).rejects.toMatchObject({
      code: "tool-failed",
    })
  })

  it("describes numerical execution as awaiting final results in the browser API connection", async () => {
    const gateway = createApiCadGateway({
      projectId,
      isActive: () => true,
      execute: async () => {
        throw new Error("Discovery must not execute CAD.")
      },
    })
    for (const name of [
      "analyze_lightweighting",
      "request_lightweighting",
      "analyze_quick_lightweighting",
      "request_quick_lightweighting",
      "analyze_print_optimization",
      "request_print_optimization",
    ]) {
      const tool = pageSchema
        .parse(await gateway("discover_cad_tools", { query: name }, signal))
        .tools.find((tool) => tool.name === name)
      expect(tool?.description).toContain("await the final numerical result directly in this call")
      expect(tool?.description).toContain("no job receipt is returned")
      if (name.includes("print_optimization"))
        expect(tool?.inputSchema).toMatchObject({
          properties: { settings: { required: ["bedFace", "material"] } },
        })
    }
  })
})
