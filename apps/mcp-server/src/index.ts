import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { LOCAL_AUTOMATION_PORT } from "@vibeshape/automation-api/local-session"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalRecoveryStore } from "./local-recovery-store"
import { createLocalMcpAdapter } from "./mcp-adapter"
import { createStaticEditor } from "./static-editor"

function portArgument(args: string[]) {
  if (args.length === 0) return LOCAL_AUTOMATION_PORT
  if (args.length !== 2 || args[0] !== "--port" || !/^\d{4,5}$/.test(args[1] ?? ""))
    throw new Error("Invalid port argument.")
  const port = Number(args[1])
  if (port < 1024 || port > 65535) throw new Error("Invalid port argument.")
  return port
}

async function start() {
  const args = process.argv.slice(2)
  const editorOnly = args[0] === "--editor"
  const port = portArgument(editorOnly ? args.slice(1) : args)
  const origin = `http://127.0.0.1:${port}`
  const resources = createExportResources()
  const broker = createBrowserBroker({
    origin,
    onRevoke: resources.clear,
    ...(editorOnly || process.platform === "win32"
      ? {}
      : { recovery: createLocalRecoveryStore(origin) }),
  })
  const fetch = await createStaticEditor({
    directory: fileURLToPath(new URL("../../web/dist", import.meta.url)),
    origin,
    ...(editorOnly ? {} : { api: broker.handle }),
  })
  const mcp = createLocalMcpAdapter(broker, resources)
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: 8 * 1024 * 1024 + 65_536,
    fetch,
  })
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    broker.dispose()
    resources.clear()
    http.stop(true)
    void mcp.close()
  }
  mcp.onclose = close
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
  process.stdout.once("error", close)
  if (editorOnly) {
    process.stderr.write(
      `VibeShape editor: ${origin}\nKeep this terminal open. Press Control-C to stop.\nFor agent tools, stop this editor and start VibeShape from your MCP client.\n`,
    )
    return
  }
  // The SDK stdio transport does not observe EOF itself.
  process.stdin.once("end", close)
  try {
    await mcp.connect(
      new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 256 * 1024 }),
    )
    process.stderr.write(
      `VibeShape local editor: ${origin}\nOpen a project, then enable its AI session.\n`,
    )
  } catch {
    close()
    throw new Error("The MCP transport could not start.")
  }
}

try {
  await start()
} catch {
  process.stderr.write(
    "VibeShape could not start. Check the installed build and command arguments. If the selected local port is busy, stop its owning client yourself; VibeShape never takes over a running session.\n",
  )
  process.exitCode = 1
}
