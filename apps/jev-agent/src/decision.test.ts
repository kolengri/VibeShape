import { describe, expect, test } from "bun:test"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import { agentSkillTool, readAgentSkillResource } from "@vibeshape/automation-api/agent-skills"
import { isAssemblyLibraryToolName } from "@vibeshape/automation-api/assembly-result-context"
import { assistantQuestionTool } from "@vibeshape/automation-api/assistant"
import {
  localModelInfoSchema,
  localToolNameSchema,
  mcpToolInputSchema,
} from "@vibeshape/automation-api/local-tools"
import { localToolDescriptions } from "@vibeshape/automation-api/tool-metadata"
import { z } from "zod"
import { projectAssistantContext } from "../../desktop/src/assistant-project-context"
import type { DecisionState } from "./contracts"
import { createController } from "./controller"
import { createJevDecision } from "./decision"

const state: DecisionState = {
  goal: "Create a box",
  instructions: "Use millimetres.",
  history: [],
  photos: [],
}
const signal = () => new AbortController().signal
const inspectTool: Tool = {
  name: "model_info",
  description: "Read the current model.",
  inputSchema: { type: "object", properties: {} },
}
const answer = (selected: string, confidence = 0.95) => ({
  type: "choice",
  choice: selected,
  confidence,
  probabilities: { [selected]: 1 },
})
const requestSchema = z.object({
  model: z.string(),
  questions: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      instructions: z.string(),
      criteria: z.record(z.string(), z.unknown()),
    }),
  ),
})

function fixture(answers: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const client = new TypeSafeClient({
    apiKey: "test-only-key",
    defaultModel: "wrong-default",
    compression: false,
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      // Bun's native buffered Response becomes consumed by the SDK's reader-lock cycle.
      const body = JSON.stringify({
        answers,
        model: "jev-pinned",
        usage: { input_tokens: 20, output_tokens: 5 },
      })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body))
            controller.close()
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    },
  })
  return { decide: createJevDecision(client, "jev-pinned"), calls }
}

function cadTools() {
  return localToolNameSchema.options.map((name) =>
    ToolSchema.parse({
      name,
      description: localToolDescriptions[name],
      inputSchema: {
        ...z.toJSONSchema(mcpToolInputSchema(name), {
          reused: "ref",
          io: isAssemblyLibraryToolName(name) || name === "list_projects" ? "input" : "output",
        }),
        type: "object",
      },
    }),
  )
}

