import { afterEach, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import {
  type AssistantBridge,
  type AssistantEvent,
  type AssistantRequest,
  type AssistantResult,
  type AssistantSnapshot,
  assistantEventSchema,
  assistantResultSchema,
} from "@vibeshape/automation-api/assistant"
import { createNativeChatController } from "./native-chat-controller"

const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
const fixture = String.raw`
const fs = require("node:fs"), path = require("node:path");
const input = require("node:readline").createInterface({ input: process.stdin });
const sessionId = "continuation-controls";
let original;
const send = value => process.stdout.write(JSON.stringify({jsonrpc:"2.0", ...value})+"\n");
const reply = (id,result) => send({id,result});
const update = update => send({method:"session/update",params:{sessionId,update}});
const text = text => update({sessionUpdate:"agent_message_chunk",content:{type:"text",text}});
const status = type => update({sessionUpdate:"session_info_update",_meta:{codex:{threadStatus:{type}}}});
const after = (name, action) => {
 const file = path.join(__dirname,name);
 let triggered = false;
 const check = () => { if(!triggered && fs.existsSync(file)){triggered = true; clearInterval(interval); action();} };
 const interval = setInterval(check,10);
 check();
};
input.on("line", line => {
 const {id,method,params,result} = JSON.parse(line);
 if (!method) {
   if (id === "permission") text(result.outcome.outcome === "selected" && result.outcome.optionId === "yes" ? "permission accepted" : "permission declined");
   if (id === "question") text(result.action === "accept" && result.content.size === "Large" ? "question accepted" : "question declined");
   return;
 }
 if (method === "initialize") return reply(id,{protocolVersion:1,agentInfo:{name:"@agentclientprotocol/codex-acp",version:"2.2.2"},agentCapabilities:{promptCapabilities:{embeddedContext:true}},_meta:{steering:{supported:true}}});
 if (method === "session/new") return reply(id,{sessionId});
 if (method === "session/prompt") {
   const prompt = params.prompt.filter(block=>block.type === "text").at(-1).text;
   text("received:"+prompt);
   if (prompt !== "queued original") return reply(id,{stopReason:"end_turn"});
   original = id; status("active"); return;
 }
 if (method === "_session/steering") {
   status("idle"); text("steering received");
   after("ack",()=>reply(id,{outcome:"startedNewTurn"}));
   after("ack-failed",()=>reply(id,{outcome:"failed"}));
   after("fallback-start",()=>{
     status("active");
     update({sessionUpdate:"tool_call",toolCallId:"fallback-tool",title:"Fallback tool",status:"in_progress"});
     send({id:"permission",method:"session/request_permission",params:{sessionId,toolCall:{toolCallId:"fallback-tool",title:"Fallback tool"},options:[{optionId:"yes",name:"Allow",kind:"allow_once"},{optionId:"no",name:"Reject",kind:"reject_once"}]}});
     send({id:"question",method:"elicitation/create",params:{sessionId,mode:"form",message:"Choose a size",requestedSchema:{type:"object",properties:{size:{type:"string",enum:["Small","Large"]}},required:["size"]}}});
   });
   after("fallback-end",()=>{
     update({sessionUpdate:"tool_call_update",toolCallId:"fallback-tool",status:"completed"});
     text("fallback ended"); status("idle");
   });
   after("original-success",()=>reply(original,{stopReason:"end_turn"}));
   after("original-failure",()=>send({id:original,error:{code:-32603,message:"Original prompt failed"}}));
   after("original-auth",()=>send({id:original,error:{code:-32000,message:"Authentication required"}}));
   after("crash",()=>process.exit(3));
   return;
 }
 if (method === "session/cancel") { reply(original,{stopReason:"cancelled"}); status("idle"); }
});
`

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function host({ preexistingAck = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-continuation-"))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  if (preexistingAck) await writeFile(join(directory, "ack"), "")
  const script = join(directory, "agent.cjs")
  await writeFile(script, fixture)
  const listeners = new Set<(event: AssistantEvent) => void>()
  const events: AssistantEvent[] = []
  const serviceScript = join(directory, "service.ts")
  const servicePath = new URL("../../../desktop/src/assistant-service.ts", import.meta.url).pathname
  // Keep Node stream types out of the DOM test graph, as in the native host/renderer boundary.
  await writeFile(
    serviceScript,
    `
import { createInterface } from "node:readline";
import { createAssistantService } from ${JSON.stringify(servicePath)};
const send = value => process.stdout.write(JSON.stringify(value)+"\\n");
const service = createAssistantService({
 cwd: ${JSON.stringify(directory)}, applicationVersion: "0.1.6",
 getMcpSetup: async () => ({protocolVersion:1,mcpServers:{vibeshape:{command:"/unused",args:["/mcp.cjs","--descriptor","/descriptor.json"],env:{ELECTRON_RUN_AS_NODE:"1"}}}}),
 onEvent: event => send({event}), requestTimeoutMs:3000, promptTimeoutMs:10000,
});
createInterface({input:process.stdin}).on("line",line=>{
 const {id,request}=JSON.parse(line);
 service.handle(request).then(result=>send({id,result}));
});
process.on("SIGTERM",()=>{service.close().finally(()=>process.exit(0));});
`,
  )
  const child = spawn(process.execPath, [serviceScript], { stdio: ["pipe", "pipe", "pipe"] })
  const pending = new Map<
    number,
    { operation: AssistantRequest["operation"]; settle: (result: AssistantResult) => void }
  >()
  const held = new Map<
    AssistantRequest["operation"],
    (result: AssistantResult, settle: (result: AssistantResult) => void) => void
  >()
  const releases = new Set<() => void>()
  let sequence = 0
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line)
    if (message.event) {
      const event = assistantEventSchema.parse(message.event)
      events.push(event)
      for (const listener of listeners) listener(event)
    } else {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (!request) return
      const result = assistantResultSchema.parse(message.result)
      const hold = held.get(request.operation)
      held.delete(request.operation)
      if (hold) hold(result, request.settle)
      else request.settle(result)
    }
  })
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk)
  })
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => {
      for (const { settle } of pending.values()) settle({ ok: false, code: "agent-exited" })
      pending.clear()
      resolve()
    }),
  )
  cleanups.push(async () => {
    for (const release of releases) release()
    child.kill()
    await exited
  })
  const request = (request: AssistantRequest) =>
    new Promise<AssistantResult>((resolve) => {
      const id = ++sequence
      pending.set(id, { operation: request.operation, settle: resolve })
      child.stdin.write(`${JSON.stringify({ id, request })}\n`)
    })
  const bridge: AssistantBridge = {
    protocolVersion: 1,
    connect: (input) => request({ operation: "connect", input }),
    disconnect: (input) => request({ operation: "disconnect", input }),
    prompt: (input) =>
      request({ operation: "prompt", input: { ...input, attachments: input.attachments ?? [] } }),
    steer: (input) =>
      request({ operation: "steer", input: { ...input, attachments: input.attachments ?? [] } }),
    cancel: (input) => request({ operation: "cancel", input }),
    authenticate: (input) => request({ operation: "authenticate", input }),
    setMode: (input) => request({ operation: "setMode", input }),
    setModel: (input) => request({ operation: "setModel", input }),
    setConfigOption: (input) => request({ operation: "setConfigOption", input }),
    respondPermission: (input) => request({ operation: "respondPermission", input }),
    respondQuestion: (input) => request({ operation: "respondQuestion", input }),
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const values = new Map<string, string>()
  const chat = createNativeChatController({
    projectId,
    bridge,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      },
    },
  })
  cleanups.push(async () => chat.dispose())
  chat.start()
  await chat.connect({ command: "node", args: [script] })
  expect(chat.getSnapshot()).toMatchObject({ error: null, snapshot: { status: "ready" } })
  await chat.enqueue("queued original")
  await chat.resumeQueue()
  await until(() =>
    events.some((event) => event.type === "text" && event.text === "received:queued original"),
  )
  await chat.enqueue("queued continuation")
  const queued = chat.getSnapshot().queuedMessages[0]
  if (!queued) throw new Error("Missing queued continuation")
  const steering = chat.steerQueued(queued.id)
  await until(() =>
    events.some((event) => event.type === "text" && event.text === "steering received"),
  )
  return {
    chat,
    events,
    steering,
    configuration: { command: "node", args: [script] },
    emitSnapshot(snapshot: AssistantSnapshot) {
      const event: AssistantEvent = {
        type: "snapshot",
        projectId,
        sessionToken: snapshot.sessionToken,
        snapshot,
      }
      for (const listener of listeners) listener(event)
    },
    signal: (name: string) => writeFile(join(directory, name), ""),
    holdResult(operation: AssistantRequest["operation"]) {
      let capture = (_result: AssistantResult) => {}
      const observed = new Promise<AssistantResult>((resolve) => {
        capture = resolve
      })
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      releases.add(release)
      held.set(operation, (result, settle) => {
        capture(result)
        void gate.then(() => settle(result))
      })
      return { observed, release }
    },
  }
}

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Continuation state did not settle")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe("native continuation controls through the real service", () => {
  it("accepts a preexisting ACK when steering registers its signal handler", async () => {
    const context = await host({ preexistingAck: true })
    expect(await context.steering).toBe(true)
    expect(context.chat.getSnapshot().queuedMessages).toEqual([])
    expect(
      context.chat
        .getSnapshot()
        .messages.filter((message) => message.role === "user")
        .map((message) => message.text),
    ).toEqual(["queued original", "queued continuation"])
  })

  it.each(["disconnect", "newer snapshot"] as const)(
    "does not overwrite a reentrant %s during terminal cleanup",
    async (replacement) => {
      const context = await host()
      const { chat } = context
      await context.signal("ack")
      expect(await context.steering).toBe(true)
      await context.signal("fallback-start")
      await until(
        () => chat.getSnapshot().permission !== null && chat.getSnapshot().question !== null,
      )
      const previous = chat.getSnapshot().snapshot
      if (!previous) throw new Error("Missing active host snapshot")
      let replaced = false
      let disconnected: Promise<void> | undefined
      const unsubscribe = chat.subscribe(() => {
        if (replaced || chat.getSnapshot().permission || chat.getSnapshot().question) return
        replaced = true
        if (replacement === "disconnect") disconnected = chat.disconnect()
        else context.emitSnapshot({ ...previous, status: "authentication-required" })
      })
      context.emitSnapshot({ ...previous, status: "ready" })
      expect(replaced).toBe(true)
      await disconnected
      unsubscribe()
      expect(chat.getSnapshot()).toMatchObject({ busy: false, permission: null, question: null })
      if (replacement === "disconnect") expect(chat.getSnapshot().snapshot).toBeNull()
      else expect(chat.getSnapshot().snapshot?.status).toBe("authentication-required")
    },
  )

  it.each(["accepted", "failed"] as const)(
    "settles the exact queued predecessor retry after a delayed %s Steer receipt across reconnect",
    async (outcome) => {
      const context = await host()
      const { chat, events } = context
      const held = context.holdResult("steer")
      await context.signal(outcome === "accepted" ? "ack" : "ack-failed")
      expect(await held.observed).toMatchObject({ ok: outcome === "accepted" })
      await chat.disconnect()
      await chat.connect(context.configuration)
      expect(chat.getSnapshot().snapshot?.status).toBe("ready")
      held.release()
      expect(await context.steering).toBe(outcome === "accepted")
      expect(chat.getSnapshot().queuedMessages.map((message) => message.text)).toEqual(
        outcome === "accepted" ? [] : ["queued original", "queued continuation"],
      )
      expect(chat.getSnapshot().queuePaused).toBe(true)
      expect(await chat.resumeQueue()).toBe(true)
      if (outcome === "accepted") {
        expect(await chat.send("after reconnect")).toBe(true)
        await until(
          () =>
            events.some(
              (event) => event.type === "text" && event.text === "received:after reconnect",
            ) && !chat.getSnapshot().busy,
        )
      } else {
        await until(
          () =>
            events.filter(
              (event) => event.type === "text" && event.text === "received:queued original",
            ).length === 2,
        )
        await chat.cancel()
      }
      expect(
        events.filter(
          (event) => event.type === "text" && event.text === "received:queued original",
        ),
      ).toHaveLength(outcome === "accepted" ? 1 : 2)
    },
  )

  it.each(["prompt", "cancel", "respondQuestion"] as const)(
    "does not replace a newer streamed ready snapshot with a delayed %s result",
    async (operation) => {
      const context = await host()
      const { chat, events } = context
      await context.signal("ack")
      expect(await context.steering).toBe(true)
      await context.signal("fallback-start")
      await until(
        () => chat.getSnapshot().permission !== null && chat.getSnapshot().question !== null,
      )
      const held = context.holdResult(operation)
      const at = events.length
      let answer: Promise<unknown> | undefined
      if (operation === "cancel") answer = chat.cancel()
      else {
        await context.signal("original-success")
        if (operation === "prompt") await held.observed
        await chat.respondPermission(true)
        answer = chat.respondQuestion({ size: "Large" })
      }
      const captured = await held.observed
      expect(captured).toMatchObject({
        ok: true,
        value: { status: operation === "cancel" ? "cancelling" : "prompting" },
      })
      if (operation !== "cancel") await context.signal("fallback-end")
      await until(() =>
        events
          .slice(at)
          .some((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
      )
      expect(chat.getSnapshot().snapshot?.status).toBe("ready")
      held.release()
      if (operation === "respondQuestion") expect(await answer).toBe(true)
      else await answer
      await until(() => chat.resumeQueue())
      expect(chat.getSnapshot()).toMatchObject({
        busy: false,
        permission: null,
        question: null,
        snapshot: { status: "ready" },
      })
      expect(await chat.send("next prompt")).toBe(true)
      await until(
        () =>
          events.some((event) => event.type === "text" && event.text === "received:next prompt") &&
          !chat.getSnapshot().busy,
      )
    },
  )

  it("keeps ordinary retry eligibility if both the predecessor and unaccepted steering request fail", async () => {
    const context = await host()
    await context.signal("original-failure")
    await until(() =>
      context.events.some((event) => event.type === "error" && event.code === "request-failed"),
    )
    expect(context.chat.getSnapshot().queuedMessages.map((message) => message.text)).toEqual([
      "queued continuation",
    ])
    await context.signal("ack-failed")
    expect(await context.steering).toBe(false)
    await until(() => context.chat.getSnapshot().queuedMessages.length === 2)
    expect(context.chat.getSnapshot().queuedMessages.map((message) => message.text)).toEqual([
      "queued original",
      "queued continuation",
    ])
    expect(context.chat.getSnapshot().queuePaused).toBe(true)
  })

  it.each(["Stop", "fatal", "authentication"] as const)(
    "clears genuine terminal controls on %s",
    async (termination) => {
      const context = await host()
      await context.signal("ack")
      expect(await context.steering).toBe(true)
      await context.signal("fallback-start")
      await until(
        () =>
          context.chat.getSnapshot().permission !== null &&
          context.chat.getSnapshot().question !== null,
      )
      if (termination === "Stop") await context.chat.cancel()
      else await context.signal(termination === "fatal" ? "crash" : "original-auth")
      const status =
        termination === "Stop"
          ? "ready"
          : termination === "fatal"
            ? "error"
            : "authentication-required"
      await until(
        () =>
          context.chat.getSnapshot().snapshot?.status === status &&
          !context.chat.getSnapshot().busy,
      )
      expect(context.chat.getSnapshot().permission).toBeNull()
      expect(context.chat.getSnapshot().question).toBeNull()
      expect(context.chat.getSnapshot().queuedMessages).toEqual([])
      expect(
        context.chat
          .getSnapshot()
          .messages.filter((message) => message.role === "tool")
          .map((message) => message.tool?.status),
      ).toEqual([termination === "Stop" ? "cancelled" : "failed"])
      expect(context.chat.getSnapshot().queuePaused).toBe(true)
    },
  )

  for (const outcome of ["success", "failure"] as const) {
    for (const acknowledgement of ["before", "after"] as const) {
      it.each(["before", "after"] as const)(
        `preserves controls and delivery when original ${outcome} follows ACK ${acknowledgement} and arrives %s fallback completion`,
        async (completion) => {
          const context = await host()
          const { chat, events } = context
          if (acknowledgement === "before") {
            await context.signal("ack")
            expect(await context.steering).toBe(true)
          }
          await context.signal("fallback-start")
          await until(
            () => chat.getSnapshot().permission !== null && chat.getSnapshot().question !== null,
          )
          const permission = chat.getSnapshot().permission
          const question = chat.getSnapshot().question
          const settleOriginal = async () => {
            await context.signal(`original-${outcome}`)
            await until(() =>
              events.some((event) =>
                outcome === "success"
                  ? event.type === "completed"
                  : event.type === "error" && event.code === "request-failed",
              ),
            )
          }
          if (completion === "before") {
            await settleOriginal()
            expect(chat.getSnapshot().permission).toEqual(permission)
            expect(chat.getSnapshot().question).toEqual(question)
            expect(chat.getSnapshot().busy).toBe(true)
            expect(
              chat.getSnapshot().messages.filter((message) => message.role === "tool"),
            ).toHaveLength(1)
            expect(
              chat.getSnapshot().messages.find((message) => message.role === "tool")?.tool?.status,
            ).toBe("in_progress")
          }
          await chat.respondPermission(true)
          expect(await chat.respondQuestion({ size: "Large" })).toBe(true)
          await until(
            () =>
              events.some(
                (event) => event.type === "text" && event.text === "permission accepted",
              ) &&
              events.some((event) => event.type === "text" && event.text === "question accepted"),
          )
          await context.signal("fallback-end")
          await until(() =>
            events.some((event) => event.type === "text" && event.text === "fallback ended"),
          )
          if (completion === "after") await settleOriginal()
          if (acknowledgement === "after") {
            await context.signal("ack")
            expect(await context.steering).toBe(true)
          }
          await until(
            () =>
              !chat.getSnapshot().busy &&
              chat.getSnapshot().snapshot?.status === "ready" &&
              chat.getSnapshot().steeringQueuedId === null,
          )
          expect(chat.getSnapshot().queuedMessages).toEqual([])
          expect(chat.getSnapshot().permission).toBeNull()
          expect(chat.getSnapshot().question).toBeNull()
          expect(
            chat
              .getSnapshot()
              .messages.filter((message) => message.role === "user")
              .map((message) => message.text),
          ).toEqual(["queued original", "queued continuation"])
          expect(
            chat
              .getSnapshot()
              .messages.filter((message) => message.role === "tool")
              .map((message) => message.tool?.status),
          ).toEqual(["completed"])
          await until(() => chat.resumeQueue())
          expect(await chat.send("next prompt")).toBe(true)
          await until(
            () =>
              events.some(
                (event) => event.type === "text" && event.text === "received:next prompt",
              ) && !chat.getSnapshot().busy,
          )
          expect(
            events.filter(
              (event) => event.type === "text" && event.text === "received:queued original",
            ),
          ).toHaveLength(1)
        },
      )
    }
  }
})
