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
let authenticated = false, pending, permissionPrompt, questionPrompt, selectedModel = "small", selectedEffort = "brief", configCalls = 0, attachedMcp, steerCalls = 0;
const send = message => process.stdout.write(JSON.stringify({jsonrpc:"2.0",...message})+"\n");
const reply = (id,result) => send({id,result});
let sessionId = "fake-session";
const update = value => send({method:"session/update",params:{sessionId,update:value}});
const text = value => update({sessionUpdate:"agent_message_chunk",content:{type:"text",text:value}});
const threadStatus = type => update({sessionUpdate:"session_info_update",_meta:{codex:{threadStatus:{type}}}});
const afterSignal = (name, action) => {
 const fs = require("node:fs"), path = require("node:path").join(__dirname,name);
 let triggered = false;
 const check = () => { if (!triggered && fs.existsSync(path)) { triggered = true; clearInterval(interval); action(); } };
 const interval = setInterval(check,10);
 check();
};
const gatedFallback = prefix => afterSignal(prefix+"-start",()=>{
 threadStatus("active"); text(prefix+" output");
 afterSignal(prefix+"-end",()=>{text(prefix+" finished");threadStatus("idle");});
});
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
   return reply(id,{protocolVersion:1,agentCapabilities:{loadSession:scenario === "resume",promptCapabilities:{image:scenario !== "no-attachments",embeddedContext:scenario !== "no-attachments"}},authMethods:[{id:"login",name:"Log in"}],...(scenario.startsWith("steer") ? {agentInfo:{name:scenario === "steer-foreign" ? "unverified-agent" : "@agentclientprotocol/codex-acp",version:scenario === "steer-future" ? "2.2.3" : "2.2.2"},_meta:{steering:{supported:true}}} : {})});
 }
 if (method === "authenticate") { authenticated = true; return reply(id,{}); }
 if (method === "session/new" || method === "session/load") {
   if (method === "session/load") sessionId = params.sessionId;
   if (scenario === "auth" && !authenticated) return send({id,error:{code:-32000,message:"private auth URL"}});
   // Match adapters that filter every configured name, including disabled global entries.
   const configuredLayers = [{mcp_servers:{vibeshape:{enabled:false}}}];
   const names = new Set(configuredLayers.flatMap(layer=>Object.keys(layer.mcp_servers)));
   attachedMcp = params.mcpServers.filter(server=>!names.has(server.name));
   const mcp = attachedMcp[0];
   if (params.mcpServers.length !== 1 || attachedMcp.length !== 1 || !/^vs_[0-9a-f]{16}$/.test(mcp.name) || mcp.command !== "/electron" || mcp.args[1] !== "--descriptor" || mcp.env[0].name !== "ELECTRON_RUN_AS_NODE") return process.exit(10);
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
   if (scenario === "ignore-cancel" || scenario === "steer-new-prompt-pending") return;
   text("late cancelled output");
   if (pending !== undefined) { reply(pending,{stopReason:"cancelled"}); pending = undefined; }
   if (scenario.startsWith("steer")) threadStatus("idle");
   return;
 }
 if (method === "_session/steering") {
   steerCalls++;
   text(JSON.stringify({steerCalls,prompt:params.prompt}));
   if (scenario === "steer-failed") return reply(id,{outcome:"failed"});
   if (scenario === "steer-malformed") return reply(id,{outcome:"unknown"});
   if (scenario === "steer-new-prompt-pending") {
     threadStatus("idle");
     gatedFallback("pending-prompt-fallback");
     afterSignal("pending-prompt-ack",()=>reply(id,{outcome:"startedNewTurn"}));
     const settle = failed => {
       text("original prompt RPC settling");
       if (failed) send({id:pending,error:{code:-32603,message:"Fixture prompt failed"}});
       else reply(pending,{stopReason:"end_turn"});
       pending = undefined;
     };
     afterSignal("original-prompt-settle",()=>settle(false));
     afterSignal("original-prompt-fail",()=>settle(true));
     return;
   }
   if (scenario === "steer-new-prior-idle") {
     afterSignal("current-turn",()=>{
       threadStatus("active"); text("second turn active");
       threadStatus("idle"); reply(pending,{stopReason:"end_turn"}); pending = undefined;
       afterSignal("steer-ack",()=>{
         reply(id,{outcome:"startedNewTurn"});
         afterSignal("fallback-start",()=>{
           threadStatus("active"); text("actual fallback output");
           afterSignal("fallback-end",()=>{text("actual fallback finished");threadStatus("idle");});
         });
       });
     });
     return;
   }
   if (scenario === "steer-new-current-idle") {
     reply(pending,{stopReason:"end_turn"}); pending = undefined;
     gatedFallback("current-idle-fallback");
     afterSignal("current-idle-ack",()=>reply(id,{outcome:"startedNewTurn"}));
     return;
   }
   if (scenario === "steer-new-repeated-reserved") {
     if (steerCalls === 1) {
       reply(pending,{stopReason:"end_turn"}); pending = undefined;
       reply(id,{outcome:"startedNewTurn"}); gatedFallback("first-fallback");
     } else {
       afterSignal("second-steer-ack",()=>reply(id,{outcome:"startedNewTurn"}));
       gatedFallback("second-fallback");
     }
     return;
   }
   if (scenario.startsWith("steer-new")) {
     const start = () => {
       if (pending !== undefined) { reply(pending,{stopReason:"end_turn"}); pending = undefined; }
       threadStatus("idle");
       if (scenario === "steer-new-no-status") return reply(id,{outcome:"startedNewTurn"});
       if (scenario === "steer-new-status-lag") {
         reply(id,{outcome:"startedNewTurn"});
         setTimeout(()=>threadStatus("idle"),10);
         setTimeout(()=>{threadStatus("active");text("fallback active after acknowledgement");},50);
         return setTimeout(()=>threadStatus("idle"),150);
       }
       threadStatus("active"); text("fallback before acknowledgement");
       if (scenario === "steer-new-fast") { text("fallback completed before acknowledgement"); threadStatus("idle"); }
       reply(id,{outcome:"startedNewTurn"});
       if (scenario !== "steer-new-fast") setTimeout(()=>{text("fallback after acknowledgement");threadStatus("idle");},150);
     };
     return setTimeout(start,scenario === "steer-new-late" ? 100 : 0);
   }
   return setTimeout(()=>reply(id,{outcome:"injected"}),30);
 }
 if (method !== "session/prompt") return send({id,error:{code:-32601,message:"Unknown method"}});
 if (!params.prompt[0].text.includes("VibeShape") || !params.prompt[0].text.includes("Project ID")) return process.exit(13);
 const prompt = params.prompt.filter(block=>block.type === "text").at(-1).text;
 if (prompt === "inspect-mcp") { text(JSON.stringify(attachedMcp)); return reply(id,{stopReason:"end_turn"}); }
 if (prompt === "inspect-attachments") { text(JSON.stringify(params.prompt)); return reply(id,{stopReason:"end_turn"}); }
 if (prompt === "ask-question" || prompt === "unsupported-question") {
   questionPrompt = id;
   return send({id:"question-input",method:"elicitation/create",params:{sessionId,mode:"form",message:"Choose a size",requestedSchema:{type:"object",properties:prompt === "unsupported-question" ? {count:{type:"integer"}} : {size:{type:"string",title:"Size",oneOf:[{const:"Small",title:"Small"},{const:"Other",title:"Other"}]},note:{type:"string",title:"Custom size",maxLength:100}},required:["size"]}}});
 }
 if (scenario === "steer-new-prior-idle" && prompt === "first") {
   threadStatus("active"); text("first turn finished"); threadStatus("idle");
   return reply(id,{stopReason:"end_turn"});
 }
 if ((scenario === "steer-new-current-idle" || scenario === "steer-new-repeated-reserved") && prompt === "hold") {
   pending = id; threadStatus("active"); threadStatus("idle"); text("current turn idle before steering"); return;
 }
 if (prompt === "hold") { pending = id; if (scenario.startsWith("steer") && scenario !== "steer-new-prior-idle") threadStatus("active"); text(scenario === "steer-new-prior-idle" ? "second turn awaiting active" : "started"); return; }
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