describe("Jev decision batching", () => {
  test("keeps the real CAD catalog within the selector budget without transmitting nested schemas", async () => {
    const tools = cadTools()
    const { decide, calls } = fixture({ action: answer("done") })
    const instructions = readAgentSkillResource("vibeshape://agent-skills/vibeshape-use/SKILL.md")
      ?.contents[0]?.text
    expect(instructions).toBeDefined()
    const history = [
      { tool: "old_read", arguments: {}, result: "old".repeat(6000) },
      { tool: "model_info", arguments: {}, result: { evidence: "x".repeat(20_000) } },
    ]
    await decide(
      {
        ...state,
        goal: `${projectAssistantContext("0195b5ac-b213-7f2c-9c33-67a36a7f21ac")}\nCreate a bicycle bottle-cage container.`,
        instructions: instructions ?? "",
        history,
      },
      [...tools, agentSkillTool, assistantQuestionTool].map((tool) => ToolSchema.parse(tool)),
      signal(),
    )
    expect(tools.length).toBeGreaterThan(150)
    const body = String(calls[0]?.init.body)
    expect(Buffer.byteLength(body)).toBeLessThan(256 * 1024)
    const payload = requestSchema.parse(JSON.parse(body))
    const context = z
      .object({
        state: z.looseObject({
          catalog: z.record(z.string(), z.string()),
          history: z.array(z.unknown()),
        }),
      })
      .parse(JSON.parse(body)).state
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(128_000)
    expect(Object.values(context.catalog)).toEqual([
      ...tools.map((tool) => tool.description ?? ""),
      agentSkillTool.description,
      assistantQuestionTool.description,
    ])
    expect(context.history).toEqual(history)
    expect(history).toHaveLength(2)
    expect(Object.values(payload.questions.action?.criteria ?? {})).toEqual(
      expect.arrayContaining(tools.map((tool) => tool.name)),
    )
  })
  test.each(["short", "near-limit"] as const)(
    "preserves full controller instructions and current diagnostic evidence (%s goal)",
    async (size) => {
      const goal = "Inspect the current model. ".repeat(size === "short" ? 1 : 1100)
      const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
      const value = localModelInfoSchema.parse({
        summary: {
          kind: "org.vibeshape.document.summary",
          schemaVersion: 1,
          documentId,
          revision: 0,
          classification: "semantic",
          truncated: false,
          data: {
            name: "Part",
            createdAt: "2026-10-20T12:00:00.000Z",
            updatedAt: "2026-10-20T12:00:00.000Z",
          },
        },
        measurements: null,
        measurementDiagnostic: null,
        diagnostics: {
          schemaVersion: 1,
          documentId,
          revision: 0,
          generation: 0,
          status: "invalid",
          truncated: false,
          entries: Array.from({ length: 110 }, (_, index) => ({
            entity: {
              kind: "feature",
              id: `0195b5ac-b213-7f2c-9c33-${String(index).padStart(12, "0")}`,
            },
            code: "model.dependency-missing",
            values: {},
            resolution: "missing",
            action: "repair-dependency",
          })),
        },
      })
      const instructions = readAgentSkillResource("vibeshape://agent-skills/vibeshape-use/SKILL.md")
        ?.contents[0]?.text
      expect(instructions).toBeDefined()
      const { decide, calls } = fixture({ action: answer("blocked") })
      const controller = createController({
        port: {
          tools: [...cadTools(), agentSkillTool, assistantQuestionTool].map((tool) =>
            ToolSchema.parse(tool),
          ),
          close: async () => {},
          call: async (name) => {
            expect(["read_agent_skill", "model_info"]).toContain(name)
            return {
              value: {
                result: {
                  ok: true,
                  value: name === "read_agent_skill" ? { text: instructions } : value,
                },
              },
              photos: [],
              failed: false,
            }
          },
        },
        decide,
        maxSteps: 1,
        minConfidence: 0.5,
        timeoutMs: 10_000,
        images: false,
      })
      await controller.run(
        `${projectAssistantContext(documentId)}\n${goal}`,
        [],
        signal(),
        async () => {},
      )
      expect(calls).toHaveLength(1)
      const payload = z
        .object({
          state: z.object({
            goal: z.string(),
            instructions: z.string(),
            history: z.array(z.unknown()),
          }),
        })
        .parse(JSON.parse(String(calls[0]?.init.body)))
      expect(payload.state.instructions).toContain("Never replay an uncertain write.")
      expect(payload.state.goal).toBe(`${projectAssistantContext(documentId)}\n${goal}`)
      expect(payload.state.instructions.endsWith(instructions ?? "")).toBe(true)
      expect(payload.state.history).toEqual([
        { tool: "model_info", arguments: {}, result: { result: { ok: true, value } } },
      ])
      expect(new Headers(calls[0]?.init.headers).get("TypeSafe-Danger-Zone-Long-Context")).toBe(
        "true",
      )
    },
  )
  test("keeps small decision requests within the default context mode", async () => {
    const { decide, calls } = fixture({ action: answer("done") })
    await decide(state, [inspectTool], signal())
    expect(calls).toHaveLength(1)
    expect(new Headers(calls[0]?.init.headers).get("TypeSafe-Danger-Zone-Long-Context")).toBeNull()
  })
  test("reserves controller context beside a bounded description catalog without truncation", async () => {
    const { decide, calls } = fixture({ action: answer("done") })
    const expanded = { ...state, goal: "g".repeat(40_000), instructions: "i".repeat(20_000) }
    const description = "d".repeat(100_000)
    await decide(expanded, [{ ...inspectTool, description }], signal())
    const payload = z
      .object({
        state: z.looseObject({
          goal: z.string(),
          instructions: z.string(),
          catalog: z.record(z.string(), z.string()),
        }),
      })
      .parse(JSON.parse(String(calls[0]?.init.body)))
    expect(payload.state.goal).toBe(expanded.goal)
    expect(payload.state.instructions).toBe(expanded.instructions)
    expect(payload.state.catalog).toEqual({ t0: description })
    expect(Buffer.byteLength(JSON.stringify(payload.state))).toBeGreaterThan(128_000)
    expect(Buffer.byteLength(JSON.stringify(payload.state))).toBeLessThan(192_000)
    expect(new Headers(calls[0]?.init.headers).get("TypeSafe-Danger-Zone-Long-Context")).toBe(
      "true",
    )
  })
  test("rejects oversized combined state even when its catalog fits before contacting the provider", async () => {
    const { decide, calls } = fixture({ action: answer("done") })
    await expect(
      decide(
        { ...state, goal: "g".repeat(70_000) },
        [{ ...inspectTool, description: "d".repeat(125_000) }],
        signal(),
      ),
    ).rejects.toThrow("state and tool catalog exceed their text budget")
    expect(calls).toHaveLength(0)
  })
  test("rejects an oversized tool catalog before contacting the provider", async () => {
    const { decide, calls } = fixture({ action: answer("done") })
    await expect(
      decide(state, [{ ...inspectTool, description: "x".repeat(128 * 1024) }], signal()),
    ).rejects.toThrow("budget")
    expect(calls).toHaveLength(0)
  })
  test("one request speculates every branch and consumes only the selected closed values", async () => {
    const create: Tool = {
      name: "create_primitive",
      description: "Create a primitive.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          shape: { enum: ["box", "cylinder"] },
          schemaVersion: { const: 2 },
          preview: { type: "boolean" },
          size: { enum: [10, 20] },
        },
        required: ["shape", "schemaVersion", "preview", "size"],
      },
    }
    const other: Tool = {
      name: "other_tool",
      inputSchema: {
        type: "object",
        properties: { mode: { enum: ["a", "b"] } },
        required: ["mode"],
      },
    }
    const { decide, calls } = fixture({
      action: answer("t0", 0.99),
      t0p0: answer("v0", 0.96),
      t0p1: answer("v0", 0.97),
      t0p2: answer("v1", 0.98),
      t0p3: answer("v1", 0.94),
      t1p0: { type: "choice", choice: "outside-options", confidence: -100 },
    })
    expect(await decide(state, [create, other], signal())).toEqual({
      kind: "tool",
      tool: create,
      arguments: { shape: "box", schemaVersion: 2, preview: true, size: 20 },
      needsArguments: false,
      confidence: 0.94,
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe("https://api.typesafe.ai/v1/systemone")
    const body = requestSchema.parse(JSON.parse(String(call?.init.body)))
    expect(body.model).toBe("jev-pinned")
    expect(Object.keys(body.questions)).toHaveLength(6)
    expect(Object.keys(body.questions.action?.criteria ?? {})).toEqual([
      "done",
      "blocked",
      "t0",
      "t1",
    ])
    expect(body.questions.t1p0?.instructions).toContain("other_tool")
    expect(body.questions.t1p0?.instructions).toContain('"mode"')
    expect(body.questions.t0p0?.instructions).not.toContain("schemaVersion")
    expect(body.questions.t0p1?.instructions).toContain('{"const":2}')
    expect(new Headers(call?.init.headers).has("TypeSafe-Danger-Zone-Images")).toBe(false)
  })

  test.each(["done", "blocked"])(
    "%s ignores absent speculative branch answers",
    async (outcome) => {
      const tool: Tool = {
        name: "set_mode",
        inputSchema: {
          type: "object",
          properties: { mode: { type: "boolean" } },
          required: ["mode"],
        },
      }
      const { decide } = fixture({ action: answer(outcome, 0.88) })
      expect(await decide(state, [tool], signal())).toEqual({ kind: outcome, confidence: 0.88 })
    },
  )

  test("an unselected branch can be entirely absent", async () => {
    const other: Tool = {
      name: "set_mode",
      inputSchema: {
        type: "object",
        properties: { mode: { type: "boolean" } },
        required: ["mode"],
      },
    }
    const { decide } = fixture({ action: answer("t0") })
    expect(await decide(state, [inspectTool, other], signal())).toMatchObject({
      kind: "tool",
      arguments: {},
      needsArguments: false,
    })
  })

  test.each([
    { properties: { length: { type: "number" } }, required: ["length"] },
    { properties: { id: { type: "string", format: "uuid" } }, required: ["id"] },
    {
      properties: { mode: { $ref: "#/$defs/mode", enum: ["draft", "final"] } },
      required: ["mode"],
    },
    {
      properties: { mode: { oneOf: [{ const: "draft" }, { const: "final" }] } },
      required: ["mode"],
    },
    { properties: { geometry: { type: "object" } } },
    { properties: { segments: { type: "array" } } },
    { properties: {}, additionalProperties: true },
    { properties: {}, required: ["missing"] },
  ])("defers unresolved or open arguments: %j", async (schema) => {
    const tool: Tool = {
      name: "edit_geometry",
      inputSchema: { type: "object", ...schema, required: [...(schema.required ?? [])] },
    }
    const { decide, calls } = fixture({ action: answer("t0") })
    expect(await decide(state, [tool], signal())).toMatchObject({
      kind: "tool",
      arguments: {},
      needsArguments: true,
    })
    const body = requestSchema.parse(JSON.parse(String(calls[0]?.init.body)))
    expect(Object.keys(body.questions)).toEqual(["action"])
  })

  test("keeps closed choices while deferring optional open geometry", async () => {
    const tool: Tool = {
      name: "create_sketch",
      inputSchema: {
        type: "object",
        properties: { plane: { enum: ["XY", "XZ"] }, geometry: { type: "object" } },
        required: ["plane"],
      },
    }
    const { decide } = fixture({ action: answer("t0"), t0p0: answer("v0") })
    expect(await decide(state, [tool], signal())).toMatchObject({
      arguments: { plane: "XY" },
      needsArguments: true,
    })
  })

  test("optional closed fields have an explicit omit choice", async () => {
    const tool: Tool = {
      name: "inspect",
      inputSchema: { type: "object", properties: { verbose: { type: "boolean" } } },
    }
    const { decide } = fixture({ action: answer("t0"), t0p0: answer("omit") })
    expect(await decide(state, [tool], signal())).toMatchObject({
      arguments: {},
      omitted: ["verbose"],
      needsArguments: false,
    })
  })

  test("honors a requested optional closed value instead of silently defaulting", async () => {
    const tool: Tool = {
      name: "inspect",
      inputSchema: { type: "object", properties: { verbose: { type: "boolean" } } },
    }
    const { decide } = fixture({ action: answer("t0"), t0p0: answer("v1", 0.91) })
    expect(
      await decide({ ...state, goal: "Inspect with verbose output" }, [tool], signal()),
    ).toMatchObject({ arguments: { verbose: true }, needsArguments: false, confidence: 0.91 })
  })

  test("an explicitly unresolved required choice goes to argument completion", async () => {
    const tool: Tool = {
      name: "set_mode",
      inputSchema: {
        type: "object",
        properties: { mode: { enum: ["draft", "final"] } },
        required: ["mode"],
      },
    }
    const { decide } = fixture({ action: answer("t0"), t0p0: answer("unresolved", 0.9) })
    expect(await decide(state, [tool], signal())).toMatchObject({
      arguments: {},
      needsArguments: true,
      confidence: 0.9,
    })
  })

  test("supports an empty tool set with explicit stop outcomes", async () => {
    const { decide } = fixture({ action: answer("blocked") })
    expect(await decide(state, [], signal())).toEqual({ kind: "blocked", confidence: 0.95 })
  })
})

