import { isAbsolute } from "node:path"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { readMcpDescriptor } from "./mcp-descriptor"
import { createMcpRelay } from "./mcp-relay"
import { WindowsPrivateFileReadError } from "./private-files"

async function attach() {
  const [, path] = z
    .tuple([z.literal("--descriptor"), z.string().refine(isAbsolute)])
    .parse(process.argv.slice(2))
  const descriptor = await readMcpDescriptor(path)
  const remote = new StreamableHTTPClientTransport(new URL(descriptor.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` }, redirect: "error" },
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  })
  const stdio = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 256 * 1024,
  })
  const relay = createMcpRelay(remote, stdio, () => {
    process.stderr.write(
      "VibeShape MCP disconnected. Keep the desktop app open and reconnect using its Settings configuration.\n",
    )
    process.exitCode = 1
  })
  process.stdin.once("end", () => void relay.close())
  process.stdout.once("error", relay.fail)
  process.once("SIGINT", () => void relay.close())
  process.once("SIGTERM", () => void relay.close())
  await relay.start()
}

void attach().catch((error: unknown) => {
  if (error instanceof WindowsPrivateFileReadError) process.stderr.write(`${error.message}\n`)
  process.stderr.write(
    "VibeShape MCP could not attach. Open the desktop app and copy its MCP configuration from Settings.\n",
  )
  process.exitCode = 1
})