async function host(
  overrides: Partial<AssistantServiceOptions> = {},
  observe?: (event: AssistantEvent) => void,
) {
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
      observe?.(event)
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
    signal: (name: string) => writeFile(join(directory, name), ""),
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

async function steeringHost(scenario = "steer", options: Partial<AssistantServiceOptions> = {}) {
  const context = await host(options)
  const session = ready(await context.connect(scenario))
  const active = context.service.handle({
    operation: "prompt",
    input: { ...scope(session), text: "hold" },
  })
  await context.waitFor((event) => event.type === "text" && event.text === "started")
  return {
    ...context,
    session,
    active,
    steer: (requestId = "queue-item") =>
      context.service.handle({
        operation: "steer",
        input: { ...scope(session), requestId, text: "Queued direction" },
      }),
  }
}

describe("native active-turn steering", () => {
  it.each(["steer-foreign", "steer-future"])(
    "does not advertise an unverified provider completion contract: %s",
    async (scenario) => {
      const context = await steeringHost(scenario)
      expect(context.session.canSteer).not.toBe(true)
      expect(await context.steer()).toEqual({ ok: false, code: "unsupported" })
      expect(
        context.events.some((event) => event.type === "text" && event.text.includes("steerCalls")),
      ).toBe(false)
      await context.service.handle({ operation: "cancel", input: scope(context.session) })
      await context.active
    },
  )

  it("requires provider support and an active scoped turn before dispatch", async () => {
    const context = await host()
    const unsupported = ready(await context.connect())
    const input = { ...scope(unsupported), requestId: "queued", text: "Direction" }
    expect(await context.service.handle({ operation: "steer", input })).toEqual({
      ok: false,
      code: "unsupported",
    })
    const supported = ready(await context.connect("steer"))
    expect(supported.canSteer).toBe(true)
    expect(
      await context.service.handle({
        operation: "steer",
        input: { ...input, ...scope(supported) },
      }),
    ).toEqual({
      ok: false,
      code: "agent-busy",
    })
    expect(await context.service.handle({ operation: "steer", input })).toEqual({
      ok: false,
      code: "stale-session",
    })
    expect(context.events.some((event) => event.type === "text")).toBe(false)
  })

  it("preserves the complete prompt and deduplicates accepted queue IDs without accepting changed payloads", async () => {
    const context = await steeringHost()
    const attachment = {
      id: "file",
      name: "plan.txt",
      type: "text",
      mimeType: "text/plain",
      text: "Exact\nfile bytes ",
    } as const
    const image = {
      id: "view",
      name: "view.png",
      type: "image",
      mimeType: "image/png",
      data: "aGVsbG8=",
    } as const
    const request = {
      operation: "steer",
      input: {
        ...scope(context.session),
        requestId: "queued",
        text: "  Exact\ndirection  ",
        attachments: [attachment, image],
      },
    } as const
    const first = context.service.handle(request)
    const second = context.service.handle(request)
    expect(await first).toMatchObject({
      ok: true,
      steerOutcome: "injected",
      value: { status: "prompting" },
    })
    expect(await second).toEqual(await first)
    expect(await context.service.handle(request)).toEqual(await first)
    expect(
      await context.service.handle({ ...request, input: { ...request.input, text: "Changed" } }),
    ).toEqual({ ok: false, code: "invalid-request" })
    const calls = context.events.filter(
      (event) => event.type === "text" && event.text.includes("steerCalls"),
    )
    expect(calls).toHaveLength(1)
    const call = calls[0]
    if (call?.type !== "text") throw new Error("Missing steering request.")
    const payload = JSON.parse(call.text)
    expect(payload.steerCalls).toBe(1)
    expect(payload.prompt).toContainEqual({ type: "text", text: request.input.text })
    expect(payload.prompt).toContainEqual(
      expect.objectContaining({
        type: "resource",
        resource: expect.objectContaining({ text: attachment.text }),
      }),
    )
    expect(payload.prompt).toContainEqual({
      type: "image",
      mimeType: image.mimeType,
      data: image.data,
    })
    await context.service.handle({ operation: "cancel", input: scope(context.session) })
    await context.active
  })

  it.each(["steer-failed", "steer-malformed"])(
    "retains retry eligibility after an unaccepted response: %s",
    async (scenario) => {
      const context = await steeringHost(scenario)
      const code = scenario === "steer-failed" ? "request-failed" : "protocol-error"
      expect(await context.steer()).toEqual({ ok: false, code })
      expect(await context.steer()).toEqual({ ok: false, code })
      expect(
        context.events.filter(
          (event) => event.type === "text" && event.text.includes("steerCalls"),
        ),
      ).toHaveLength(2)
      await context.service.handle({ operation: "cancel", input: scope(context.session) })
      await context.active
    },
  )

  it("keeps a provider-started turn active and streaming until its authoritative terminal event", async () => {
    const context = await steeringHost("steer-new")
    const accepted = await context.steer()
    expect(accepted).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    expect(await context.active).toMatchObject({ ok: true, value: { status: "prompting" } })
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(context.session), text: "Must stay queued" },
      }),
    ).toEqual({ ok: false, code: "agent-busy" })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "fallback after acknowledgement",
    )
    await context.waitFor(
      (event) =>
        event.type === "snapshot" &&
        event.snapshot.status === "ready" &&
        context.events.filter((value) => value.type === "completed").length === 2,
    )
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text === "fallback before acknowledgement",
      ),
    ).toBe(true)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(context.session), text: "Next turn" },
      }),
    ).toMatchObject({ ok: true })
  })

  it("ignores a previous prompt's idle status when steering precedes the next prompt's active notification", async () => {
    const context = await host(),
      session = ready(await context.connect("steer-new-prior-idle"))
    const input = scope(session)
    expect(
      await context.service.handle({ operation: "prompt", input: { ...input, text: "first" } }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    const active = context.service.handle({
      operation: "prompt",
      input: { ...input, text: "hold" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "second turn awaiting active",
    )
    const steeringAt = context.events.length
    const steering = context.service.handle({
      operation: "steer",
      input: { ...input, requestId: "second-prompt-steer", text: "Fallback direction" },
    })
    await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
    await context.signal("current-turn")
    await active
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
    await context.signal("steer-ack")
    expect(await steering).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
    const concurrent = () =>
      context.service.handle({ operation: "prompt", input: { ...input, text: "Must wait" } })
    expect(await concurrent()).toEqual({ ok: false, code: "agent-busy" })
    await context.signal("fallback-start")
    await context.waitFor(
      (event) => event.type === "text" && event.text === "actual fallback output",
    )
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
    expect(
      context.events
        .slice(steeringAt)
        .some((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
    ).toBe(false)
    expect(await concurrent()).toEqual({ ok: false, code: "agent-busy" })
    const endingAt = context.events.length
    await context.signal("fallback-end")
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= endingAt &&
        event.type === "snapshot" &&
        event.snapshot.status === "ready" &&
        context.events.filter((value) => value.type === "completed").length === 3,
    )
    expect(context.events.filter((event) => event.type === "completed")).toEqual([
      expect.objectContaining({ stopReason: "end_turn" }),
      expect.objectContaining({ stopReason: "end_turn" }),
      expect.objectContaining({ stopReason: "end_turn" }),
    ])
    expect(
      context.events.some(
        (event) => event.type === "text" && event.text === "actual fallback finished",
      ),
    ).toBe(true)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...input, text: "Next prompt" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
  })

  it.each(["before", "after"] as const)(
    "recognizes current-prompt idle before dispatch when the fallback completes %s acknowledgement",
    async (completion) => {
      const context = await host(),
        session = ready(await context.connect("steer-new-current-idle"))
      const input = scope(session)
      const active = context.service.handle({
        operation: "prompt",
        input: { ...input, text: "hold" },
      })
      await context.waitFor(
        (event) => event.type === "text" && event.text === "current turn idle before steering",
      )
      const steering = context.service.handle({
        operation: "steer",
        input: { ...input, requestId: "current-idle-steer", text: "Fallback direction" },
      })
      await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
      await active
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
      if (completion === "after") {
        await context.signal("current-idle-ack")
        expect(await steering).toMatchObject({
          ok: true,
          steerOutcome: "startedNewTurn",
          value: { status: "prompting" },
        })
      }
      await context.signal("current-idle-fallback-start")
      await context.waitFor(
        (event) => event.type === "text" && event.text === "current-idle-fallback output",
      )
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...input, text: "Must wait" },
        }),
      ).toEqual({ ok: false, code: "agent-busy" })
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
      const endingAt = context.events.length
      await context.signal("current-idle-fallback-end")
      if (completion === "before") {
        await context.waitFor(
          (event) => event.type === "text" && event.text === "current-idle-fallback finished",
        )
        expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
        await context.signal("current-idle-ack")
        expect(await steering).toMatchObject({
          ok: true,
          steerOutcome: "startedNewTurn",
          value: { status: "ready" },
        })
      }
      await context.waitFor(
        (event) =>
          context.events.indexOf(event) >= endingAt &&
          event.type === "snapshot" &&
          event.snapshot.status === "ready" &&
          context.events.filter((value) => value.type === "completed").length === 2,
      )
      expect(context.events.filter((event) => event.type === "completed")).toEqual([
        expect.objectContaining({ stopReason: "end_turn" }),
        expect.objectContaining({ stopReason: "end_turn" }),
      ])
      expect(context.events.some((event) => event.type === "error")).toBe(false)
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...input, text: "Next prompt" },
        }),
      ).toMatchObject({ ok: true, value: { status: "ready" } })
    },
  )

  it("consumes already-present fallback signals once even when the signal files change again", async () => {
    const context = await host(),
      session = ready(await context.connect("steer-new-current-idle"))
    const input = scope(session)
    const active = context.service.handle({
      operation: "prompt",
      input: { ...input, text: "hold" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "current turn idle before steering",
    )
    await context.signal("current-idle-fallback-start")
    await context.signal("current-idle-fallback-end")
    const steering = context.service.handle({
      operation: "steer",
      input: { ...input, requestId: "preexisting-signals", text: "Fallback direction" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "current-idle-fallback finished",
    )
    await active
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
    await context.signal("current-idle-ack")
    expect(await steering).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "ready" },
    })
    await context.signal("current-idle-fallback-start")
    await context.signal("current-idle-fallback-end")
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...input, text: "Next prompt" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(3)
    for (const text of ["current-idle-fallback output", "current-idle-fallback finished"])
      expect(
        context.events.filter((event) => event.type === "text" && event.text === text),
      ).toHaveLength(1)
  })

  it("does not reuse the predecessor idle when steering an acknowledged fallback that has not become active", async () => {
    const context = await host(),
      session = ready(await context.connect("steer-new-repeated-reserved"))
    const input = scope(session)
    const active = context.service.handle({
      operation: "prompt",
      input: { ...input, text: "hold" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "current turn idle before steering",
    )
    const steer = (requestId: string) =>
      context.service.handle({
        operation: "steer",
        input: { ...input, requestId, text: "Fallback direction" },
      })
    expect(await steer("first-reserved-steer")).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    await active
    const second = steer("second-reserved-steer")
    await context.waitFor((event) => event.type === "text" && event.text.includes('"steerCalls":2'))
    const firstEndAt = context.events.length
    await context.signal("first-fallback-start")
    await context.waitFor(
      (event) => event.type === "text" && event.text === "first-fallback output",
    )
    await context.signal("first-fallback-end")
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= firstEndAt &&
        event.type === "completed" &&
        context.events.filter((value) => value.type === "completed").length === 2,
    )
    await context.signal("second-steer-ack")
    expect(await second).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
    expect(
      await context.service.handle({ operation: "prompt", input: { ...input, text: "Must wait" } }),
    ).toEqual({ ok: false, code: "agent-busy" })
    await context.signal("second-fallback-start")
    await context.waitFor(
      (event) => event.type === "text" && event.text === "second-fallback output",
    )
    const secondEndAt = context.events.length
    await context.signal("second-fallback-end")
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= secondEndAt &&
        event.type === "snapshot" &&
        event.snapshot.status === "ready" &&
        context.events.filter((value) => value.type === "completed").length === 3,
    )
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(3)
    expect(context.events.some((event) => event.type === "error")).toBe(false)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...input, text: "Next prompt" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
  })

  it("recognizes a complete fallback lifecycle before its acknowledgement without inventing another active turn", async () => {
    const context = await steeringHost("steer-new-fast")
    expect(await context.steer()).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "ready" },
    })
    await context.active
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
    expect(
      context.events.some(
        (event) =>
          event.type === "text" && event.text === "fallback completed before acknowledgement",
      ),
    ).toBe(true)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(context.session), text: "Next turn" },
      }),
    ).toMatchObject({ ok: true })
  })

  it.each(["before", "after"] as const)(
    "retains original prompt ownership when the fallback completes %s acknowledgement",
    async (completion) => {
      const context = await steeringHost("steer-new-prompt-pending")
      const at = context.events.length
      let originalSettled = false
      void context.active.then(() => {
        originalSettled = true
      })
      const steering = context.steer()
      await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
      if (completion === "after") {
        await context.signal("pending-prompt-ack")
        expect(await steering).toMatchObject({ ok: true, value: { status: "prompting" } })
      }
      await context.signal("pending-prompt-fallback-start")
      await context.waitFor(
        (event) => event.type === "text" && event.text === "pending-prompt-fallback output",
      )
      await context.signal("pending-prompt-fallback-end")
      if (completion === "before") {
        await context.waitFor(
          (event) => event.type === "text" && event.text === "pending-prompt-fallback finished",
        )
        await context.signal("pending-prompt-ack")
      }
      expect(await steering).toMatchObject({ ok: true, steerOutcome: "startedNewTurn" })
      await context.waitFor((event) => event.type === "completed")
      expect(originalSettled).toBe(false)
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
      expect(
        context.events
          .slice(at)
          .filter((event) => event.type === "snapshot")
          .every((event) => event.snapshot.status === "prompting"),
      ).toBe(true)
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(context.session), text: "Must wait for original RPC" },
        }),
      ).toEqual({ ok: false, code: "agent-busy" })
      await context.signal("original-prompt-settle")
      expect(await context.active).toMatchObject({ ok: true, value: { status: "ready" } })
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(2)
      expect(
        context.events.some(
          (event) => event.type === "text" && event.text === "original prompt RPC settling",
        ),
      ).toBe(true)
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(context.session), text: "Next prompt" },
        }),
      ).toMatchObject({ ok: true, value: { status: "ready" } })
    },
  )

  it.each(["settle", "fail"] as const)(
    "retains fallback ownership when the original prompt RPC completes with %s",
    async (outcome) => {
      const context = await steeringHost("steer-new-prompt-pending")
      const steering = context.steer()
      await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
      await context.signal("pending-prompt-ack")
      expect(await steering).toMatchObject({ ok: true, value: { status: "prompting" } })
      await context.signal("pending-prompt-fallback-start")
      await context.waitFor(
        (event) => event.type === "text" && event.text === "pending-prompt-fallback output",
      )
      const at = context.events.length
      await context.signal(`original-prompt-${outcome}`)
      expect(await context.active).toMatchObject(
        outcome === "settle"
          ? { ok: true, value: { status: "prompting" } }
          : { ok: false, code: "request-failed" },
      )
      expect(
        context.events
          .slice(at)
          .filter((event) => event.type === "snapshot")
          .every((event) => event.snapshot.status === "prompting"),
      ).toBe(true)
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(context.session), text: "Must wait for fallback" },
        }),
      ).toEqual({ ok: false, code: "agent-busy" })
      expect(
        await context.service.handle({
          operation: "setMode",
          input: { ...scope(context.session), modeId: "code" },
        }),
      ).toEqual({ ok: false, code: "agent-busy" })
      const endingAt = context.events.length
      await context.signal("pending-prompt-fallback-end")
      await context.waitFor(
        (event) =>
          context.events.indexOf(event) >= endingAt &&
          event.type === "snapshot" &&
          event.snapshot.status === "ready",
      )
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(
        outcome === "settle" ? 2 : 1,
      )
      expect(
        context.events.some(
          (event) => event.type === "text" && event.text === "pending-prompt-fallback finished",
        ),
      ).toBe(true)
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(context.session), text: "Next prompt" },
        }),
      ).toMatchObject({ ok: true, value: { status: "ready" } })
    },
  )

  it.each(["original", "fallback"] as const)(
    "retains the Stop deadline while the %s owner has not settled",
    async (remaining) => {
      const context = await steeringHost("steer-new-prompt-pending", {
        cancelTimeoutMs: 100,
        promptTimeoutMs: 10_000,
      })
      const steering = context.steer()
      await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
      await context.signal("pending-prompt-ack")
      await steering
      await context.signal("pending-prompt-fallback-start")
      await context.waitFor(
        (event) => event.type === "text" && event.text === "pending-prompt-fallback output",
      )
      const at = context.events.length
      expect(
        await context.service.handle({ operation: "cancel", input: scope(context.session) }),
      ).toMatchObject({ ok: true, value: { status: "cancelling" } })
      if (remaining === "original") {
        await context.signal("pending-prompt-fallback-end")
        await context.waitFor(
          (event) =>
            context.events.indexOf(event) >= at &&
            event.type === "completed" &&
            event.stopReason === "cancelled",
        )
      } else {
        await context.signal("original-prompt-settle")
        await context.active
      }
      expect(
        context.events
          .slice(at)
          .filter((event) => event.type === "snapshot")
          .every((event) => event.snapshot.status === "cancelling"),
      ).toBe(true)
      await context.waitFor((event) => event.type === "error" && event.code === "timeout")
      if (remaining === "original")
        expect(await context.active).toEqual({ ok: false, code: "timeout" })
      expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
      expect(context.events.slice(at).some((event) => event.type === "text")).toBe(false)
    },
  )

  it("admits a reentrant prompt on ready without the previous prompt clearing its ownership", async () => {
    let next: Promise<AssistantResult> | undefined
    let nextResult: AssistantResult | undefined
    let armed = false
    const context = await host({}, (event) => {
      if (!armed || event.type !== "snapshot" || event.snapshot.status !== "ready") return
      armed = false
      next = context.service.handle({
        operation: "prompt",
        input: { ...scope(event.snapshot), text: "hold" },
      })
      void next.then((result) => {
        nextResult = result
      })
    })
    const session = ready(await context.connect())
    armed = true
    await context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "First prompt" },
    })
    expect(next).toBeDefined()
    expect(nextResult).toBeUndefined()
    await context.waitFor((event) => event.type === "text" && event.text === "started")
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "Concurrent prompt" },
      }),
    ).toEqual({ ok: false, code: "agent-busy" })
    await context.service.handle({ operation: "cancel", input: scope(session) })
    expect(await next).toMatchObject({ ok: true, value: { status: "ready" } })
  })

  it("cancels a late provider-started turn after Stop and suppresses its subsequent output", async () => {
    const context = await steeringHost("steer-new-late")
    const at = context.events.length
    const steering = context.steer()
    await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
    await context.service.handle({ operation: "cancel", input: scope(context.session) })
    expect(await steering).toMatchObject({ ok: true, steerOutcome: "startedNewTurn" })
    await context.active
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= at &&
        event.type === "completed" &&
        event.stopReason === "cancelled",
    )
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= at &&
        event.type === "snapshot" &&
        event.snapshot.status === "ready",
    )
    expect(
      context.events
        .slice(at)
        .some((event) => event.type === "text" && event.text.startsWith("fallback")),
    ).toBe(false)
  })

  it("waits for the fallback's active-to-terminal transition when status notifications lag its acknowledgement", async () => {
    const context = await steeringHost("steer-new-status-lag")
    expect(await context.steer()).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "fallback active after acknowledgement",
    )
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
    await context.waitFor(
      (event) =>
        event.type === "completed" &&
        context.events.filter((value) => value.type === "completed").length === 2,
    )
    await context.active
  })

  it("fails a fallback missing completion metadata at its deadline instead of treating acknowledgement or timeout as success", async () => {
    const context = await steeringHost("steer-new-no-status", { promptTimeoutMs: 150 })
    expect(await context.steer()).toMatchObject({
      ok: true,
      steerOutcome: "startedNewTurn",
      value: { status: "prompting" },
    })
    await context.active
    await context.waitFor((event) => event.type === "error" && event.code === "timeout")
    expect(context.events.filter((event) => event.type === "completed")).toHaveLength(1)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(context.session), text: "No hidden restart" },
      }),
    ).toEqual({ ok: false, code: "agent-exited" })
  })

  it("does not transfer an in-flight steering acknowledgement to a replacement project session", async () => {
    const context = await steeringHost("steer-new-late")
    const steering = context.steer()
    await context.waitFor((event) => event.type === "text" && event.text.includes("steerCalls"))
    const replacement = ready(await context.connect("steer"))
    expect(await steering).toMatchObject({ ok: false })
    await context.active
    expect(replacement.sessionToken).not.toBe(context.session.sessionToken)
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(replacement), text: "New owner" },
      }),
    ).toMatchObject({
      ok: true,
      value: { sessionToken: replacement.sessionToken, status: "ready" },
    })
  })
})

