import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

export async function createMcpTestClient(
  port: number,
  launch?: { command: string; args: string[]; cwd?: string },
  options: { recoveryDirectory?: string } = {},
) {
  const directory = options.recoveryDirectory ?? mkdtempSync(join(tmpdir(), "vibeshape-mcp-test-"))
  const cleanup = () => {
    if (!options.recoveryDirectory) rmSync(directory, { recursive: true, force: true })
  }
  const client = new Client({ name: "VibeShape integration client", version: "1.0" })
  const transport = new StdioClientTransport({
    command: launch?.command ?? "bun",
    args: [
      ...(launch?.args ?? [fileURLToPath(new URL("../src/index.ts", import.meta.url))]),
      "--port",
      String(port),
    ],
    ...(launch?.cwd ? { cwd: launch.cwd } : {}),
    stderr: "pipe",
    env: { ...getDefaultEnvironment(), VIBESHAPE_LOCAL_RECOVERY_DIRECTORY: directory },
  })
  let stderr = ""
  transport.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8192)
  })
  try {
    await client.connect(transport)
  } catch (error) {
    await transport.close()
    cleanup()
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
    close: async () => {
      try {
        await client.close()
      } finally {
        cleanup()
      }
    },
  }
}
