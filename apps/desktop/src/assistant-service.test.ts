import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AssistantEvent,
  AssistantResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import { assistantRequestSchema } from "@vibeshape/automation-api/assistant"
import { type AssistantServiceOptions, createAssistantService } from "./assistant-service"

const fixture = String.raw`
const readline = require("node:readline");
const scenario = process.argv[2];
let authenticated = false, pending, permissionPrompt, questionPrompt, selectedModel = "small", selectedEffort = "brief", configCalls = 0;
const send = message => process.stdout.write(JSON.stringify({jsonrpc:"2.0",...message})+"\n");
const reply = (id,result) => send({id,result});
const sessionId = "fake-session";
const update = value => send({method:"session/update",params:{sessionId,update:value}});
const text = value => update({sessionUpdate:"agent_message_chunk",content:{type:"text",text:value}});
const configs = (value, effort = value === "large" ? "extreme" : "brief") => [
 {id:"model",name:"Model",category:"model",type:"select",currentValue:value,options:[{value:"small",name:"Small"},{value:"large",name:"Large"}]},
 ...(scenario.startsWith("config") ? [
  {id:"strategy",name:"Agent strategy",category:"mode",type:"select",currentValue:"ask",options:[{value:"ask",name:"Ask"},{value:"edit",name:"Edit"}]},
  {id:"deliberation",name:"Reasoning effort",category:"thought_level",type:"select",currentValue:effort,options:[{group:"supported",name:"Supported",options:(value === "large" ? ["deep","extreme"] : ["brief","deep"]).map(value=>({value,name:value.toUpperCase()}))}]}
 ] : [])
];
const options = {modes:{currentModeId:"ask",availableModes:[{id:"ask",name:"Ask"},{id:"edit",name:"Edit"}]},configOptions:configs("small")};
process.on("SIGTERM", () => { text("late obsolete output"); setTimeout(()=>process.exit(0),40); });
readline.createInterface({input:process.stdin}).on("line", line => {
 const message = JSON.parse(line), {id,method,params} = message;
 if (!method) {
   if (id === "permission") { text(JSON.stringify(message.result)); reply(permissionPrompt,{stopReason:"end_turn"}); }
   if (id === "question-input") { text(JSON.stringify(message.result)); reply(questionPrompt,{stopReason:"end_turn"}); }
   return;
 }
 if (method === "initialize") {
   if (scenario === "init-hang") return;
   if (scenario === "init-fail") return send({id,error:{code:-32603,message:"private initialization secret"}});
   if (scenario === "bad-version") return reply(id,{protocolVersion:999});
   if (scenario === "client-version" && params.clientInfo.version !== "9.8.7") return send({id,error:{code:-32603,message:"Incorrect host version"}});
   if (process.env.ELECTRON_RUN_AS_NODE || params.clientCapabilities.fs || params.clientCapabilities.terminal) return process.exit(9);
   return reply(id,{protocolVersion:1,agentCapabilities:{loadSession:scenario === "resume",promptCapabilities:{image:scenario !== "no-attachments",embeddedContext:scenario !== "no-attachments"}},authMethods:[{id:"login",name:"Log in"}]});
 }
 if (method === "authenticate") { authenticated = true; return reply(id,{}); }
 if (method === "session/new" || method === "session/load") {
   if (scenario === "auth" && !authenticated) return send({id,error:{code:-32000,message:"private auth URL"}});
   const mcp = params.mcpServers[0];
   if (mcp.name !== "vibeshape" || mcp.command !== "/electron" || mcp.args[1] !== "--descriptor" || mcp.env[0].name !== "ELECTRON_RUN_AS_NODE") return process.exit(10);
   return reply(id,method === "session/new" ? {sessionId,...options} : options);
 }
 if (method === "session/set_mode") return reply(id,{});
 if (method === "session/set_config_option") {
   if (!scenario.startsWith("config")) return reply(id,{configOptions:configs(params.value)});
   configCalls++;
   if (scenario === "config-fail" && configCalls === 1) return send({id,error:{code:-32603,message:"Cannot change option"}});
   if (params.configId === "model") { selectedModel = params.value; selectedEffort = selectedModel === "large" ? "extreme" : "brief"; }
   else if (params.configId === "deliberation") {
     if (!["brief","deep","extreme"].includes(params.value)) return process.exit(11);
     selectedEffort = params.value;
   } else if (params.configId !== "strategy") return process.exit(12);
   if (scenario === "config-normalize") selectedEffort = "brief";
   if (scenario === "config-notify") {
     update({sessionUpdate:"config_option_update",configOptions:configs(selectedModel,"deep")});
     return setTimeout(()=>reply(id,{configOptions:configs(selectedModel,"brief")}),40);
   }
   if (scenario === "config-delay") { text("config-wait"); return setTimeout(()=>reply(id,{configOptions:configs(selectedModel,selectedEffort)}),1000); }
   return reply(id,{configOptions:configs(selectedModel,selectedEffort)});
 }
 if (method === "session/cancel") {
   if (scenario === "ignore-cancel") return;
   text("late cancelled output");
   if (pending !== undefined) { reply(pending,{stopReason:"cancelled"}); pending = undefined; }
   return;
 }
 if (method !== "session/prompt") return send({id,error:{code:-32601,message:"Unknown method"}});
 if (!params.prompt[0].text.includes("VibeShape") || !params.prompt[0].text.includes("Project ID")) return process.exit(13);
 const prompt = params.prompt.filter(block=>block.type === "text").at(-1).text;
 if (prompt === "inspect-attachments") { text(JSON.stringify(params.prompt)); return reply(id,{stopReason:"end_turn"}); }
 if (prompt === "ask-question" || prompt === "unsupported-question") {
   questionPrompt = id;
   return send({id:"question-input",method:"elicitation/create",params:{sessionId,mode:"form",message:"Choose a size",requestedSchema:{type:"object",properties:prompt === "unsupported-question" ? {count:{type:"integer"}} : {size:{type:"string",title:"Size",oneOf:[{const:"Small",title:"Small"},{const:"Other",title:"Other"}]},note:{type:"string",title:"Custom size",maxLength:100}},required:["size"]}}});
 }
 if (prompt === "hold") { pending = id; text("started"); return; }
 if (prompt === "crash") { process.stderr.write("private provider credential"); process.exit(3); }
 if (prompt === "malformed") return process.stdout.write('[{"jsonrpc":"2.0","method":"invalid-batch"}]\n');
 if (prompt === "invalid-json") return process.stdout.write("not-json\n");
 if (prompt === "oversized") return text("x".repeat(1024*1024));
 if (prompt === "permission" || prompt === "permission-always") {
   permissionPrompt = id;
   return send({id:"permission",method:"session/request_permission",params:{sessionId,toolCall:{toolCallId:"tool",title:"Run tool"},options:[{optionId:"yes",name:"Allow",kind:prompt === "permission-always" ? "allow_always" : "allow_once"},{optionId:"no",name:"Reject",kind:"reject_once"}]}});
 }
 update({sessionUpdate:"agent_thought_chunk",content:{type:"text",text:"Thinking"}});
 update({sessionUpdate:"tool_call",toolCallId:"tool",title:"Inspect model",status:"in_progress"});
 update({sessionUpdate:"tool_call_update",toolCallId:"tool",status:"completed",content:[{type:"content",content:{type:"text",text:"Done"}}]});
 text("Hello"); reply(id,{stopReason:"end_turn"});
});
`

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function host(overrides: Partial<AssistantServiceOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-acp-"))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const script = join(directory, "fake-agent.cjs")
  await writeFile(script, fixture)
  const events: AssistantEvent[] = []
  const waiters = new Set<(event: AssistantEvent) => void>()
  const service = createAssistantService({
    cwd: directory,
    applicationVersion: "9.8.7",
    getMcpSetup: async () => ({
      protocolVersion: 1,
      mcpServers: {
        vibeshape: {
          command: "/electron",
          args: ["/mcp.cjs", "--descriptor", "/descriptor.json"],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    }),
    onEvent(event) {
      events.push(event)
      for (const waiter of waiters) waiter(event)
    },
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    requestTimeoutMs: 3000,
    promptTimeoutMs: 3000,
    ...overrides,
  })
  cleanups.push(() => service.close())
  return {
    service,
    events,
    connect: (scenario = "normal", projectId = "project-a", resumeSessionId?: string) =>
      service.handle({
        operation: "connect",
        input: {
          projectId,
          agent: { command: "node", args: [script, scenario] },
          ...(resumeSessionId ? { resumeSessionId } : {}),
        },
      }),
    waitFor(predicate: (event: AssistantEvent) => boolean): Promise<AssistantEvent> {
      const existing = events.find(predicate)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(listener)
          reject(new Error("Missing expected assistant event."))
        }, 3000)
        const listener = (event: AssistantEvent) => {
          if (predicate(event)) {
            clearTimeout(timeout)
            waiters.delete(listener)
            resolve(event)
          }
        }
        waiters.add(listener)
      })
    },
  }
}

