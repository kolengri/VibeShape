import { describe, expect, it } from "bun:test"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import {
  type AssistantQuestionInput,
  assistantQuestionTool,
} from "@vibeshape/automation-api/assistant"
import { createArgumentCompleter, createDecisionResolver } from "./arguments"
import type { CompleteArguments, Decide, Decision, ResolveDecision } from "./contracts"
import { createController, type ToolPort, type ToolResult } from "./controller"

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
    resolveDecision?: ResolveDecision
    completeArguments?: CompleteArguments
    revisions?: number[]
    ids?: string[]
    failure?: boolean
    transportError?: boolean
    timeoutMs?: number
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
    resolveDecision: options.resolveDecision,
    completeArguments: options.completeArguments,
    minConfidence: 0.5,
    timeoutMs: options.timeoutMs ?? 1000,
    images: false,
  })
  return { controller, calls, port }
}

const question: Tool = { name: assistantQuestionTool.name, inputSchema: { type: "object" } }
const questionInput: AssistantQuestionInput = {
  message: "Choose the material",
  fields: [
    {
      id: "material",
      label: "Material",
      required: true,
      secret: false,
      options: [{ id: "pla", name: "PLA" }],
    },
  ],
}
function questionFixture() {
  const decisions: Decision[] = [
    {
      kind: "tool",
      tool: question,
      arguments: questionInput,
      needsArguments: false,
      confidence: 1,
    },
    { kind: "tool", tool, arguments: { baseRevision: 0 }, needsArguments: false, confidence: 1 },
  ]
  const f = fixture({
    timeoutMs: 10,
    decide: async () => decisions.shift() ?? { kind: "done", confidence: 1 },
  })
  f.port.tools = [question, tool]
  return f
}

