// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { expect, it } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers client-valid body Pattern tools and keeps draft mutations behind pairing", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "body-pattern-schema-test", version: "1" })
  const id = "0195b5ac-b250-7a2c-8c33-000000000030"
  const args = {
    draftId: id,
    baseRevision: 0,
    commandId: id,
    featureId: id,
    dependencies: [id],
    references: [],
    suppressed: false,
    parameters: {
      targetBody: { schemaVersion: 0, featureId: id, outputRole: "pattern.instance.2" },
      kind: "linear",
      axis: "Y",
      count: {
        schemaVersion: 0,
        dimension: "scalar",
        value: 3,
        unit: "1",
        source: { value: 3, unit: "1", expression: "#instances" },
      },
      spacing: {
        schemaVersion: 0,
        dimension: "length",
        value: -20,
        unit: "mm",
        source: { value: -20, unit: "mm", expression: null },
      },
    },
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_body_pattern", "update_body_pattern"]) {
      const tool = listed.tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(args).valid).toBe(true)
      expect(validate({ ...args, dependencies: [] }).valid).toBe(false)
      expect(validate({ ...args, parameters: { ...args.parameters, axis: "custom" } }).valid).toBe(
        false,
      )
      expect(validate({ ...args, parameters: { ...args.parameters, merge: true } }).valid).toBe(
        false,
      )
      expect(await client.callTool({ name, arguments: args })).toMatchObject({
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
