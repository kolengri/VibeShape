import { describe, expect, it } from "bun:test"
import { localFailure, localToolNameSchema } from "@vibeshape/automation-api/local-tools"
import { z } from "zod"
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
        (name) => !["list_projects", "open_project", "create_project"].includes(name),
      ),
    ])
    const box = pageSchema.parse(
      await gateway("discover_cad_tools", { query: "create box" }, signal),
    )
    expect(box.tools.some((tool) => tool.name === "create_box" && Boolean(tool.inputSchema))).toBe(
      true,
    )
    expect(
      await gateway("call_cad_tool", { name: "read_agent_skill", arguments: {} }, signal),
    ).toMatchObject({ ok: true, value: { mimeType: "application/json" } })
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
    for (const name of ["create_project", "open_project", "list_projects"])
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
})
