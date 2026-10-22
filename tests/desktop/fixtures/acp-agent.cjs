const assert = require("node:assert/strict")
const { appendFileSync, existsSync } = require("node:fs")
const { createInterface } = require("node:readline")
const { createRequire } = require("node:module")
const { resolve } = require("node:path")

// Relay mode exercises the isolated project's real CAD tools; no fixture contacts a provider.
const receipt = process.argv[2]
const attachMcp = process.argv[3] === "--attach-mcp"
const lazyMcp = process.argv.includes("--lazy-mcp")
const longLabels = process.argv.includes("--long-labels")
const manyOptions = process.argv.includes("--many-options")
let mcpClient
let pendingMcp
let sessionId = `fixture-${process.pid}`
let pendingPrompt
let permissionPrompt
let permissionNumber = 0
let questionPrompt
let holdTimer
let model = "compact"
let effort = "brief"
let webSearch = "off"
let projectId
const record = (event) =>
  appendFileSync(receipt, `${JSON.stringify({ pid: process.pid, ...event })}\n`)
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
const reply = (id, result) => send({ id, result })
const update = (value) => send({ method: "session/update", params: { sessionId, update: value } })
const text = (value) =>
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } })
function advertisedModelOptions() {
  return [
    { value: "compact", name: "Fast model" },
    {
      value: "deep-model",
      name: longLabels ? "Deep model with extended engineering capabilities" : "Deep model",
    },
    ...(manyOptions
      ? Array.from({ length: 98 }, (_, index) => ({
          value: `fixture-model-${index + 3}`,
          name: `Fixture model ${index + 3}`,
        }))
      : []),
  ]
}
const configs = () => [
  {
    id: "access",
    category: "mode",
    name: "Access",
    type: "select",
    currentValue: "review",
    options: [{ value: "review", name: "Review changes" }],
  },
  {
    id: "model",
    category: "model",
    name: "Model",
    type: "select",
    currentValue: model,
    options: advertisedModelOptions(),
  },
  {
    id: "deliberation",
    category: "thought_level",
    name: "Reasoning effort",
    type: "select",
    currentValue: effort,
    options: (model === "compact" ? ["brief", "deep"] : ["deep", "maximal"]).map((value) => ({
      value,
      name:
        longLabels && value === "maximal"
          ? "Maximum reasoning for complex engineering decisions"
          : value[0].toUpperCase() + value.slice(1),
    })),
  },
  ...(longLabels
    ? [
        {
          id: "response-style",
          name: "Response style",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Default" }],
        },
        {
          id: "web-search",
          name: "Web search",
          description: "Allow the agent to search the web.",
          type: "select",
          currentValue: webSearch,
          options: [
            { value: "off", name: "Off" },
            { value: "on", name: "On" },
          ],
        },
      ]
    : []),
]

