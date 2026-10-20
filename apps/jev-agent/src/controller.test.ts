import { describe, expect, it } from "bun:test"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import type { Decide, Decision } from "./contracts"
import { createController, type ToolPort } from "./controller"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const tool: Tool = {
  name: "create_draft",
  inputSchema: {
    type: "object",
    properties: { baseRevision: { type: "number" } },
    required: ["baseRevision"],
  },
}
function modelResult(revision = 0, id = documentId) {
  return {
    result: {
      ok: true,
      value: {
        summary: {
          kind: "org.vibeshape.document.summary",
          schemaVersion: 1,
          documentId: id,
          revision,
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
      },
    },
  }
}
function fixture(
  options: {
    decide?: Decide
    revisions?: number[]
    ids?: string[]
    failure?: boolean
    transportError?: boolean
    maxSteps?: number
  } = {},
) {
  const calls: string[] = []
  let models = 0
  const port: ToolPort = {
    tools: [tool],
    close: async () => {},
    async call(name) {
      calls.push(name)
      if (name === "model_info") {
        const index = models++
        return {
          value: modelResult(options.revisions?.[index] ?? 0, options.ids?.[index]),
          photos: [],
          failed: false,
        }
      }
      if (name === "read_agent_skill")
        return {
          value: { result: { ok: true, value: { text: "Use exact drafts." } } },
          photos: [],
          failed: false,
        }
      if (options.transportError) throw new Error("Transport failed after dispatch")
      return {
        value: options.failure ? { result: { ok: false } } : { result: { ok: true } },
        photos: [],
        failed: Boolean(options.failure),
      }
    },
  }
  let decisions = 0
  const decide: Decide =
    options.decide ??
    (async () =>
      decisions++ === 0
        ? {
            kind: "tool",
            tool,
            arguments: { baseRevision: 0 },
            needsArguments: false,
            confidence: 1,
          }
        : { kind: "done", confidence: 1 })
  const controller = createController({
    port,
    decide,
    maxSteps: options.maxSteps ?? 4,
    minConfidence: 0.5,
    timeoutMs: 1000,
    images: false,
  })
  return { controller, calls, port }
}

describe("Jev CAD control loop", () => {
  it("preserves explicit Jev omissions when an argument helper tries to restore them", async () => {
    const removal: Tool = { name: "remove_assembly_instance", inputSchema: { type: "object" } }
    const f = fixture()
    let sent: Record<string, unknown> | undefined
    const original = f.port.call
    f.port.tools = [removal]
    f.port.call = async (name, args, signal) => {
      if (name === removal.name) {
        sent = args
        return { value: { result: { ok: true } }, failed: false, photos: [] }
      }
      return original(name, args, signal)
    }
    let decisions = 0
    const controller = createController({
      port: f.port,
      decide: async () =>
        decisions++ === 0
          ? {
              kind: "tool",
              tool: removal,
              arguments: {},
              omitted: ["cascade"],
              needsArguments: true,
              confidence: 1,
            }
          : { kind: "done", confidence: 1 },
      completeArguments: async () => ({
        draftId: documentId,
        instanceId: documentId,
        baseRevision: 0,
        draftVersion: 0,
        cascade: true,
      }),
      maxSteps: 2,
      minConfidence: 0.5,
      timeoutMs: 1000,
      images: false,
    })
    await controller.run(
      "Remove only this instance",
      [],
      new AbortController().signal,
      async () => {},
    )
    expect(sent).toBeDefined()
    expect(sent).not.toHaveProperty("cascade")
  })
  it("retains an uncertain write and blocks redispatch on a later continue request", async () => {
    let sawUncertain = false
    let offeredWritesAfterFailure = false
    const f = fixture({
      transportError: true,
      decide: async (state, offered) => {
        if (state.uncertainOutcome) {
          sawUncertain = true
          offeredWritesAfterFailure = offered.some((entry) => entry.name === tool.name)
          expect(state.uncertainOutcome.arguments).toEqual({ baseRevision: 0 })
        }
        return {
          kind: "tool",
          tool,
          arguments: { baseRevision: 0 },
          needsArguments: false,
          confidence: 1,
        }
      },
    })
    await expect(
      f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).rejects.toThrow()
    expect(
      await f.controller.run("Continue", [], new AbortController().signal, async () => {}),
    ).toContain("unknown outcome")
    expect(sawUncertain).toBe(true)
    expect(offeredWritesAfterFailure).toBe(false)
    expect(f.calls.filter((name) => name === tool.name)).toHaveLength(1)
  })

  it("refreshes the model around selection and executes one confirmed action", async () => {
    const f = fixture()
    const statuses: string[] = []
    const message = await f.controller.run(
      "Create a part",
      [],
      new AbortController().signal,
      async (event) => {
        statuses.push(event.status)
      },
    )
    expect(f.calls).toEqual([
      "read_agent_skill",
      "model_info",
      "model_info",
      "create_draft",
      "model_info",
    ])
    expect(statuses).toEqual(["in_progress", "completed"])
    expect(message).toContain("ended the turn")
  })
  it("discards a stale selection when a human edit advances the revision", async () => {
    const f = fixture({ revisions: [0, 1, 1] })
    await f.controller.run("Create a part", [], new AbortController().signal, async () => {})
    expect(f.calls).not.toContain("create_draft")
  })
  it("rejects a changed project before executing the selected action", async () => {
    const f = fixture({ ids: [documentId, "0195b5ac-b213-7f2c-9c33-67a36a7f21ad"] })
    await expect(
      f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).rejects.toThrow("project changed")
    expect(f.calls).not.toContain("create_draft")
  })
  it("does not replay a rejected or uncertain action", async () => {
    for (const failure of [{ failure: true }, { transportError: true }]) {
      const f = fixture(failure)
      try {
        await f.controller.run("Create", [], new AbortController().signal, async () => {})
      } catch {
        /* An uncertain transport result must stop the turn. */
      }
      expect(f.calls.filter((name) => name === "create_draft")).toHaveLength(1)
    }
  })
  it("stops before dispatch for low confidence, missing arguments or an unknown tool", async () => {
    const decisions: Decision[] = [
      { kind: "tool", tool, arguments: {}, needsArguments: false, confidence: 0.1 },
      { kind: "tool", tool, arguments: {}, needsArguments: true, confidence: 1 },
      {
        kind: "tool",
        tool: { ...tool, name: "create_project" },
        arguments: {},
        needsArguments: false,
        confidence: 1,
      },
    ]
    for (const decision of decisions) {
      const f = fixture({ decide: async () => decision })
      try {
        await f.controller.run("Create", [], new AbortController().signal, async () => {})
      } catch {
        /* Unknown catalogs fail closed. */
      }
      expect(f.calls).not.toContain("create_draft")
    }
  })
  it("bounds repeated no-progress steps and releases the turn lock after cancellation", async () => {
    const f = fixture({ maxSteps: 1 })
    const cancelled = AbortSignal.abort()
    await expect(f.controller.run("Create", [], cancelled, async () => {})).rejects.toThrow()
    expect(
      await f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).toContain("JEV_MAX_STEPS")
  })
})
