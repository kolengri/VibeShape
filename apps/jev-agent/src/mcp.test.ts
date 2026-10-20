import { expect, it, spyOn } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { connectMcp } from "./mcp"

it("connects an actual stdio MCP process, restricts its catalog and forwards only explicit environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-jev-mcp-"))
  const path = join(directory, "server.ts")
  const privateName = "VIBESHAPE_JEV_TEST_PRIVATE"
  const previous = process.env[privateName]
  process.env[privateName] = "private-fixture-value"
  const callTool = spyOn(Client.prototype, "callTool")
  const source = `
import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
const server = new Server({name:"test-vibeshape",version:"1"},{capabilities:{tools:{}}});
let calls = 0;
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:["model_info","read_agent_skill","create_draft","create_project","foreign_tool"].map(name=>({name,inputSchema:{type:"object"}}))}));
server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:"text",text:"ok"}],structuredContent:{calls:++calls,privatePresent:Boolean(process.env.VIBESHAPE_JEV_TEST_PRIVATE),explicit:process.env.VIBESHAPE_JEV_TEST_FORWARD}}));
await server.connect(new StdioServerTransport());
`
  try {
    await writeFile(path, source)
    const port = await connectMcp(
      {
        name: "vs_fixture",
        command: process.execPath,
        args: [path],
        env: [{ name: "VIBESHAPE_JEV_TEST_FORWARD", value: "forwarded" }],
      },
      directory,
      async () => ({ action: "decline" }),
      120_000,
    )
    try {
      expect(port.tools.map((tool) => tool.name)).toEqual(["read_agent_skill", "create_draft"])
      const first = await port.call("model_info", {}, new AbortController().signal)
      expect(first.value).toEqual({ calls: 1, privatePresent: false, explicit: "forwarded" })
      expect(callTool).toHaveBeenLastCalledWith(
        { name: "model_info", arguments: {} },
        expect.anything(),
        expect.objectContaining({ timeout: 120_000 }),
      )
      await expect(port.call("create_project", {}, new AbortController().signal)).rejects.toThrow(
        "contract",
      )
      const second = await port.call(
        "create_draft",
        { baseRevision: 0 },
        new AbortController().signal,
      )
      expect(second.value).toEqual({ calls: 2, privatePresent: false, explicit: "forwarded" })
    } finally {
      await port.close()
    }
  } finally {
    callTool.mockRestore()
    if (previous === undefined) delete process.env[privateName]
    else process.env[privateName] = previous
    await rm(directory, { recursive: true, force: true })
  }
})
