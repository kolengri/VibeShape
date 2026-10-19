const assert = require("node:assert/strict")
const { appendFileSync, existsSync } = require("node:fs")
const { createInterface } = require("node:readline")
const { createRequire } = require("node:module")
const { resolve } = require("node:path")

// The optional relay mode discovers local tools only; neither mode contacts a provider.
const receipt = process.argv[2]
const attachMcp = process.argv[3] === "--attach-mcp"
let mcpClient
let sessionId = `fixture-${process.pid}`
let pendingPrompt
let permissionPrompt
let permissionNumber = 0
const record = (event) => appendFileSync(receipt, `${JSON.stringify({ pid: process.pid, ...event })}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
const reply = (id, result) => send({ id, result })
const update = (value) => send({ method: "session/update", params: { sessionId, update: value } })
const text = (value) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } })

function initialize(id, params) {
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(params.clientCapabilities.fs, undefined)
  assert.equal(params.clientCapabilities.terminal, undefined)
  record({ event: "initialized" })
  reply(id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] })
}
async function startSession(id, params, method) {
  const mcp = params.mcpServers[0]
  assert.equal(mcp.name, "vibeshape")
  assert.match(mcp.command, /^\//)
  assert.equal(mcp.args[1], "--descriptor")
  assert.deepEqual(mcp.env, [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }])
  if (attachMcp) {
    const sdk = createRequire(resolve(__dirname, "../../../apps/desktop/package.json"))
    const { Client } = sdk("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = sdk("@modelcontextprotocol/sdk/client/stdio.js")
    mcpClient = new Client({ name: "native-acp-relay-fixture", version: "1" })
    const transport = new StdioClientTransport({
      command: mcp.command,
      args: mcp.args,
      env: { ...process.env, ...Object.fromEntries(mcp.env.map(({ name, value }) => [name, value])) },
      stderr: "ignore",
    })
    await mcpClient.connect(transport)
    assert.ok((await mcpClient.listTools()).tools.some(({ name }) => name === "model_info"))
    record({ event: "mcp-attached", sessionId, relayPid: transport.pid })
  }
  if (method === "session/load") sessionId = params.sessionId
  record({ event: method, sessionId })
  reply(id, method === "session/new" ? { sessionId } : {})
}
function cancel() {
  record({ event: "cancelled" })
  text("Late cancelled output must be ignored")
  if (pendingPrompt !== undefined) reply(pendingPrompt, { stopReason: "cancelled" })
  pendingPrompt = undefined
}
function requestPermission(id) {
  permissionPrompt = id
  permissionNumber += 1
  send({ id: `permission-${permissionNumber}`, method: "session/request_permission", params: {
    sessionId,
    toolCall: { toolCallId: `permission-tool-${permissionNumber}`, title: "Harmless fixture permission" },
    options: [
      { optionId: "allow-once", name: "Allow this call", kind: "allow_once" },
      { optionId: "deny-once", name: "Reject this call", kind: "reject_once" },
      { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
    ],
  } })
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
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Fixture thought" } })
  update({ sessionUpdate: "tool_call", toolCallId: "inspection", title: "Inspect fixture", status: "in_progress" })
  text("Fixture response: ")
  // The test releases completion only after observing the streamed UI state.
  const timer = setInterval(() => {
    if (!existsSync(`${receipt}.continue`)) return
    clearInterval(timer)
    update({ sessionUpdate: "tool_call_update", toolCallId: "inspection", status: "completed", content: [{ type: "content", content: { type: "text", text: "Harmless inspection complete" } }] })
    text(prompt)
    reply(id, { stopReason: "end_turn" })
  }, 20)
}
function prompt(id, params) {
  const value = params.prompt[0].text
  record({ event: "prompt", text: value, sessionId })
  if (value === "permission") return requestPermission(id)
  if (value === "hold") {
    pendingPrompt = id
    return text("Fixture waiting")
  }
  streamResponse(id, value)
}
const handlers = {
  initialize,
  "session/new": startSession,
  "session/load": startSession,
  "session/cancel": cancel,
  "session/prompt": prompt,
}
process.on("SIGTERM", () => {
  record({ event: "terminated", sessionId })
  text("Obsolete project output must be ignored")
  setTimeout(async () => {
    await mcpClient?.close()
    record({ event: "closed", sessionId })
    process.exit(0)
  }, attachMcp ? 120 : 40)
})
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params, result } = JSON.parse(line)
  if (!method) return permissionResponse(id, result)
  const handler = handlers[method]
  if (handler) handler(id, params, method)
  else send({ id, error: { code: -32601, message: "Unknown fixture method" } })
})