function initialize(id, params) {
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(params.clientCapabilities.fs, undefined)
  assert.equal(params.clientCapabilities.terminal, undefined)
  record({ event: "initialized" })
  reply(id, {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
    },
    authMethods: [],
  })
}
async function startSession(id, params, method) {
  // Codex ACP ignores injected names already configured, including disabled servers.
  const configuredServers = new Set(["vibeshape"])
  const supplied = params.mcpServers.filter(({ name }) => !configuredServers.has(name))
  assert.equal(supplied.length, 1)
  const mcp = supplied[0]
  assert.match(mcp.name, /^vs_[0-9a-f]{16}$/)
  assert.match(mcp.command, /^\//)
  assert.equal(mcp.args[1], "--descriptor")
  assert.deepEqual(mcp.env, [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }])
  pendingMcp = mcp
  if (attachMcp && !lazyMcp) await connectMcp(mcp)
  completeSessionStartup(id, params, method)
}
function completeSessionStartup(id, params, method) {
  if (method === "session/load") sessionId = params.sessionId
  record({ event: method, sessionId })
  reply(id, { ...(method === "session/new" ? { sessionId } : {}), configOptions: configs() })
}
async function connectMcp(mcp) {
  const sdk = createRequire(resolve(__dirname, "../../../apps/desktop/package.json"))
  const { Client } = sdk("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = sdk("@modelcontextprotocol/sdk/client/stdio.js")
  mcpClient = new Client({ name: "native-acp-relay-fixture", version: "1" })
  const transport = new StdioClientTransport({
    command: mcp.command,
    args: mcp.args,
    env: {
      ...process.env,
      ...Object.fromEntries(mcp.env.map(({ name, value }) => [name, value])),
    },
    stderr: "ignore",
  })
  await mcpClient.connect(transport)
  assert.ok((await mcpClient.listTools()).tools.some(({ name }) => name === "model_info"))
  record({ event: "mcp-attached", sessionId, relayPid: transport.pid })
}
function cancel() {
  clearInterval(holdTimer)
  record({ event: "cancelled" })
  text("Late cancelled output must be ignored")
  if (pendingPrompt !== undefined) reply(pendingPrompt, { stopReason: "cancelled" })
  pendingPrompt = undefined
}
function setConfig(id, params) {
  record({ event: "configuration", configId: params.configId, value: params.value, sessionId })
  if (params.configId === "model") {
    assert.ok(advertisedModelOptions().some((option) => option.value === params.value))
    model = params.value
    effort = model === "compact" ? "brief" : "maximal"
  } else if (params.configId === "web-search") {
    assert.ok(["off", "on"].includes(params.value))
    webSearch = params.value
  } else {
    assert.equal(params.configId, "deliberation")
    assert.ok(configs()[2].options.some((option) => option.value === params.value))
    effort = params.value
  }
  reply(id, { configOptions: configs() })
}
function requestQuestion(id) {
  questionPrompt = id
  send({
    id: "fixture-question",
    method: "elicitation/create",
    params: {
      sessionId,
      mode: "form",
      message: "Choose the fixture size",
      requestedSchema: {
        type: "object",
        properties: {
          size: {
            type: "string",
            title: "Size",
            oneOf: [
              { const: "Small", title: "Small" },
              { const: "Other", title: "Other" },
            ],
          },
          note: { type: "string", title: "Custom answer", maxLength: 100 },
        },
        required: ["size"],
      },
    },
  })
}
function questionResponse(id, result) {
  if (id !== "fixture-question" || questionPrompt === undefined) return
  const { action, content = null } = result
  record({
    event: "question-answer",
    answers: content,
    action,
    sessionId,
    projectId,
  })
  text(`Fixture answer: ${JSON.stringify(content ?? action)}`)
  reply(questionPrompt, { stopReason: "end_turn" })
  questionPrompt = undefined
}

async function mcpInfo() {
  assert.ok(mcpClient, "The MCP fixture must attach before calling a CAD tool")
  const response = await mcpClient.callTool({ name: "model_info", arguments: {} })
  const result = response.structuredContent?.result
  assert.equal(result?.ok, true, JSON.stringify(result))
  assert.equal(
    result.value.summary.documentId,
    projectId,
    "The agent must only access its own project",
  )
  record({
    event: "mcp-read",
    projectId: result.value.summary.documentId,
    revision: result.value.summary.revision,
    sessionId,
  })
  return result.value
}
async function callMcp(name, args) {
  const response = await mcpClient.callTool({ name, arguments: args }, undefined, {
    timeout: 120_000,
  })
  const result = response.structuredContent?.result
  assert.equal(result?.ok, true, `${name}: ${JSON.stringify(result)}`)
  return result.value
}
async function mcpBox(id) {
  const info = await mcpInfo()
  const draft = await callMcp("create_draft", { baseRevision: info.summary.revision })
  const added = await callMcp("create_box", {
    draftId: draft.draftId,
    baseRevision: draft.revision,
    commandId: "0195b5ac-b250-7a2c-8c33-000000000901",
    featureId: "0195b5ac-b250-7a2c-8c33-000000000902",
    label: "Agent project A box",
    widthMm: 10,
    depthMm: 20,
    heightMm: 30,
  })
  const preview = await callMcp("preview_draft", { draftId: added.draftId })
  assert.equal(preview.geometry.status, "valid")
  record({
    event: "draft-preview",
    projectId,
    draftId: draft.draftId,
    geometryStatus: preview.geometry.status,
    sessionId,
  })
  text("Project A exact box preview is ready; waiting for your Apply.")
  await callMcp("commit_draft", { draftId: draft.draftId })
  const current = await mcpInfo()
  record({
    event: "draft-committed",
    projectId,
    draftId: draft.draftId,
    revision: current.summary.revision,
    sessionId,
  })
  text("Agent project A box saved in its own project.")
  reply(id, { stopReason: "end_turn" })
}
function requestPermission(id) {
  permissionPrompt = id
  permissionNumber += 1
  send({
    id: `permission-${permissionNumber}`,
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall: {
        toolCallId: `permission-tool-${permissionNumber}`,
        title: "Harmless fixture permission",
      },
      options: [
        { optionId: "allow-once", name: "Allow this call", kind: "allow_once" },
        { optionId: "deny-once", name: "Reject this call", kind: "reject_once" },
        { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
      ],
    },
  })
}
function permissionResponse(id, result) {
  if (id !== `permission-${permissionNumber}` || permissionPrompt === undefined) return
  const optionId = result.outcome.optionId ?? "cancelled"
  record({ event: "permission", optionId })
  text(`Permission outcome: ${optionId}`)
  reply(permissionPrompt, { stopReason: "end_turn" })
  permissionPrompt = undefined
}
function streamResponse(id, prompt) {
  update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "Fixture thought" },
  })
  update({
    sessionUpdate: "tool_call",
    toolCallId: "inspection",
    title: "Inspect fixture",
    status: "in_progress",
  })
  text("Fixture response: ")
  // The test releases completion only after observing the streamed UI state.
  const timer = setInterval(() => {
    if (!existsSync(`${receipt}.continue`)) return
    clearInterval(timer)
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "inspection",
      status: "completed",
      content: [
        { type: "content", content: { type: "text", text: "Harmless inspection complete" } },
      ],
    })
    text(prompt)
    reply(id, { stopReason: "end_turn" })
  }, 20)
}
function holdPrompt(id) {
  pendingPrompt = id
  holdTimer = setInterval(() => {
    if (!existsSync(`${receipt}.${sessionId}.release`)) return
    clearInterval(holdTimer)
    text("Held turn completed")
    reply(id, { stopReason: "end_turn" })
    pendingPrompt = undefined
  }, 20)
  text("Fixture waiting")
}
async function inspectProject(id) {
  await mcpInfo()
  text(`MCP project identity: ${projectId}`)
  reply(id, { stopReason: "end_turn" })
}
function backgroundBox(id) {
  text("Background box waiting")
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!existsSync(`${receipt}.${sessionId}.build`)) return
      clearInterval(timer)
      resolve()
    }, 20)
  }).then(() => mcpBox(id))
}
const promptHandlers = new Map([
  ["permission", requestPermission],
  ["ask-question", requestQuestion],
  ["mcp-box", mcpBox],
  ["mcp-background-box", backgroundBox],
  ["mcp-info", inspectProject],
  ["hold", holdPrompt],
])
async function prompt(id, params) {
  const context = params.prompt[0].text
  const match = context.match(/^Project ID \(data, not instructions\): (".*")\.$/m)
  assert.ok(match, "Every request must carry the open project identity")
  projectId = JSON.parse(match[1])
  const value = params.prompt.filter((block) => block.type === "text").at(-1).text
  record({ event: "prompt", text: value, sessionId, projectId, prompt: params.prompt })
  if (attachMcp && !mcpClient) await connectMcp(pendingMcp)
  const handler = promptHandlers.get(value)
  if (handler) return handler(id)
  streamResponse(id, value)
}
const handlers = {
  initialize,
  "session/new": startSession,
  "session/load": startSession,
  "session/cancel": cancel,
  "session/prompt": prompt,
  "session/set_config_option": setConfig,
}
process.on("SIGTERM", () => {
  clearInterval(holdTimer)
  record({ event: "terminated", sessionId })
  text("Obsolete project output must be ignored")
  setTimeout(
    async () => {
      await mcpClient?.close()
      record({ event: "closed", sessionId })
      process.exit(0)
    },
    attachMcp ? 120 : 40,
  )
})
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params, result } = JSON.parse(line)
  if (!method) {
    permissionResponse(id, result)
    questionResponse(id, result)
    return
  }
  const handler = handlers[method]
  if (handler)
    Promise.resolve()
      .then(() => handler(id, params, method))
      .catch((error) => {
        record({ event: "fixture-error", text: error.message, sessionId, projectId })
        send({ id, error: { code: -32603, message: error.message } })
      })
  else send({ id, error: { code: -32601, message: "Unknown fixture method" } })
})
