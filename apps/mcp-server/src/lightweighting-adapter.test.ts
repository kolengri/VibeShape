// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { expect, it } from "vitest"
import { lightweightingOperation } from "../../../packages/automation-api/src/lightweighting.test-fixtures"
import { quickLightweightingOperation } from "../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("advertises client-valid lightweighting tools without granting unpaired mutation authority", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43130" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "lightweighting-schema-test", version: "1" })
  try {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(b), client.connect(a)])
    const tools = (await client.listTools()).tools
    for (const operation of [
      lightweightingOperation(),
      lightweightingOperation(true),
      quickLightweightingOperation(),
      quickLightweightingOperation(true),
    ]) {
      const request = operation.tool.startsWith("request_")
      const tool = tools.find((entry) => entry.name === operation.tool)
      if (!tool) throw new Error("Missing lightweighting tool.")
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(operation.arguments).valid).toBe(true)
      expect(validate({ ...operation.arguments, approved: true }).valid).toBe(false)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !request,
        destructiveHint: request,
        openWorldHint: false,
      })
      expect(
        await client.callTool({ name: operation.tool, arguments: operation.arguments }),
      ).toMatchObject({
        isError: true,
        structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
      })
    }
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
