import type { McpServer } from "@agentclientprotocol/sdk"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { assistantToolResultFailed } from "@vibeshape/automation-api/assistant-tool-targets"
import type { z } from "zod"
import type { Photo } from "./contracts"
import type { ToolPort } from "./controller"
import { allowedTool, validateToolInput } from "./tool-contract"

type Elicit = (
  params: z.infer<typeof ElicitRequestSchema>["params"],
  signal: AbortSignal,
) => Promise<{
  action: "accept" | "decline" | "cancel"
  content?: Record<string, string | number | boolean | string[]> | undefined
}>
export async function connectMcp(
  server: McpServer,
  cwd: string,
  elicit: Elicit,
): Promise<ToolPort> {
  if ("type" in server)
    throw new Error("The Jev adapter currently accepts one injected stdio MCP server.")
  const client = new Client(
    { name: "vibeshape-jev", version: "0.0.0" },
    { capabilities: { elicitation: { form: {} } } },
  )
  client.setRequestHandler(ElicitRequestSchema, (request, extra) =>
    elicit(request.params, extra.signal),
  )
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
    },
    stderr: "pipe",
  })
  try {
    await client.connect(transport, { timeout: 30_000 })
    transport.stderr?.on("data", () => {})
    const tools: Tool[] = []
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 30_000 })
      if (tools.length + page.tools.length > 256)
        throw new Error("The MCP tool catalog exceeds the Jev adapter budget.")
      tools.push(...page.tools.filter((tool) => allowedTool(tool.name)))
      cursor = page.nextCursor
      if (cursor && seen.has(cursor))
        throw new Error("The MCP tool catalog returned a repeated cursor.")
      if (cursor) seen.add(cursor)
    } while (cursor)
    if (
      !tools.some((tool) => tool.name === "model_info") ||
      !tools.some((tool) => tool.name === "read_agent_skill")
    )
      throw new Error("The injected MCP server does not advertise the required VibeShape tools.")
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error("The MCP tool catalog contains duplicate names.")
    return {
      tools: tools.filter((tool) => tool.name !== "model_info"),
      async call(name, args, signal) {
        signal.throwIfAborted()
        validateToolInput(name, args)
        const result = CallToolResultSchema.parse(
          await client.callTool({ name, arguments: args }, CallToolResultSchema, {
            signal,
            timeout: 60_000,
          }),
        )
        const photos: Photo[] = []
        for (const block of result.content) {
          if (
            block.type === "image" &&
            (block.mimeType === "image/png" || block.mimeType === "image/jpeg") &&
            block.data.length <= 128 * 1024
          )
            photos.push({ mimeType: block.mimeType, data: block.data })
        }
        const value = result.structuredContent ?? {
          content: result.content.filter((block) => block.type === "text"),
        }
        if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024)
          throw new Error(
            "The MCP result exceeded the Jev observation budget. The action was not retried.",
          )
        return {
          value,
          photos: photos.slice(0, 4),
          failed: result.isError === true || assistantToolResultFailed(value),
        }
      },
      close: () => client.close(),
    }
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}