describe("Jev continuous execution", () => {
  it("continues beyond the former maximum with retained answers and draft state", async () => {
    const read: Tool = { name: "model_info", inputSchema: { type: "object" } }
    const commit: Tool = { name: "commit_draft", inputSchema: { type: "object" } }
    let decisions = 0
    let questions = 0
    const reply = { action: "accept", content: { material: "pla" } }
    const draft = {
      result: {
        ok: true,
        value: {
          schemaVersion: 1,
          draftId: documentId,
          documentId,
          baseRevision: 0,
          revision: 0,
          commandCount: 0,
          expiresAt: "2026-10-23T20:00:00.000Z",
        },
      },
    }
    const action = (tool: Tool, args: Record<string, unknown>): Decision => ({
      kind: "tool",
      tool,
      arguments: args,
      needsArguments: false,
      confidence: 1,
    })
    const sequence: Decision[] = [
      action(question, questionInput),
      action(tool, { baseRevision: 0 }),
      ...Array.from({ length: 60 }, () => action(read, {})),
      action(question, questionInput),
      action(question, questionInput),
      action(commit, { draftId: documentId }),
      action(read, {}),
      { kind: "done", confidence: 1 },
    ]
    const f = fixture({
      decide: async (state) => {
        const index = decisions++
        if (index > 2) {
          expect(state.session?.requests).toEqual([])
          expect(state.session?.answeredQuestions[0]?.result).toEqual(reply)
          if (index <= 64) expect(state.session?.activeDraft?.result).toEqual(draft)
          else expect(state.session?.activeDraft).toBeUndefined()
        }
        return sequence[index] ?? { kind: "done", confidence: 1 }
      },
    })
    f.port.tools = [tool, read, question, commit]
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name === question.name) {
        questions++
        return { value: reply, photos: [], failed: false }
      }
      if (name === tool.name) return { value: draft, photos: [], failed: false }
      return original(name, args, signal)
    }
    expect(
      await f.controller.run(
        "Create the full container",
        [],
        new AbortController().signal,
        async () => {},
      ),
    ).toContain("ended the turn")
    expect(decisions).toBe(67)
    expect(questions).toBe(1)
  })

  it.each([
    ["assembly", "commit_assembly_draft"],
    ["assembly", "discard_assembly_draft"],
    ["restored", "commit_draft"],
    ["restored", "discard_draft"],
  ])("retains a %s draft across rollover and continuation until %s", async (kind, finishName) => {
    const draft = {
      schemaVersion: 1,
      draftId: documentId,
      documentId,
      baseRevision: 0,
      expiresAt: "2026-10-23T20:00:00.000Z",
    }
    const value =
      kind === "assembly"
        ? { ...draft, draftVersion: 2, changeCount: 2 }
        : {
            schemaVersion: 1,
            recoveryId: documentId,
            attribution: {
              type: "current-actor",
              actor: { type: "system", source: "org.vibeshape.assistant" },
            },
            draft: { ...draft, revision: 2, commandCount: 2 },
          }
    const receipt = { result: { ok: true, value } }
    const open: Tool = {
      name: kind === "assembly" ? "create_assembly_draft" : "restore_draft",
      inputSchema: { type: "object" },
    }
    const read: Tool = { name: "model_info", inputSchema: { type: "object" } }
    const finish: Tool = { name: finishName, inputSchema: { type: "object" } }
    const action = (tool: Tool, args: Record<string, unknown>): Decision => ({
      kind: "tool",
      tool,
      arguments: args,
      needsArguments: false,
      confidence: 1,
    })
    const reads = Array.from({ length: 16 }, () => action(read, {}))
    const sequence: Decision[] = [
      action(
        open,
        kind === "assembly" ? { baseRevision: 0 } : { recoveryId: documentId, baseRevision: 0 },
      ),
      ...reads,
      { kind: "done", confidence: 1 },
      ...reads,
      action(
        finish,
        kind === "assembly"
          ? { draftId: documentId, baseRevision: 0, draftVersion: 2 }
          : { draftId: documentId },
      ),
      { kind: "done", confidence: 1 },
    ]
    let finalized = false
    let decisions = 0
    const f = fixture({
      decide: async (state) => {
        if (decisions > 0 && !finalized) {
          expect(state.session?.activeDraft).toMatchObject({
            arguments: { draftId: documentId },
            result: receipt,
          })
        }
        if (state.goal === "Continue") {
          expect(state.session?.requests).toEqual(["Complete the model"])
          expect(state.history.some((item) => item.tool === open.name)).toBe(false)
        }
        if (finalized) expect(state.session?.activeDraft).toBeUndefined()
        decisions++
        return sequence.shift() ?? { kind: "done", confidence: 1 }
      },
    })
    f.port.tools = [open, read, finish]
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name === open.name) return { value: receipt, photos: [], failed: false }
      if (name === finish.name) finalized = true
      return original(name, args, signal)
    }
    await f.controller.run("Complete the model", [], new AbortController().signal, async () => {})
    await f.controller.run("Continue", [], new AbortController().signal, async () => {})
    expect(finalized).toBe(true)
  })

  it("preserves the original request across repeated continuations and honors Stop", async () => {
    const signal = new AbortController()
    let decisions = 0
    const requests: string[] = []
    const f = fixture({
      decide: async (state) => {
        expect(state.session?.requests).toEqual(requests.slice(0, -1))
        if (state.goal === "Long task") {
          if (++decisions === 60) signal.abort()
          return {
            kind: "tool",
            tool,
            arguments: { baseRevision: 0 },
            needsArguments: false,
            confidence: 1,
          }
        }
        return { kind: "done", confidence: 1 }
      },
    })
    requests.push("Long task")
    await expect(f.controller.run("Long task", [], signal.signal, async () => {})).rejects.toThrow()
    for (const request of ["Continue", "Add a lid", "Continue", "Continue"]) {
      requests.push(request)
      expect(
        await f.controller.run(request, [], new AbortController().signal, async () => {}),
      ).toContain("ended the turn")
    }
  })
})