describe("native ACP service", () => {
  it("keeps project MCP names available despite a disabled global name and stable across resume", async () => {
    const context = await host({
      getMcpSetup: async (projectId) => ({
        protocolVersion: 1,
        mcpServers: {
          vibeshape: {
            command: "/electron",
            args: ["/mcp.cjs", "--descriptor", `/projects/${projectId}/descriptor.json`],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      }),
    })
    async function supplied(projectId: string, resumeSessionId?: string) {
      const session = ready(await context.connect("resume", projectId, resumeSessionId))
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(session), text: "inspect-mcp" },
        }),
      ).toMatchObject({ ok: true })
      const event = await context.waitFor(
        (event) => event.sessionToken === session.sessionToken && event.type === "text",
      )
      if (event.type !== "text") throw new Error("Missing supplied MCP configuration.")
      return JSON.parse(event.text)
    }
    const firstId = "0195b5ac-b250-7a2c-8c33-000000000001"
    const secondId = "0195b5ac-b250-7a2c-8c33-000000000002"
    const first = await supplied(firstId)
    const second = await supplied(secondId)
    const resumed = await supplied(firstId, "saved-session")
    expect(first).toEqual([
      {
        name: expect.stringMatching(/^vs_[0-9a-f]{16}$/),
        command: "/electron",
        args: ["/mcp.cjs", "--descriptor", `/projects/${firstId}/descriptor.json`],
        env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
      },
    ])
    expect(second[0].name).not.toBe(first[0].name)
    expect(second[0].args[2]).toBe(`/projects/${secondId}/descriptor.json`)
    expect(resumed).toEqual(first)
  })

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
