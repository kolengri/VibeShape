const { appendFileSync, fstatSync } = require("node:fs")
const { createInterface } = require("node:readline")
const { spawn } = require("node:child_process")
const [mode, receipt] = process.argv.slice(2)
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`, () => record({ sent: message.id ?? message.method, at: Date.now() }))
const record = (data) => appendFileSync(receipt, `${JSON.stringify(data)}\n`)
const text = (value, sessionId = "helper") => send({ method: "session/update", params: {
  sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } },
} })
record({ pid: process.pid, parentPid: process.ppid, args: process.argv.slice(4), cwd: process.cwd(), secret: process.env.TYPESAFE_API_KEY, helperKey: process.env.JEV_ARGUMENTS_API_KEY, electron: process.env.ELECTRON_RUN_AS_NODE, trace: process.env.VIBESHAPE_ARGUMENT_TRACE, at: Date.now(), stdio: [0, 1, 2].map((fd) => { try { const info = fstatSync(fd); return { fd, pipe: info.isFIFO(), character: info.isCharacterDevice(), file: info.isFile() } } catch { return { fd, unavailable: true } } }) })
let promptId
if (mode === "hang") process.on("SIGTERM", () => {})
const backendReady = mode.startsWith("descendant-") ? new Promise((resolve) => {
  const backend = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)'], { stdio: ["ignore", "pipe", "ignore"] })
  backend.stdout.once("data", () => { record({ backendPid: backend.pid }); resolve() })
}) : Promise.resolve()
function answer() {
  text("ignored", "foreign-session")
  if (mode === "large") { text("x".repeat(150000)); text("y".repeat(150000)) }
  else if (mode === "invalid") text("not JSON")
  else if (mode === "probe") text('{"ok":true}')
  else { text('{"plane":"XZ",'); text('"geometry":{"width":20}}') }
  send({ id: promptId, result: { stopReason: mode === "cancelled" ? "cancelled" : "end_turn" } })
}
function prompt(message) {
  promptId = message.id
  void backendReady.then(() => {
    record({ ready: true })
    if (["hang", "descendant-cancel"].includes(mode)) return
    if (mode === "descendant-exit") return process.exit(3)
    if (mode === "permission") {
      send({ id: "permission", method: "session/request_permission", params: { sessionId: "helper", toolCall: { toolCallId: "write", title: "Write a file" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }] } })
      return
    }
    answer()
  })
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  record({ ...message, at: Date.now() })
  if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  else if (message.method === "session/new") send({ id: message.id, result: { sessionId: "helper" } })
  else if (message.method === "session/prompt") prompt(message)
  else if (message.id === "permission" && message.result) {
    text('{"geometry":{}}')
    send({ id: promptId, result: { stopReason: "end_turn" } })
  }
})