describe("Jev structured questions", () => {
  it("asks again for a different question with the same fields and after a new user request", async () => {
    const nextQuestion = {
      ...questionInput,
      message: "Choose the lid material",
    }
    let asks = 0
    let step = 0
    const f = fixture({
      decide: async () =>
        step++ % 3 === 2
          ? { kind: "done", confidence: 1 }
          : {
              kind: "tool",
              tool: question,
              arguments: step % 3 === 1 ? questionInput : nextQuestion,
              needsArguments: false,
              confidence: 1,
            },
    })
    f.port.tools = [question]
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== question.name) return original(name, args, signal)
      asks++
      return {
        value: { action: "accept", content: { material: "pla" } },
        failed: false,
        photos: [],
      }
    }
    await f.controller.run("Create the container", [], new AbortController().signal, async () => {})
    expect(asks).toBe(2)
    await f.controller.run(
      "Reconsider both materials",
      [],
      new AbortController().signal,
      async () => {},
    )
    expect(asks).toBe(4)
  })

  it("waits beyond the ordinary timeout and executes dependent CAD only after a valid answer", async () => {
    const f = questionFixture()
    const started = Promise.withResolvers<AbortSignal>()
    const answer = Promise.withResolvers<ToolResult>()
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== question.name) return original(name, args, signal)
      f.calls.push(name)
      expect(args).toEqual(questionInput)
      started.resolve(signal)
      return answer.promise
    }
    const pending = f.controller.run(
      "Make the part",
      [],
      new AbortController().signal,
      async () => {},
    )
    const signal = await started.promise
    await Bun.sleep(30)
    expect(signal.aborted).toBe(false)
    expect(f.calls).not.toContain(tool.name)
    answer.resolve({
      value: { action: "accept", content: { material: "pla" } },
      photos: [],
      failed: false,
    })
    expect(await pending).toContain("ended the turn")
    expect(f.calls.filter((name) => name === tool.name)).toHaveLength(1)
  })

  it.each([
    ["cancelled", { action: "cancel" }],
    ["declined or expired", { action: "decline" }],
    ["invalid choice", { action: "accept", content: { material: "unknown" } }],
    ["missing answer", { action: "accept", content: {} }],
    [
      "no-op diagnostic without an accepted answer",
      {
        ok: false,
        diagnostic: {
          code: "command-no-op",
          message: "The feature already has the requested state.",
          retryable: false,
        },
      },
    ],
  ])("stops dependent CAD after a %s question result", async (_name, value) => {
    const f = questionFixture()
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== question.name) return original(name, args, signal)
      f.calls.push(name)
      return { value, photos: [], failed: false }
    }
    expect(
      await f.controller.run("Make the part", [], new AbortController().signal, async () => {}),
    ).toContain("rejected the step")
    expect(f.calls).toContain(question.name)
    expect(f.calls).not.toContain(tool.name)
  })

  it("honors Stop during a question without classifying the question as an uncertain CAD write", async () => {
    const f = questionFixture()
    const started = Promise.withResolvers<AbortSignal>()
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== question.name) return original(name, args, signal)
      started.resolve(signal)
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    }
    const stop = new AbortController()
    const pending = f.controller
      .run("Make the part", [], stop.signal, async () => {})
      .catch((error: unknown) => error)
    const signal = await started.promise
    await Bun.sleep(30)
    expect(signal.aborted).toBe(false)
    stop.abort(new Error("Stop question"))
    expect(await pending).toEqual(new Error("Stop question"))
    expect(signal.aborted).toBe(true)
    expect(f.calls).not.toContain(tool.name)
    expect(
      await f.controller.run("Continue", [], new AbortController().signal, async () => {}),
    ).toContain("ended the turn")
    expect(f.calls).toContain(tool.name)
  })
})