function ready(result: AssistantResult): AssistantSnapshot {
  if (!result.ok) throw new Error(`Unexpected assistant failure: ${result.code}`)
  return result.value
}
function scope(snapshot: AssistantSnapshot) {
  return { projectId: snapshot.projectId, sessionToken: snapshot.sessionToken }
}

describe("native ACP service", () => {
  it("retains advertised reasoning choices and replaces them with the selected model's effective configuration", async () => {
    const context = await host()
    const session = ready(await context.connect("config"))
    expect(session.configOptions.map(({ id }) => id)).toEqual(["model", "strategy", "deliberation"])
    expect(session.configOptions[2]?.options).toEqual([
      { id: "brief", name: "BRIEF" },
      { id: "deep", name: "DEEP" },
    ])
    const input = { ...scope(session), configId: "deliberation", value: "deep" }
    const selected = ready(await context.service.handle({ operation: "setConfigOption", input }))
    expect(selected.configOptions[2]?.currentValue).toBe("deep")
    const changed = ready(
      await context.service.handle({
        operation: "setModel",
        input: { ...scope(session), modelId: "large" },
      }),
    )
    expect(changed.configOptions[2]).toMatchObject({
      currentValue: "extreme",
      options: [{ id: "deep" }, { id: "extreme" }],
    })
    expect(
      await context.service.handle({
        operation: "setConfigOption",
        input: { ...input, value: "brief" },
      }),
    ).toEqual({ ok: false, code: "unsupported" })
    expect(
      await context.service.handle({
        operation: "setConfigOption",
        input: { ...input, configId: "unadvertised" },
      }),
    ).toEqual({ ok: false, code: "unsupported" })
  })

  it("uses returned effective values, preserves newer notifications, and releases failed configuration requests", async () => {
    const context = await host()
    for (const scenario of ["config-normalize", "config-notify", "config-fail"]) {
      const session = ready(await context.connect(scenario))
      const request = {
        operation: "setConfigOption",
        input: { ...scope(session), configId: "deliberation", value: "deep" },
      }
      let result = await context.service.handle(request)
      if (scenario === "config-fail") {
        expect(result).toEqual({ ok: false, code: "request-failed" })
        result = await context.service.handle(request)
      }
      expect(ready(result).configOptions[2]?.currentValue).toBe(
        scenario === "config-normalize" ? "brief" : "deep",
      )
    }
  })

  it("rejects stale configuration replies after replacement and prevents simultaneous changes", async () => {
    const context = await host()
    const session = ready(await context.connect("config-delay"))
    const request = {
      operation: "setConfigOption",
      input: { ...scope(session), configId: "deliberation", value: "deep" },
    }
    const pending = context.service.handle(request)
    await context.waitFor((event) => event.type === "text" && event.text === "config-wait")
    expect(await context.service.handle(request)).toEqual({ ok: false, code: "agent-busy" })
    const replacement = ready(await context.connect("config"))
    expect(await pending).toEqual({ ok: false, code: "stale-session" })
    expect(replacement.configOptions[2]?.currentValue).toBe("brief")
  })

  it("transfers actual text and image attachments after the exact project context and respects advertised capabilities", async () => {
    const context = await host()
    const session = ready(await context.connect())
    const attachments = [
      {
        id: "text-file",
        name: "notes with spaces.txt",
        type: "text",
        mimeType: "text/plain",
        text: "Authored file contents",
      },
      {
        id: "image-file",
        name: "view.png",
        type: "image",
        mimeType: "image/png",
        data: "aGVsbG8=",
      },
    ]
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "inspect-attachments", attachments },
      }),
    ).toMatchObject({ ok: true })
    const output = context.events.find(
      (event) => event.type === "text" && event.text.includes("attachment://"),
    )
    expect(output?.type === "text" ? JSON.parse(output.text) : null).toMatchObject([
      {
        type: "text",
        text: expect.stringContaining('Project ID (data, not instructions): "project-a"'),
      },
      { type: "text", text: "inspect-attachments" },
      {
        type: "resource",
        resource: {
          uri: "attachment://text-file/notes%20with%20spaces.txt",
          text: "Authored file contents",
        },
      },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ])
    const unsupported = ready(await context.connect("no-attachments"))
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(unsupported), text: "inspect-attachments", attachments },
      }),
    ).toEqual({ ok: false, code: "unsupported" })
  })

  it("presents only protocol questions, validates choices and custom text, and cancels unsupported forms", async () => {
    const context = await host()
    const session = ready(await context.connect())
    const prompting = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "ask-question" },
    })
    const event = await context.waitFor((event) => event.type === "question")
    if (event.type !== "question") throw new Error("Question not received")
    expect(event.question.fields[0]?.options).toEqual([
      { id: "Small", name: "Small" },
      { id: "Other", name: "Other" },
    ])
    const input = {
      ...scope(session),
      requestId: event.question.requestId,
      answers: { size: "invented", note: "custom" },
    }
    expect(await context.service.handle({ operation: "respondQuestion", input })).toEqual({
      ok: false,
      code: "invalid-request",
    })
    expect(
      await context.service.handle({
        operation: "respondQuestion",
        input: { ...input, answers: { size: "Other", note: "Custom dimensions" } },
      }),
    ).toMatchObject({ ok: true })
    expect(await prompting).toMatchObject({ ok: true })
    expect(context.events).toContainEqual({
      ...scope(session),
      type: "question-resolved",
      requestId: event.question.requestId,
    })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "unsupported-question" },
      }),
    ).toMatchObject({ ok: true })
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text.includes('"action":"decline"'),
      ),
    ).toBe(true)
  })

  it("expires unanswered questions without hanging a turn", async () => {
    const context = await host({ questionTimeoutMs: 20 })
    const session = ready(await context.connect())
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "ask-question" },
      }),
    ).toMatchObject({ ok: true })
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text.includes('"action":"cancel"'),
      ),
    ).toBe(true)
  })

  it("reports the host application version during ACP initialization", async () => {
    const context = await host()
    expect(ready(await context.connect("client-version")).status).toBe("ready")
  })

  it("streams text, thoughts and tools through a real stdio agent with no filesystem or terminal client capabilities", async () => {
    const context = await host()
    const session = ready(await context.connect())
    expect(session).toMatchObject({
      status: "ready",
      sessionId: "fake-session",
      canResume: false,
      currentModeId: "ask",
      currentModelId: "small",
    })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "hello" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    expect(
      context.events.filter((event) =>
        ["text", "thought", "tool", "completed"].includes(event.type),
      ),
    ).toMatchObject([
      { type: "thought", text: "Thinking" },
      { type: "tool", status: "in_progress" },
      { type: "tool", status: "completed", text: "Done" },
      { type: "text", text: "Hello" },
      { type: "completed", stopReason: "end_turn" },
    ])
    expect(
      await context.service.handle({
        operation: "setMode",
        input: { ...scope(session), modeId: "edit" },
      }),
    ).toMatchObject({ ok: true, value: { currentModeId: "edit" } })
    expect(
      await context.service.handle({
        operation: "setModel",
        input: { ...scope(session), modelId: "large" },
      }),
    ).toMatchObject({ ok: true, value: { currentModelId: "large" } })
  })

  it("locks a turn until cancellation is acknowledged and ignores cancelled streaming updates", async () => {
    const context = await host()
    const session = ready(await context.connect())
    const turn = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "hold" },
    })
    await context.waitFor((event) => event.type === "text" && event.text === "started")
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "duplicate" },
      }),
    ).toEqual({ ok: false, code: "agent-busy" })
    expect(
      await context.service.handle({ operation: "cancel", input: scope(session) }),
    ).toMatchObject({ ok: true, value: { status: "cancelling" } })
    expect(await turn).toMatchObject({ ok: true, value: { status: "ready" } })
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text === "late cancelled output",
      ),
    ).toBe(false)
  })

  it("kills an agent that ignores cancellation", async () => {
    const context = await host({ cancelTimeoutMs: 20 })
    const session = ready(await context.connect("ignore-cancel"))
    const turn = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "hold" },
    })
    await context.waitFor((event) => event.type === "text")
    await context.service.handle({ operation: "cancel", input: scope(session) })
    expect(await turn).toEqual({ ok: false, code: "timeout" })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "again" },
      }),
    ).toEqual({ ok: false, code: "agent-exited" })
  })

  it("requires an explicit allow-once response and never upgrades it to an always permission", async () => {
    const context = await host()
    const session = ready(await context.connect())
    const turn = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "permission" },
    })
    const event = await context.waitFor((item) => item.type === "permission")
    if (event.type !== "permission") throw new Error("Expected permission request.")
    expect(event.canAllow).toBe(true)
    await context.service.handle({
      operation: "respondPermission",
      input: { ...scope(session), requestId: event.requestId, allow: true },
    })
    await turn
    expect(context.events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: '{"outcome":{"outcome":"selected","optionId":"yes"}}',
      }),
    )
  })

  it("rejects expired permissions and cannot select allow-always", async () => {
    const context = await host({ permissionTimeoutMs: 20 })
    const session = ready(await context.connect())
    const turn = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "permission-always" },
    })
    const event = await context.waitFor((item) => item.type === "permission")
    if (event.type !== "permission") throw new Error("Expected permission request.")
    expect(event.canAllow).toBe(false)
    await turn
    expect(
      await context.service.handle({
        operation: "respondPermission",
        input: { ...scope(session), requestId: event.requestId, allow: true },
      }),
    ).toEqual({ ok: false, code: "permission-expired" })
    expect(context.events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: '{"outcome":{"outcome":"selected","optionId":"no"}}',
      }),
    )
  })

  it("keeps simultaneous project turns independent through cancellation and disconnect", async () => {
    const context = await host()
    const first = ready(await context.connect())
    const firstTurn = context.service.handle({
      operation: "prompt",
      input: { ...scope(first), text: "hold" },
    })
    await context.waitFor((event) => event.projectId === first.projectId && event.type === "text")
    const second = ready(await context.connect("normal", "project-b"))
    const secondTurn = context.service.handle({
      operation: "prompt",
      input: { ...scope(second), text: "hold" },
    })
    await context.waitFor((event) => event.projectId === second.projectId && event.type === "text")
    expect(
      await context.service.handle({
        operation: "cancel",
        input: { projectId: second.projectId, sessionToken: first.sessionToken },
      }),
    ).toEqual({ ok: false, code: "stale-session" })
    expect(
      await context.service.handle({ operation: "cancel", input: scope(second) }),
    ).toMatchObject({ ok: true })
    expect(await secondTurn).toMatchObject({ ok: true, value: { projectId: "project-b" } })
    expect(
      await context.service.handle({ operation: "disconnect", input: scope(second) }),
    ).toMatchObject({ ok: true })
    expect(
      await context.service.handle({ operation: "cancel", input: scope(first) }),
    ).toMatchObject({ ok: true })
    expect(await firstTurn).toMatchObject({ ok: true, value: { projectId: "project-a" } })
    expect(
      context.events.some((event) => event.projectId === first.projectId && event.type === "error"),
    ).toBe(false)
  })

  it("replaces the same project process and rejects its token and late updates", async () => {
    const context = await host()
    const first = ready(await context.connect())
    const turn = context.service.handle({
      operation: "prompt",
      input: { ...scope(first), text: "hold" },
    })
    await context.waitFor((event) => event.type === "text")
    const second = ready(await context.connect("normal", "project-a"))
    expect(second.sessionToken).not.toBe(first.sessionToken)
    expect(await turn).toEqual({ ok: false, code: "stale-session" })
    expect(await context.service.handle({ operation: "cancel", input: scope(first) })).toEqual({
      ok: false,
      code: "stale-session",
    })
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text === "late obsolete output",
      ),
    ).toBe(false)
  })

  it("reports authentication needed and only exposes an actual resumable ACP session", async () => {
    const context = await host()
    const auth = ready(await context.connect("auth"))
    expect(auth).toMatchObject({
      status: "authentication-required",
      sessionId: null,
      authMethods: [{ id: "login", name: "Log in" }],
    })
    expect(
      await context.service.handle({
        operation: "authenticate",
        input: { ...scope(auth), methodId: "login" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready", sessionId: "fake-session" } })
    expect(await context.connect("normal", "project-a", "saved-session")).toEqual({
      ok: false,
      code: "unsupported",
    })
    expect(await context.connect("resume", "project-a", "saved-session")).toMatchObject({
      ok: true,
      value: { sessionId: "saved-session", canResume: true },
    })
  })

  it("returns bounded diagnostics for launch, initialization, crash, malformed and oversized output", async () => {
    const context = await host()
    expect(
      await context.service.handle({
        operation: "connect",
        input: { projectId: "project-a", agent: { command: "/missing/vibeshape-agent", args: [] } },
      }),
    ).toEqual({ ok: false, code: "launch-failed" })
    expect(await context.connect("init-fail")).toEqual({ ok: false, code: "initialization-failed" })
    expect(await context.connect("bad-version")).toEqual({ ok: false, code: "protocol-error" })
    for (const [text, code] of [
      ["crash", "agent-exited"],
      ["malformed", "protocol-error"],
      ["oversized", "protocol-error"],
    ] as const) {
      const session = ready(await context.connect())
      expect(
        await context.service.handle({ operation: "prompt", input: { ...scope(session), text } }),
      ).toEqual({ ok: false, code })
    }
    expect(JSON.stringify(context.events)).not.toContain("private")
  })

  it("times out initialization and refuses an existing MCP client before spawning", async () => {
    const context = await host({ requestTimeoutMs: 100 })
    expect(await context.connect("init-hang")).toEqual({ ok: false, code: "timeout" })
    const conflict = await host({ isMcpClientAttached: () => true })
    expect(await conflict.connect()).toEqual({ ok: false, code: "mcp-client-conflict" })
  })

  it("waits for the previous assistant relay to detach before replacing it", async () => {
    let attached = false
    let release = () => {}
    let captured = false
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const context = await host({
      isMcpClientAttached: () => attached,
      whenMcpClientReleased() {
        captured = true
        return released
      },
    })
    const first = ready(await context.connect())
    attached = true
    const replacement = context.connect("normal", "project-a")
    expect(captured).toBe(true)
    expect(attached).toBe(true)
    attached = false
    release()
    expect(ready(await replacement)).toMatchObject({ projectId: "project-a", status: "ready" })
    expect(await context.service.handle({ operation: "cancel", input: scope(first) })).toEqual({
      ok: false,
      code: "stale-session",
    })
    expect(
      context.events.some((event) => event.type === "text" && event.text.includes("obsolete")),
    ).toBe(false)
  })

  it("retains teardown after disconnect and only starts the latest concurrent replacement", async () => {
    let attached = false
    let release = () => {}
    let setupCalls = 0
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const context = await host({
      isMcpClientAttached() {
        setupCalls += 1
        return attached
      },
      whenMcpClientReleased: () => released,
    })
    const first = ready(await context.connect())
    attached = true
    const disconnected = context.service.handle({ operation: "disconnect", input: scope(first) })
    const obsolete = context.connect("normal", "project-a")
    const latest = context.connect("normal", "project-a")
    expect(setupCalls).toBe(1)
    attached = false
    release()
    expect(await disconnected).toMatchObject({ ok: true, value: { status: "disconnected" } })
    expect(await obsolete).toEqual({ ok: false, code: "stale-session" })
    expect(ready(await latest)).toMatchObject({ projectId: "project-a", status: "ready" })
    expect(setupCalls).toBe(2)
  })

  it("keeps a still-attached external client protected after bounded cleanup", async () => {
    let attached = false
    const context = await host({
      isMcpClientAttached: () => attached,
      whenMcpClientReleased: () => new Promise<void>(() => {}),
      shutdownTimeoutMs: 20,
    })
    ready(await context.connect())
    attached = true
    expect(await context.connect("normal", "project-a")).toEqual({
      ok: false,
      code: "mcp-client-conflict",
    })
    expect(attached).toBe(true)
    await context.service.close()
    expect(await context.connect()).toEqual({ ok: false, code: "stale-session" })
  })

  it("closes pending replacement work without spawning a stale owner", async () => {
    let release = () => {}
    let checks = 0
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const context = await host({
      isMcpClientAttached() {
        checks += 1
        return false
      },
      whenMcpClientReleased: () => released,
    })
    ready(await context.connect())
    const replacement = context.connect("normal", "project-a")
    const closed = context.service.close()
    expect(checks).toBe(1)
    release()
    await closed
    expect(await replacement).toEqual({ ok: false, code: "stale-session" })
    expect(checks).toBe(1)
  })

  it("bounds malformed JSON that the ACP transport rejects without ending the turn", async () => {
    const context = await host({ promptTimeoutMs: 100 })
    const session = ready(await context.connect())
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "invalid-json" },
      }),
    ).toEqual({ ok: false, code: "timeout" })
  })

  it("validates strict IPC-sized inputs before starting any process", async () => {
    const context = await host()
    expect(
      await context.service.handle({
        operation: "connect",
        input: { projectId: "p", agent: { command: "node\0", args: [] } },
      }),
    ).toEqual({ ok: false, code: "invalid-request" })
    expect(
      assistantRequestSchema.safeParse({
        operation: "prompt",
        input: { projectId: "p", sessionToken: "s", text: "x".repeat(32_769) },
      }).success,
    ).toBe(false)
    expect(
      assistantRequestSchema.safeParse({
        operation: "disconnect",
        input: { projectId: "p", sessionToken: "s", ignored: true },
      }).success,
    ).toBe(false)
    expect(context.events).toEqual([])
  })
})
