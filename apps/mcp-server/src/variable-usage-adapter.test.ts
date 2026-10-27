import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("advertises bounded read-only saved variable usage with optional defaults and requires pairing", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "variable-usage-schema-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema)
    const tool = listed.tools.find(({ name }) => name === "model_variable_usage")
    if (!tool) throw new Error("Variable usage was not advertised.")
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    })
    expect(tool.inputSchema.required).toEqual(["revision", "variableId"])
    const validate = new AjvJsonSchemaValidator().getValidator({
      ...tool.inputSchema,
      properties: tool.inputSchema.properties ?? {},
      required: tool.inputSchema.required ?? [],
    })
    const arguments_ = { revision: 7, variableId: "0195b5ac-b220-7a2c-8c33-000000000001" }
    expect(validate(arguments_).valid).toBe(true)
    expect(validate({ ...arguments_, transitive: true, cursor: "100", limit: 100 }).valid).toBe(
      true,
    )
    for (const extra of [
      { limit: 101 },
      { cursor: "-1" },
      { transitive: "true" },
      { variableName: "root" },
      { direction: "dependents" },
    ])
      expect(validate({ ...arguments_, ...extra }).valid).toBe(false)
    expect(
      await client.callTool({ name: "model_variable_usage", arguments: arguments_ }),
    ).toMatchObject({
      isError: true,
      structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
    })
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
