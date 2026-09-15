import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

export async function createMcpTestClient(port: number) {
  const client = new Client({ name: "VibeShape integration client", version: "1.0" })
  const transport = new StdioClientTransport({
    command: "bun",
    args: [fileURLToPath(new URL("../src/index.ts", import.meta.url)), "--port", String(port)],
    stderr: "pipe",
  })
  let stderr = ""
  transport.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8192)
  })
  try {
    await client.connect(transport)
  } catch (error) {
    await transport.close()
    throw new Error(`The MCP test server did not initialize: ${stderr}`, { cause: error })
  }
  return {
    client,
    origin: `http://127.0.0.1:${port}`,
    async callTool(
      params: { name: string; arguments: Record<string, unknown> },
      options?: RequestOptions,
    ) {
      return CallToolResultSchema.parse(
        await client.callTool(params, CallToolResultSchema, options),
      )
    },
    stderr: () => stderr,
    close: () => client.close(),
  }
}