describe("Jev CAD control loop", () => {
  it.each([false, true])(
    "continues to exact preview after an unchanged shell update (envelope: %s)",
    async (envelope) => {
      const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
      const update: Tool = { name: "update_shell", inputSchema: { type: "object" } }
      const preview: Tool = { name: "preview_draft", inputSchema: { type: "object" } }
      const diagnostic = {
        ok: false,
        diagnostic: {
          code: "command-no-op",
          message: "The feature already has the requested state.",
          retryable: false,
        },
      }
      const value = envelope ? { result: diagnostic } : diagnostic
      let decisions = 0
      const f = fixture({
        decide: async (state) => {
          if (decisions++ === 0)
            return {
              kind: "tool",
              tool: update,
              arguments: {
                draftId,
                baseRevision: 0,
                commandId: "0195b5ac-b217-7a2c-bc33-67a36a7f21ac",
                featureId: "0195b5ac-b218-7a2c-bc33-67a36a7f21ac",
                label: "Shell",
                dependencies: [documentId],
                references: [],
                suppressed: false,
                parameters: {
                  targetBody: { schemaVersion: 0, featureId: documentId, outputRole: "result" },
                  thickness: {
                    schemaVersion: 0,
                    dimension: "length",
                    value: 2,
                    unit: "mm",
                    source: { value: 2, unit: "mm", expression: null },
                  },
                  direction: "inward",
                  sourceContentHash: "a".repeat(64),
                  openings: [],
                },
              },
              needsArguments: false,
              confidence: 1,
            }
          expect(state.uncertainOutcome).toBeUndefined()
          expect(state.history.find((item) => item.tool === update.name)?.result).toEqual(value)
          return decisions === 2
            ? {
                kind: "tool",
                tool: preview,
                arguments: { draftId },
                needsArguments: false,
                confidence: 1,
              }
            : { kind: "done", confidence: 1 }
        },
      })
      f.port.tools = [update, preview]
      const original = f.port.call
      f.port.call = async (name, args, signal) => {
        if (name !== update.name) return original(name, args, signal)
        f.calls.push(name)
        return { value, photos: [], failed: true }
      }
      const events: string[] = []
      expect(
        await f.controller.run(
          "Hollow the cylinder",
          [],
          new AbortController().signal,
          async (e) => {
            events.push(`${e.name}:${e.status}`)
          },
        ),
      ).toContain("ended the turn")
      expect(f.calls.filter((name) => name === update.name)).toHaveLength(1)
      expect(f.calls.indexOf(preview.name)).toBeGreaterThan(f.calls.indexOf(update.name))
      expect(events).toContain("update_shell:failed")
      expect(events).toContain("preview_draft:completed")
    },
  )
  it.each([false, true])(
    "stops on an actual rejection with its diagnostic (retryable: %s)",
    async (retryable) => {
      const f = fixture()
      const original = f.port.call
      f.port.call = async (name, args, signal) => {
        if (name !== tool.name) return original(name, args, signal)
        f.calls.push(name)
        return {
          value: {
            result: {
              ok: false,
              diagnostic: { code: "stale-revision", message: "The model changed.", retryable },
            },
          },
          photos: [],
          failed: true,
        }
      }
      const message = await f.controller.run(
        "Create",
        [],
        new AbortController().signal,
        async () => {},
      )
      expect(message).toContain("create_draft (stale-revision): The model changed.")
      expect(f.calls.filter((name) => name === tool.name)).toHaveLength(1)
    },
  )
  it.each(["commit_draft", "undo_model"])(
    "keeps a manual %s review open beyond the ordinary operation budget",
    async (name) => {
      const review: Tool = { name, inputSchema: { type: "object" } }
      let decisions = 0
      const f = fixture({
        timeoutMs: 10,
        decide: async () =>
          decisions++ === 0
            ? {
                kind: "tool",
                tool: review,
                arguments:
                  name === "commit_draft"
                    ? { draftId: documentId }
                    : { documentId, baseRevision: 0, commandId: documentId },
                needsArguments: false,
                confidence: 1,
              }
            : { kind: "done", confidence: 1 },
      })
      f.port.tools = [review]
      const original = f.port.call
      f.port.call = async (toolName, args, signal) => {
        if (toolName === name) await Bun.sleep(30)
        signal.throwIfAborted()
        return original(toolName, args, signal)
      }
      expect(
        await f.controller.run(
          "Apply this change",
          [],
          new AbortController().signal,
          async () => {},
        ),
      ).toContain("ended the turn")
      expect(f.calls).toContain(name)
    },
  )
  it("still forwards Stop to a pending manual review after the ordinary budget expires", async () => {
    const review: Tool = { name: "commit_draft", inputSchema: { type: "object" } }
    const f = fixture({
      timeoutMs: 10,
      decide: async () => ({
        kind: "tool",
        tool: review,
        arguments: { draftId: documentId },
        needsArguments: false,
        confidence: 1,
      }),
    })
    f.port.tools = [review]
    const started = Promise.withResolvers<AbortSignal>()
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name !== review.name) return original(name, args, signal)
      started.resolve(signal)
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        if (signal.aborted) reject(signal.reason)
      })
    }
    const cancellation = new AbortController()
    const pending = f.controller
      .run("Apply", [], cancellation.signal, async () => {})
      .then(
        () => null,
        (error: unknown) => error,
      )
    const reviewSignal = await started.promise
    await Bun.sleep(30)
    const wasAborted = reviewSignal.aborted
    cancellation.abort(new Error("Stopped manual review"))
    expect(await pending).toEqual(new Error("Stopped manual review"))
    expect(wasAborted).toBe(false)
    expect(reviewSignal.aborted).toBe(true)
  })
  it("retains the short timeout for an ordinary operation", async () => {
    const f = fixture({ timeoutMs: 10 })
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      if (name === tool.name) await Bun.sleep(30)
      signal.throwIfAborted()
      return original(name, args, signal)
    }
    await expect(
      f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).rejects.toThrow()
    expect(f.calls).not.toContain(tool.name)
  })
  it("keeps authoring available when cancelled during the pre-dispatch notification", async () => {
    let decisions = 0
    const f = fixture({
      decide: async (state, offered) => {
        expect(state.uncertainOutcome).toBeUndefined()
        expect(offered.some((entry) => entry.name === tool.name)).toBe(true)
        return decisions++ < 2
          ? {
              kind: "tool",
              tool,
              arguments: { baseRevision: 0 },
              needsArguments: false,
              confidence: 1,
            }
          : { kind: "done", confidence: 1 }
      },
    })
    const original = f.port.call
    f.port.call = async (name, args, signal) => {
      signal.throwIfAborted()
      return original(name, args, signal)
    }
    const cancellation = new AbortController()
    await expect(
      f.controller.run("Create", [], cancellation.signal, async (event) => {
        if (event.status === "in_progress") {
          await Promise.resolve()
          cancellation.abort(new Error("Cancelled before dispatch"))
        }
      }),
    ).rejects.toThrow("Cancelled before dispatch")
    expect(f.calls).not.toContain("create_draft")
    expect(
      await f.controller.run("Continue", [], new AbortController().signal, async () => {}),
    ).toContain("ended the turn")
    expect(f.calls.filter((name) => name === tool.name)).toHaveLength(1)
  })
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
  it("resolves a low-confidence selection through the helper before normal validated dispatch", async () => {
    const resolved: string[] = []
    let decisions = 0
    const f = fixture({
      decide: async () => ({
        kind: decisions++ === 0 ? "blocked" : "done",
        confidence: decisions === 1 ? 0.1 : 1,
      }),
      resolveDecision: async (state, tools) => {
        resolved.push(state.goal)
        expect(state.history.at(-1)?.tool).toBe("model_info")
        expect(tools).toEqual([tool])
        return { kind: "tool", tool, arguments: { baseRevision: 0 }, needsArguments: false }
      },
    })
    await expect(
      f.controller.run("Create a cube", [], new AbortController().signal, async () => {}),
    ).resolves.toContain("Jev ended")
    expect(resolved).toEqual(["Create a cube"])
    expect(f.calls).toEqual([
      "read_agent_skill",
      "model_info",
      "model_info",
      "create_draft",
      "model_info",
    ])
  })
  it("completes the fallback action with its own schema before dispatch", async () => {
    const requests: string[] = []
    const config = {
      endpoint: "https://helper.example/v1/chat/completions",
      model: "test-model",
      apiKey: "test-key",
      fetch: Object.assign(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const context = JSON.parse(JSON.parse(String(init?.body)).messages[1].content)
          requests.push(context.tool.name)
          if (requests.length === 2) expect(context.tool.inputSchema).toEqual(tool.inputSchema)
          return Response.json({
            choices: [
              {
                message: {
                  content:
                    requests.length === 1 ? '{"action":"create_draft"}' : '{"baseRevision":0}',
                },
                finish_reason: "stop",
              },
            ],
          })
        },
        { preconnect: () => {} },
      ),
    }
    let decisions = 0
    const f = fixture({
      decide: async () => ({ kind: "done", confidence: decisions++ === 0 ? 0.1 : 1 }),
      resolveDecision: createDecisionResolver(config),
      completeArguments: createArgumentCompleter(config),
    })
    await f.controller.run("Create a cube", [], new AbortController().signal, async () => {})
    expect(requests).toEqual(["select_next_action", "create_draft"])
    expect(f.calls.filter((name) => name === "create_draft")).toHaveLength(1)
  })
  it.each(["unknown tool", "invalid arguments", "cancelled"])(
    "rejects a helper decision with %s before dispatch",
    async (failure) => {
      const controller = new AbortController()
      const f = fixture({
        decide: async () => ({ kind: "blocked", confidence: 0.1 }),
        resolveDecision: async () => {
          if (failure === "cancelled") controller.abort()
          return {
            kind: "tool",
            tool: failure === "unknown tool" ? { ...tool, name: "create_project" } : tool,
            arguments:
              failure === "invalid arguments" ? { baseRevision: "invalid" } : { baseRevision: 0 },
            needsArguments: false,
          }
        },
      })
      await expect(
        f.controller.run("Create", [], controller.signal, async () => {}),
      ).rejects.toThrow()
      expect(f.calls).not.toContain("create_draft")
    },
  )
  it("rechecks the document revision after helper selection instead of applying stale arguments", async () => {
    let resolutions = 0
    const f = fixture({
      revisions: [0, 1],
      decide: async () => ({ kind: "blocked", confidence: 0.1 }),
      resolveDecision: async () =>
        resolutions++ === 0
          ? { kind: "tool", tool, arguments: { baseRevision: 0 }, needsArguments: false }
          : { kind: "done" },
    })
    await f.controller.run("Create", [], new AbortController().signal, async () => {})
    expect(f.calls).not.toContain("create_draft")
  })
  it("keeps uncertain-write restrictions during helper escalation without replaying the write", async () => {
    let decisions = 0
    const f = fixture({
      transportError: true,
      decide: async () =>
        decisions++ === 0
          ? {
              kind: "tool",
              tool,
              arguments: { baseRevision: 0 },
              needsArguments: false,
              confidence: 1,
            }
          : { kind: "blocked", confidence: 0.1 },
      resolveDecision: async (state, tools) => {
        expect(state.uncertainOutcome?.tool).toBe("create_draft")
        expect(tools).toEqual([])
        return { kind: "tool", tool, arguments: { baseRevision: 0 }, needsArguments: false }
      },
    })
    await expect(
      f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).rejects.toThrow()
    await expect(
      f.controller.run("Continue", [], new AbortController().signal, async () => {}),
    ).resolves.toContain("unknown outcome")
    expect(f.calls.filter((name) => name === "create_draft")).toHaveLength(1)
  })
  it("stops before dispatch without a helper, with missing arguments or an unknown tool", async () => {
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
  it("releases the turn lock after cancellation", async () => {
    const f = fixture()
    const cancelled = AbortSignal.abort()
    await expect(f.controller.run("Create", [], cancelled, async () => {})).rejects.toThrow()
    expect(
      await f.controller.run("Create", [], new AbortController().signal, async () => {}),
    ).toContain("ended the turn")
  })
})