describe("Jev response validation", () => {
  test("rejects an invalid answer envelope", async () => {
    const { decide } = fixture(null)
    await expect(decide(state, [inspectTool], signal())).rejects.toThrow(
      "invalid decision response",
    )
  })

  test.each([
    undefined,
    null,
    {},
    answer("unknown"),
    answer("t0", -0.1),
    answer("t0", 1.1),
    { type: "score", choice: "t0", confidence: 0.9 },
    { type: "choice", choice: "t0", confidence: "0.9" },
  ])("rejects an invalid or missing action: %j", async (invalid) => {
    const { decide } = fixture({ action: invalid })
    await expect(decide(state, [inspectTool], signal())).rejects.toThrow("invalid action answer")
  })

  test.each([undefined, answer("bogus"), answer("v0", -1), { type: "choice", choice: "v0" }])(
    "rejects an invalid or missing selected parameter: %j",
    async (invalid) => {
      const tool: Tool = {
        name: "set_mode",
        inputSchema: {
          type: "object",
          properties: { mode: { type: "boolean" } },
          required: ["mode"],
        },
      }
      const { decide } = fixture({ action: answer("t0"), t0p0: invalid })
      await expect(decide(state, [tool], signal())).rejects.toThrow(
        "invalid selected parameter answer",
      )
    },
  )

  test("pre-cancelled decisions make no request", async () => {
    const { decide, calls } = fixture({ action: answer("t0") })
    const controller = new AbortController()
    controller.abort()
    await expect(decide(state, [inspectTool], controller.signal)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  test("uses SDK multipart assets and turns on experimental images only with photos", async () => {
    const { decide, calls } = fixture({ action: answer("t0") })
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4YQAAAAASUVORK5CYII="
    await decide({ ...state, photos: [{ mimeType: "image/png", data }] }, [inspectTool], signal())
    const call = calls[0]
    expect(new Headers(call?.init.headers).get("TypeSafe-Danger-Zone-Images")).toBe("true")
    expect(call?.init.body).toBeInstanceOf(Blob)
    const form = await new Response(call?.init.body, {
      headers: new Headers(call?.init.headers),
    }).formData()
    const asset = form.get("asset-0")
    expect(asset).toBeInstanceOf(Blob)
    if (!(asset instanceof Blob)) throw new Error("Expected an image asset")
    expect(Buffer.from(await asset.arrayBuffer()).toString("base64")).toBe(data)
    const request = form.get("request")
    if (typeof request !== "string") throw new Error("Expected the JSON request part")
    const payload = z
      .object({
        state: z.object({ photos: z.array(z.string()) }),
        assets: z.record(z.string(), z.object({ type: z.literal("image"), part: z.string() })),
      })
      .parse(JSON.parse(request))
    const reference = payload.state.photos[0]
    expect(reference).toBeDefined()
    expect(Object.keys(payload.assets)).toEqual(reference ? [reference] : [])
    expect(Object.values(payload.assets)).toEqual([{ type: "image", part: "asset-0" }])
  })
})
