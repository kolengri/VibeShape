import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AssistantEvent,
  AssistantResult,
  AssistantSnapshot,
} from "@vibeshape/automation-api/assistant"
import {
  assistantRequestSchema,
  assistantToolTargetsSchema,
} from "@vibeshape/automation-api/assistant"
import type { AssistantQuestionHost } from "@vibeshape/mcp-server/local-host"
import { vi } from "../../../tests/unit/support/bun-test"
import { createAssistantLaunchResolver } from "./assistant-jev-runtime"
import { type AssistantServiceOptions, createAssistantService } from "./assistant-service"

const fixture = String.raw`
const readline = require("node:readline");
const scenario = process.argv[2];
let authenticated = false, pending, permissionPrompt, questionPrompt, selectedModel = "small", selectedEffort = "brief", configCalls = 0, attachedMcp, steerCalls = 0, targetTurns = 0, historyPromptCalls = 0;
let selectedBehavior = "ask", selectedDetail = "terse", settingCalls = [];
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
const reconnectFlags = () => {
 const fs = require("node:fs"), path = require("node:path").join(__dirname,"reconnect-fixture.json");
 return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path,"utf8")) : {};
};
const reconnectConfigs = () => {
 const flags = reconnectFlags(), entry = (id,name,category,currentValue,values) => ({id,name,category,type:"select",currentValue,options:values.map(value=>({value,name:value}))});
 return [
  entry("engine","Engine","model",selectedModel,flags.noLarge ? ["small"] : ["small","large"]),
  ...(flags.legacyMode || (flags.removeModeOnDetail && selectedDetail === "full") ? [] : [entry("behavior","Behavior","mode",selectedBehavior,["ask","edit"])]),
  entry("depth","Depth","thought_level",selectedEffort,selectedModel === "large" ? (flags.noExtreme ? ["deep"] : ["deep","extreme"]) : ["brief","deep"]),
  ...(flags.noDetail ? [] : [entry("detail","Response detail","other",selectedDetail,["terse","full"])])
 ];
};
const reconnectSetting = (id,method,params) => {
 const flags = reconnectFlags(), settingId = params.configId ?? "legacy-mode";
 if (flags.reject === settingId) return send({id,error:{code:-32603,message:"Fixture setting rejected"}});
 if (method === "session/set_mode") selectedBehavior = params.modeId;
 else {
  const config = reconnectConfigs().find(option=>option.id === params.configId);
  if (!config?.options.some(option=>option.value === params.value)) return send({id,error:{code:-32602,message:"Fixture choice unavailable"}});
  if (params.configId === "engine") { selectedModel = params.value; selectedEffort = selectedModel === "large" ? "deep" : "brief"; }
  if (params.configId === "behavior") selectedBehavior = params.value;
  if (params.configId === "depth") selectedEffort = flags.normalize === "depth" ? "deep" : params.value;
  if (params.configId === "detail") { selectedDetail = params.value; if (flags.resetModeOnDetail) selectedBehavior = "ask"; }
 }
 settingCalls.push({id:params.configId ?? "legacy-mode",value:params.value ?? params.modeId});
 const result = method === "session/set_mode" ? {} : {configOptions:reconnectConfigs()};
 if (flags.notify || flags.wait === (params.configId ?? "legacy-mode")) {
  if (method === "session/set_mode") update({sessionUpdate:"current_mode_update",currentModeId:selectedBehavior});
  else update({sessionUpdate:"config_option_update",configOptions:result.configOptions});
 }
 if (flags.wait === (params.configId ?? "legacy-mode")) return afterSignal("settings-release",()=>reply(id,result));
 return reply(id,result);
};
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
   return reply(id,{protocolVersion:1,agentCapabilities:{loadSession:scenario.startsWith("resume"),promptCapabilities:{image:scenario !== "no-attachments",embeddedContext:scenario !== "no-attachments"}},authMethods:[{id:"login",name:"Log in"}],...(scenario.startsWith("steer") ? {agentInfo:{name:scenario === "steer-foreign" ? "unverified-agent" : "@agentclientprotocol/codex-acp",version:scenario === "steer-future" ? "2.2.3" : "2.2.2"},_meta:{steering:{supported:true}}} : {})});
 }
 if (method === "authenticate") { authenticated = true; return reply(id,{}); }
 if (method === "session/new" || method === "session/load") {
   if (method === "session/load") sessionId = params.sessionId;
   if (method === "session/load" && scenario === "resume-missing") return send({id,error:{code:-32603,message:"Internal error",data:{details:"no rollout found for thread id "+params.sessionId}}});
   if (method === "session/load" && scenario === "resume-other-missing") return send({id,error:{code:-32603,message:"Internal error",data:{details:"no rollout found for thread id another-session"}}});
   if (method === "session/load" && scenario === "resume-load-fail") return send({id,error:{code:-32603,message:"Internal error",data:{details:"private storage failure"}}});
   if (method === "session/load" && scenario === "resume-large") {
     for (let index = 0; index < 3; index++) update({sessionUpdate:"user_message_chunk",content:{type:"text",text:"h".repeat(3*1024*1024)}});
   }
   if (method === "session/load" && scenario === "resume-oversized") return process.stdout.write(Buffer.alloc(32*1024*1024+1,120));
   if (scenario === "auth" && !authenticated) return send({id,error:{code:-32000,message:"private auth URL"}});
   // Match adapters that filter every configured name, including disabled global entries.
   const configuredLayers = [{mcp_servers:{vibeshape:{enabled:false}}}];
   const names = new Set(configuredLayers.flatMap(layer=>Object.keys(layer.mcp_servers)));
   attachedMcp = params.mcpServers.filter(server=>!names.has(server.name));
   const mcp = attachedMcp[0];
   if (params.mcpServers.length !== 1 || attachedMcp.length !== 1 || !/^vs_[0-9a-f]{16}$/.test(mcp.name) || mcp.command !== "/electron" || mcp.args[1] !== "--descriptor" || mcp.env[0].name !== "ELECTRON_RUN_AS_NODE") return process.exit(10);
   const settings = scenario.startsWith("reconnect") ? {modes:options.modes,configOptions:reconnectConfigs()} : options;
   return reply(id,method === "session/new" ? {sessionId,...settings} : settings);
 }
 if (scenario.startsWith("reconnect") && (method === "session/set_mode" || method === "session/set_config_option")) return reconnectSetting(id,method,params);
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
 if (scenario === "resume-large" && (prompt !== "Continue after loading" || historyPromptCalls++ !== 0)) return process.exit(16);
 if (scenario.startsWith("reconnect") && prompt === "inspect-settings") { text(JSON.stringify({settingCalls,selectedBehavior,configs:reconnectConfigs()})); return reply(id,{stopReason:"end_turn"}); }
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
 if (prompt === "oversized") return text("x".repeat(2*1024*1024));
 if (prompt === "permission" || prompt === "permission-always") {
   permissionPrompt = id;
   return send({id:"permission",method:"session/request_permission",params:{sessionId,toolCall:{toolCallId:"tool",title:"Run tool"},options:[{optionId:"yes",name:"Allow",kind:prompt === "permission-always" ? "allow_always" : "allow_once"},{optionId:"no",name:"Reject",kind:"reject_once"}]}});
 }
 if (scenario === "failure-details") {
   update({sessionUpdate:"tool_call",toolCallId:"preview",title:"Preview draft",status:"in_progress"});
   update({sessionUpdate:"tool_call_update",toolCallId:"preview",status:"completed",rawOutput:{isError:true,structuredContent:{result:{ok:false,diagnostic:{code:"preview-failed",message:"The preview contains an open shell.",retryable:false}}}}});
   update({sessionUpdate:"tool_call_update",toolCallId:"preview",status:"completed"});
   return reply(id,{stopReason:"end_turn"});
 }
 if (scenario === "targets") {
   const featureId = "0195b5ac-b250-7a2c-8c33-000000000102";
   const rawInput = {draftId:featureId,commandId:featureId,baseRevision:0,featureId,widthMm:1,depthMm:2,heightMm:3};
   update({sessionUpdate:"tool_call",toolCallId:"tool",title:"create_box",status:"in_progress",...(targetTurns++ === 0 ? {name:"mcp__vs_fixture__create_box"} : {}),rawInput});
   update({sessionUpdate:"tool_call_update",toolCallId:"tool",name:null,status:"completed"});
   return reply(id,{stopReason:"end_turn"});
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
  const serviceOptions: AssistantServiceOptions = {
    cwd: directory,
    preferencesPath: join(directory, "session-preferences.json"),
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
    ...overrides,
  }
  let service = createAssistantService(serviceOptions)
  cleanups.push(() => service.close())
  return {
    get service() {
      return service
    },
    script,
    events,
    preferencesPath: join(directory, "session-preferences.json"),
    async restart() {
      await service.close()
      service = createAssistantService(serviceOptions)
    },
    signal: (name: string) => writeFile(join(directory, name), ""),
    settingsFixture: (flags: Record<string, unknown>) =>
      writeFile(join(directory, "reconnect-fixture.json"), JSON.stringify(flags)),
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

type SettingsHost = Awaited<ReturnType<typeof host>>
async function chooseSessionSettings(context: SettingsHost, session: AssistantSnapshot) {
  ready(
    await context.service.handle({
      operation: "setModel",
      input: { ...scope(session), modelId: "large" },
    }),
  )
  ready(
    await context.service.handle({
      operation: "setMode",
      input: { ...scope(session), modeId: "edit" },
    }),
  )
  ready(
    await context.service.handle({
      operation: "setConfigOption",
      input: { ...scope(session), configId: "depth", value: "extreme" },
    }),
  )
  return ready(
    await context.service.handle({
      operation: "setConfigOption",
      input: { ...scope(session), configId: "detail", value: "full" },
    }),
  )
}
function sessionValues(snapshot: AssistantSnapshot) {
  return Object.fromEntries(
    snapshot.configOptions.map(({ id, currentValue }) => [id, currentValue]),
  )
}
async function crashSession(context: SettingsHost, session: AssistantSnapshot) {
  expect(
    await context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "crash" },
    }),
  ).toMatchObject({ ok: false })
}
async function inspectSessionSettings(context: SettingsHost, session: AssistantSnapshot) {
  ready(
    await context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "inspect-settings" },
    }),
  )
  const event = await context.waitFor(
    (event) =>
      event.type === "text" &&
      event.sessionToken === session.sessionToken &&
      event.text.startsWith('{"settingCalls"'),
  )
  if (event.type !== "text") throw new Error("Missing fixture settings")
  return JSON.parse(event.text)
}

describe("native accepted settings reconnect", () => {
  const selected = { engine: "large", behavior: "edit", depth: "extreme", detail: "full" }

  it("automatically restores accepted settings after a crash before publishing ready", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await crashSession(context, session)
    const start = context.events.length
    const restored = ready(await context.connect("reconnect"))
    expect(sessionValues(restored)).toEqual(selected)
    const published = context.events
      .slice(start)
      .filter((event) => event.type === "snapshot" && event.snapshot.status === "ready")
    expect(published).toHaveLength(1)
    expect(published[0]?.type === "snapshot" ? sessionValues(published[0].snapshot) : null).toEqual(
      selected,
    )
    expect((await inspectSessionSettings(context, restored)).settingCalls).toEqual([
      { id: "engine", value: "large" },
      { id: "behavior", value: "edit" },
      { id: "depth", value: "extreme" },
      { id: "detail", value: "full" },
    ])
  })

  it("restores legacy agent modes after explicit disconnect without capturing provider defaults", async () => {
    const context = await host()
    await context.settingsFixture({ legacyMode: true })
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await context.service.handle({ operation: "disconnect", input: scope(session) })
    const restored = ready(await context.connect("reconnect"))
    expect(restored.currentModeId).toBe("edit")
    expect(sessionValues(restored)).toEqual({ engine: "large", depth: "extreme", detail: "full" })
    expect((await inspectSessionSettings(context, restored)).settingCalls[1]).toEqual({
      id: "legacy-mode",
      value: "edit",
    })
    const fresh = ready(await context.connect("reconnect-other", "other-project"))
    expect((await inspectSessionSettings(context, fresh)).settingCalls).toEqual([])
  })

  it.each(["noExtreme", "noDetail", "noLarge"])(
    "fails once for %s, prunes only unsupported choices and permits the next explicit reconnect",
    async (flag) => {
      const context = await host()
      const session = ready(await context.connect("reconnect"))
      await chooseSessionSettings(context, session)
      await crashSession(context, session)
      await context.settingsFixture({ [flag]: true })
      const start = context.events.length
      expect(await context.connect("reconnect")).toEqual({
        ok: false,
        code: "settings-unavailable",
      })
      expect(
        context.events
          .slice(start)
          .some((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
      ).toBe(false)
      expect(
        context.events
          .slice(start)
          .some((event) => event.type === "error" && event.code === "settings-unavailable"),
      ).toBe(true)
      const restored = ready(await context.connect("reconnect"))
      const expected =
        flag === "noExtreme"
          ? { ...selected, depth: "deep" }
          : flag === "noDetail"
            ? { engine: "large", behavior: "edit", depth: "extreme" }
            : { engine: "small", behavior: "edit", depth: "brief", detail: "full" }
      expect(sessionValues(restored)).toEqual(expected)
    },
  )

  it.each(["reject", "normalize"])(
    "retains all accepted choices after a %s restoration failure and restores them on retry",
    async (failure) => {
      const context = await host()
      const session = ready(await context.connect("reconnect"))
      await chooseSessionSettings(context, session)
      await crashSession(context, session)
      await context.settingsFixture({ [failure]: "depth" })
      const start = context.events.length
      expect(await context.connect("reconnect")).toEqual({
        ok: false,
        code: "settings-recovery-failed",
      })
      expect(
        context.events
          .slice(start)
          .some((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
      ).toBe(false)
      await context.settingsFixture({ notify: true })
      expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
    },
  )

  it("reconciles the final catalog instead of silently claiming settings reset by a later option", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await crashSession(context, session)
    await context.settingsFixture({ resetModeOnDetail: true })
    expect(await context.connect("reconnect")).toEqual({
      ok: false,
      code: "settings-recovery-failed",
    })
    await context.settingsFixture({})
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
  })

  it("prunes a choice removed by a later catalog update and permits the next reconnect", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await crashSession(context, session)
    await context.settingsFixture({ removeModeOnDetail: true })
    expect(await context.connect("reconnect")).toEqual({ ok: false, code: "settings-unavailable" })
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual({
      engine: "large",
      depth: "extreme",
      detail: "full",
    })
  })

  it("shares accepted runtime choices across projects while isolating exact agent configurations", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    const project = ready(await context.connect("reconnect", "other-project"))
    expect(sessionValues(project)).toEqual(selected)
    expect(project.projectId).toBe("other-project")
    expect(project.sessionToken).not.toBe(session.sessionToken)
    expect(
      await context.service.handle({
        operation: "setMode",
        input: { projectId: project.projectId, sessionToken: session.sessionToken, modeId: "ask" },
      }),
    ).toEqual({ ok: false, code: "stale-session" })
    const provider = ready(await context.connect("reconnect-other"))
    expect(sessionValues(provider)).toEqual({
      engine: "small",
      behavior: "ask",
      depth: "brief",
      detail: "terse",
    })
    ready(
      await context.service.handle({
        operation: "setConfigOption",
        input: { ...scope(provider), configId: "depth", value: "deep" },
      }),
    )
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
    expect(sessionValues(ready(await context.connect("reconnect-other")))).toEqual({
      engine: "small",
      behavior: "ask",
      depth: "deep",
      detail: "terse",
    })
  })

  it("restores only accepted nonsecret runtime choices after host recreation in another project", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    const saved = JSON.parse(await readFile(context.preferencesPath, "utf8"))
    expect(saved.schemaVersion).toBe(1)
    expect(saved.scopes).toHaveLength(1)
    expect(Object.keys(saved.scopes[0])).toEqual(["key", "choices"])
    expect(saved.scopes[0].choices).toEqual([
      { kind: "config", id: "engine", category: "model", value: "large" },
      { kind: "config", id: "behavior", category: "mode", value: "edit" },
      { kind: "config", id: "depth", category: "thought_level", value: "extreme" },
      { kind: "config", id: "detail", category: "other", value: "full" },
    ])
    await context.restart()
    const start = context.events.length
    const restored = ready(await context.connect("reconnect", "other-project"))
    expect(sessionValues(restored)).toEqual(selected)
    expect(restored.projectId).toBe("other-project")
    expect(
      context.events
        .slice(start)
        .filter((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
    ).toHaveLength(1)
  })

  it("keeps applied runtime choices when profile writes fail and retries persistence", async () => {
    const context = await host()
    await mkdir(context.preferencesPath, { mode: 0o700 })
    const session = ready(await context.connect("reconnect"))
    expect(sessionValues(await chooseSessionSettings(context, session))).toEqual(selected)
    const project = ready(await context.connect("reconnect", "other-project"))
    expect(sessionValues(project)).toEqual(selected)

    await rm(context.preferencesPath, { recursive: true })
    const updated = ready(
      await context.service.handle({
        operation: "setConfigOption",
        input: { ...scope(project), configId: "detail", value: "terse" },
      }),
    )
    expect(sessionValues(updated)).toEqual({ ...selected, detail: "terse" })
    await context.restart()
    expect(sessionValues(ready(await context.connect("reconnect", "third-project")))).toEqual({
      ...selected,
      detail: "terse",
    })
  })

  it("rejects an unsupported persisted runtime choice before another project becomes ready", async () => {
    const context = await host()
    await chooseSessionSettings(context, ready(await context.connect("reconnect")))
    await context.restart()
    await context.settingsFixture({ noExtreme: true })
    const start = context.events.length
    expect(await context.connect("reconnect", "other-project")).toEqual({
      ok: false,
      code: "settings-unavailable",
    })
    expect(
      context.events
        .slice(start)
        .some((event) => event.type === "snapshot" && event.snapshot.status === "ready"),
    ).toBe(false)
    await context.restart()
    expect(sessionValues(ready(await context.connect("reconnect", "other-project")))).toEqual({
      ...selected,
      depth: "deep",
    })
  })

  it.each([
    { schemaVersion: 2, scopes: [] },
    { schemaVersion: 1, scopes: [], credentials: { apiKey: "must-not-restore" } },
  ])("ignores malformed or unknown persisted preferences ($schemaVersion)", async (saved) => {
    const context = await host()
    await writeFile(context.preferencesPath, JSON.stringify(saved), { mode: 0o600 })
    const session = ready(await context.connect("reconnect"))
    expect((await inspectSessionSettings(context, session)).settingCalls).toEqual([])
  })

  it("does not remember rejected user changes or stale control replies", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await context.settingsFixture({ reject: "depth" })
    expect(
      await context.service.handle({
        operation: "setConfigOption",
        input: { ...scope(session), configId: "depth", value: "deep" },
      }),
    ).toEqual({ ok: false, code: "request-failed" })
    await context.settingsFixture({ wait: "depth" })
    const start = context.events.length
    const pending = context.service.handle({
      operation: "setConfigOption",
      input: { ...scope(session), configId: "depth", value: "deep" },
    })
    await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= start &&
        event.type === "snapshot" &&
        event.snapshot.configOptions.some(
          ({ id, currentValue }) => id === "depth" && currentValue === "deep",
        ),
    )
    await context.settingsFixture({})
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
    expect(await pending).toEqual({ ok: false, code: "stale-session" })
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
  })

  it("fences obsolete recovery callbacks and rejects prompts/configuration while recovery is pending", async () => {
    const context = await host()
    const session = ready(await context.connect("reconnect"))
    await chooseSessionSettings(context, session)
    await crashSession(context, session)
    await context.settingsFixture({ wait: "engine" })
    const start = context.events.length
    const pending = context.connect("reconnect")
    const event = await context.waitFor(
      (event) =>
        context.events.indexOf(event) >= start &&
        event.type === "snapshot" &&
        event.snapshot.currentModelId === "large",
    )
    if (event.type !== "snapshot") throw new Error("Missing recovery snapshot")
    expect(event.snapshot.status).toBe("connecting")
    expect(
      await context.service.handle({
        operation: "setModel",
        input: { ...scope(event.snapshot), modelId: "small" },
      }),
    ).toEqual({ ok: false, code: "agent-busy" })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(event.snapshot), text: "Must not replay" },
      }),
    ).toEqual({ ok: false, code: "agent-busy" })
    await context.settingsFixture({})
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
    expect(await pending).toEqual({ ok: false, code: "stale-session" })
    expect(sessionValues(ready(await context.connect("reconnect")))).toEqual(selected)
  })
})

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

describe("native assistant tool metadata", () => {
  it("preserves an SDK raw preview diagnostic and failed status without failing the turn", async () => {
    const context = await host()
    const snapshot = ready(await context.connect("failure-details"))
    const result = ready(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(snapshot), text: "Preview" },
      }),
    )
    const tools = context.events.filter((event) => event.type === "tool")
    expect(tools.map(({ status }) => status)).toEqual(["in_progress", "failed", "failed"])
    expect(tools[0]?.text).toBeUndefined()
    expect(tools[1]?.text).toContain("The preview contains an open shell.")
    expect(tools[2]?.text).toBeUndefined()
    expect(tools.every((event) => !("rawOutput" in event))).toBe(true)
    expect(result.status).toBe("ready")
    expect(
      context.events.some((event) => event.type === "completed" && event.stopReason === "end_turn"),
    ).toBe(true)
  })
  it("captures SDK names and raw inputs at the producer and resets metadata between turns", async () => {
    const context = await host()
    const projectId = "0195b5ac-b250-7a2c-8c33-000000000101"
    const snapshot = ready(await context.connect("targets", projectId))
    const expected = assistantToolTargetsSchema.parse({
      projectId,
      featureIds: ["0195b5ac-b250-7a2c-8c33-000000000102"],
      sketchIds: [],
    })
    await context.service.handle({
      operation: "prompt",
      input: { ...scope(snapshot), text: "Build" },
    })
    const first = context.events.filter((event) => event.type === "tool")
    expect(first).toHaveLength(2)
    for (const event of first) {
      expect(event.targets).toEqual(expected)
      expect(event).not.toHaveProperty("rawInput")
      expect(event).not.toHaveProperty("name")
    }
    await context.service.handle({
      operation: "prompt",
      input: { ...scope(snapshot), text: "Again" },
    })
    const second = context.events.filter((event) => event.type === "tool").slice(2)
    expect(second).toHaveLength(2)
    expect(
      second.every(
        (event) => !event.targets?.featureIds.length && !event.targets?.sketchIds.length,
      ),
    ).toBe(true)
  })
})

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
    const serialized = output?.type === "text" ? output.text : null
    expect(serialized).toContain("Keep every unresolved request in session context")
    expect(serialized === null ? null : JSON.parse(serialized)).toMatchObject([
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

  it("advertises Jev limits and rejects invalid image envelopes before the agent receives a prompt", async () => {
    const agent = { command: "node", args: [] as string[] }
    const context = await host({
      resolveLaunch: () => ({ ok: true, launch: { agent } }),
    })
    agent.args.push(context.script, "normal")
    const session = ready(
      await context.service.handle({
        operation: "connect",
        input: { projectId: "project-a", agent: { kind: "jev", settings: { images: true } } },
      }),
    )
    expect(session.attachmentCapabilities).toEqual({
      text: true,
      images: true,
      imageConstraints: {
        mimeTypes: ["image/png", "image/jpeg"],
        maxCount: 4,
        maxTotalBase64Bytes: 524288,
      },
    })
    const image = {
      id: "view",
      name: "view.png",
      type: "image",
      mimeType: "image/png",
      data: "AQID",
    }
    for (const attachments of [
      [{ ...image, mimeType: "image/webp" }],
      [{ ...image, mimeType: "image/gif" }],
      [{ ...image, data: Buffer.alloc(393217).toString("base64") }],
      [
        { ...image, id: "first", data: Buffer.alloc(196609).toString("base64") },
        { ...image, id: "second", data: Buffer.alloc(196609).toString("base64") },
      ],
      Array.from({ length: 5 }, (_, index) => ({ ...image, id: `view-${index}` })),
    ]) {
      expect(
        await context.service.handle({
          operation: "prompt",
          input: { ...scope(session), text: "inspect-attachments", attachments },
        }),
      ).toEqual({ ok: false, code: "unsupported" })
    }
    expect(context.events.some((event) => event.type === "text")).toBe(false)
    expect(
      context.events.some(
        (event) => event.type === "snapshot" && event.snapshot.status === "prompting",
      ),
    ).toBe(false)

    expect(
      await context.service.handle({
        operation: "prompt",
        input: {
          ...scope(session),
          text: "inspect-attachments",
          attachments: [{ ...image, data: "A".repeat(524288) }],
        },
      }),
    ).toMatchObject({ ok: true })
    const output = context.events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(JSON.parse(output)).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: "A".repeat(524288),
    })

    const generic = ready(await context.connect())
    expect(generic.attachmentCapabilities).toEqual({ text: true, images: true })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: {
          ...scope(generic),
          text: "inspect-attachments",
          attachments: [{ ...image, mimeType: "image/webp" }],
        },
      }),
    ).toMatchObject({ ok: true })
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
      reason: "answered",
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
        (event) => event.type === "question-resolved" && event.reason === "expired",
      ),
    ).toBe(true)
  })

  it("binds native question callbacks to the captured owner and retains readiness after premature completion", async () => {
    const hosts: AssistantQuestionHost[] = []
    const context = await host({
      getMcpSetup: async (_projectId, questions) => {
        hosts.push(questions)
        return {
          protocolVersion: 1,
          mcpServers: {
            vibeshape: {
              command: "/electron",
              args: ["/mcp.cjs", "--descriptor", "/descriptor.json"],
              env: { ELECTRON_RUN_AS_NODE: "1" },
            },
          },
        }
      },
    })
    const session = ready(await context.connect())
    const prompting = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "hello" },
    })
    const questionHost = hosts[0]
    if (!questionHost) throw new Error("Missing captured question host")
    const input = {
      message: "Choose",
      fields: [{ id: "size", label: "Size", required: true, secret: false as const }],
    }
    const waiting = questionHost.request(input, new AbortController().signal)
    const question = await context.waitFor((event) => event.type === "question")
    if (question.type !== "question") throw new Error("Missing question")
    expect(questionHost.canInvoke()).toBe(false)
    expect(await prompting).toMatchObject({
      ok: true,
      value: { status: "prompting", questionStatus: "pending" },
    })
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "bypass" },
      }),
    ).toMatchObject({ ok: false, code: "agent-busy" })
    expect(
      await context.service.handle({
        operation: "respondQuestion",
        input: {
          ...scope(session),
          requestId: question.question.requestId,
          answers: { size: "10 mm" },
        },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready" } })
    expect(await waiting).toEqual({ action: "accept", content: { size: "10 mm" } })
    await context.connect()
    expect(await questionHost.request(input, new AbortController().signal)).toEqual({
      action: "decline",
    })
    expect(questionHost.canInvoke()).toBe(false)
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

  it("keeps a default ACP prompt open beyond ten minutes and still acknowledges Stop", async () => {
    const context = await host()
    const session = ready(await context.connect())
    vi.useFakeTimers()
    try {
      const turn = context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "hold" },
      })
      await context.waitFor((event) => event.type === "text" && event.text === "started")
      vi.advanceTimersByTime(11 * 60_000)
      expect(context.events.some((event) => event.type === "error")).toBe(false)
      expect(
        await context.service.handle({ operation: "cancel", input: scope(session) }),
      ).toMatchObject({ ok: true, value: { status: "cancelling" } })
      expect(await turn).toMatchObject({ ok: true, value: { status: "ready" } })
      expect(context.events).toContainEqual({
        ...scope(session),
        type: "completed",
        stopReason: "cancelled",
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a default steering fallback open beyond ten minutes until its completion", async () => {
    const context = await host()
    const session = ready(await context.connect("steer-new-current-idle"))
    const active = context.service.handle({
      operation: "prompt",
      input: { ...scope(session), text: "hold" },
    })
    await context.waitFor(
      (event) => event.type === "text" && event.text === "current turn idle before steering",
    )
    vi.useFakeTimers()
    try {
      const steering = context.service.handle({
        operation: "steer",
        input: { ...scope(session), requestId: "review-continuation", text: "Continue" },
      })
      await context.signal("current-idle-ack")
      expect(await steering).toMatchObject({
        ok: true,
        steerOutcome: "startedNewTurn",
        value: { status: "prompting" },
      })
      await active
      vi.advanceTimersByTime(11 * 60_000)
      expect(context.events.some((event) => event.type === "error")).toBe(false)
      await context.signal("current-idle-fallback-start")
      await context.waitFor(
        (event) => event.type === "text" && event.text === "current-idle-fallback output",
      )
      await context.signal("current-idle-fallback-end")
      await context.waitFor(
        (event) =>
          event.type === "snapshot" &&
          event.snapshot.status === "ready" &&
          context.events.filter((value) => value.type === "completed").length === 2,
      )
      expect(context.events.some((event) => event.type === "error")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

  it.each([
    ["resume-missing", "session-unavailable"],
    ["resume-other-missing", "initialization-failed"],
    ["resume-load-fail", "initialization-failed"],
  ] as const)(
    "classifies %s without replacing a session or exposing private details",
    async (scenario, code) => {
      const context = await host()
      expect(await context.connect(scenario, "project-a", "saved-session")).toEqual({
        ok: false,
        code,
      })
      expect(context.events.filter((event) => event.type === "error")).toMatchObject([{ code }])
      expect(
        context.events.some(
          (event) => event.type === "snapshot" && event.snapshot.status === "ready",
        ),
      ).toBe(false)
      expect(JSON.stringify(context.events)).not.toContain("private storage failure")
    },
  )

  it("loads attachment-sized history without publishing it as live output or replaying it as a prompt", async () => {
    const context = await host()
    const session = ready(await context.connect("resume-large", "project-a", "saved-session"))
    expect(session).toMatchObject({
      status: "ready",
      sessionId: "saved-session",
      canResume: true,
    })
    expect(context.events.some((event) => event.type === "text" || event.type === "thought")).toBe(
      false,
    )
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "Continue after loading" },
      }),
    ).toMatchObject({ ok: true, value: { status: "ready", sessionId: "saved-session" } })
    expect(context.events.some((event) => event.type === "completed")).toBe(true)
  })

  it("rejects an unterminated history frame above the SDK's bounded 32 MiB transport limit", async () => {
    const context = await host()
    expect(await context.connect("resume-oversized", "project-a", "saved-session")).toEqual({
      ok: false,
      code: "protocol-error",
    })
    expect(context.events.some((event) => event.type === "text" || event.type === "thought")).toBe(
      false,
    )
  })

  it("returns bounded diagnostics for launch, initialization, crash, malformed and oversized live output", async () => {
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
    const previousEvents = context.events.length
    const replacement = context.connect("normal", "project-a")
    expect(captured).toBe(true)
    expect(attached).toBe(true)
    expect(
      context.events
        .slice(previousEvents)
        .filter((event) => event.sessionToken === first.sessionToken),
    ).toEqual([])
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

describe("built-in assistant launch resolution", () => {
  it("reports missing Jev configuration without exposing credentials or attempting a process", async () => {
    const resolveLaunch = createAssistantLaunchResolver({
      executable: process.execPath,
      runtimeDirectory: tmpdir(),
      env: {},
    })
    const context = await host({ resolveLaunch })
    expect(
      await context.service.handle({
        operation: "connect",
        input: { projectId: "project-a", agent: { kind: "jev", settings: {} } },
      }),
    ).toEqual({ ok: false, code: "jev-configuration-required" })
    expect(context.events).toContainEqual({
      projectId: "project-a",
      sessionToken: expect.any(String),
      type: "error",
      code: "jev-configuration-required",
    })
    expect(JSON.stringify(context.events)).not.toContain("TYPESAFE_API_KEY")
  })

  it("keeps legacy ACP and its project attachment unchanged with the built-in resolver installed", async () => {
    const resolveLaunch = createAssistantLaunchResolver({
      executable: process.execPath,
      runtimeDirectory: tmpdir(),
      env: { TYPESAFE_API_KEY: "private-host-key" },
    })
    const context = await host({ resolveLaunch })
    const session = ready(await context.connect())
    expect(session.status).toBe("ready")
    expect(
      await context.service.handle({
        operation: "prompt",
        input: { ...scope(session), text: "inspect-mcp" },
      }),
    ).toMatchObject({ ok: true })
    const text = context.events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("")
    expect(text).toContain('"name":"ELECTRON_RUN_AS_NODE","value":"1"')
    expect(text).not.toContain("private-host-key")
    expect(text).not.toContain("TYPESAFE_API_KEY")
    expect(JSON.stringify(context.events)).not.toContain("private-host-key")
  })

  it("forwards the captured project and connection credentials to the real launch resolver", async () => {
    const resolve = createAssistantLaunchResolver({
      executable: process.execPath,
      runtimeDirectory: tmpdir(),
      env: {},
    })
    const calls: {
      projectId: string
      apiKey: string | undefined
      helperKey: string | undefined
      configured: boolean
    }[] = []
    const context = await host({
      resolveLaunch(projectId, agent, credentials) {
        const resolved = resolve(projectId, agent, credentials)
        calls.push({
          projectId,
          configured: resolved.ok,
          apiKey: resolved.ok ? resolved.launch.env?.TYPESAFE_API_KEY : undefined,
          helperKey: resolved.ok ? resolved.launch.env?.JEV_ARGUMENTS_API_KEY : undefined,
        })
        // Observe the real resolver without starting a process in this wiring test.
        return { ok: false, code: "jev-configuration-required" }
      },
    })
    const agent = {
      kind: "jev",
      settings: {
        argumentsEndpoint: "https://helper.example.test/completions",
        argumentsModel: "helper",
      },
    }
    for (const input of [
      {
        projectId: "project-a",
        agent,
        jevCredentials: { apiKey: "key-a", argumentsApiKey: "helper-a" },
      },
      {
        projectId: "project-b",
        agent,
        jevCredentials: { apiKey: "key-b", argumentsApiKey: "helper-b" },
      },
      { projectId: "project-a", agent },
      { projectId: "project-b", agent },
      { projectId: "project-c", agent },
    ])
      expect(await context.service.handle({ operation: "connect", input })).toEqual({
        ok: false,
        code: "jev-configuration-required",
      })
    expect(calls).toEqual([
      { projectId: "project-a", apiKey: "key-a", helperKey: "helper-a", configured: true },
      { projectId: "project-b", apiKey: "key-b", helperKey: "helper-b", configured: true },
      { projectId: "project-a", apiKey: "key-b", helperKey: "helper-b", configured: true },
      { projectId: "project-b", apiKey: "key-b", helperKey: "helper-b", configured: true },
      { projectId: "project-c", apiKey: "key-b", helperKey: "helper-b", configured: true },
    ])
    for (const secret of ["key-a", "key-b", "helper-a", "helper-b"])
      expect(JSON.stringify(context.events)).not.toContain(secret)
  })

  it("does not let a replaced connection resolve or overwrite credentials after preparation", async () => {
    const resolve = createAssistantLaunchResolver({
      executable: process.execPath,
      runtimeDirectory: tmpdir(),
      env: {},
    })
    const calls: string[] = []
    let first = true
    let replace = () => {}
    let replacement: Promise<AssistantResult> | undefined
    const context = await host({
      getMcpSetup: async () => {
        if (first) {
          first = false
          // Replace after preparation settles but before its caller resumes initialization.
          queueMicrotask(() => queueMicrotask(replace))
        }
        return {
          protocolVersion: 1,
          mcpServers: {
            vibeshape: {
              command: "/electron",
              args: ["/mcp.cjs", "--descriptor", "/descriptor.json"],
              env: { ELECTRON_RUN_AS_NODE: "1" },
            },
          },
        }
      },
      resolveLaunch(projectId, agent, credentials) {
        calls.push(credentials?.apiKey ?? "missing")
        resolve(projectId, agent, credentials)
        return { ok: false, code: "jev-configuration-required" }
      },
    })
    const input = (apiKey: string) => ({
      projectId: "project-a",
      agent: { kind: "jev", settings: {} },
      jevCredentials: { apiKey },
    })
    replace = () => {
      replacement = context.service.handle({
        operation: "connect",
        input: input("replacement-key"),
      })
    }
    expect(
      await context.service.handle({ operation: "connect", input: input("obsolete-key") }),
    ).toEqual({ ok: false, code: "stale-session" })
    if (!replacement) throw new Error("The replacement connection did not start.")
    expect(await replacement).toEqual({ ok: false, code: "jev-configuration-required" })
    expect(calls).toEqual(["replacement-key"])
  })
})
