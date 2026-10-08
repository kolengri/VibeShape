import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers strict FDM tools and requires pairing before draft mutation", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "fdm-schema-test", version: "1" })
  const id = "0195b5ac-b250-7a2c-8c33-000000000030"
  const quantity = (
    value: number,
    dimension = "length",
    unit = "mm",
    expression: string | null = null,
  ) => ({ schemaVersion: 0, dimension, value, unit, source: { value, unit, expression } })
  const parameters = {
    kind: "teardrop-hole",
    axis: "X",
    flatTop: true,
    targetBody: { schemaVersion: 0, featureId: id, outputRole: "split.negative" },
    origin: { x: quantity(0), y: quantity(0), z: quantity(5) },
    diameter: quantity(6),
    depth: quantity(10),
    roofAngle: quantity(Math.PI / 4, "angle", "rad"),
  }
  const args = {
    draftId: id,
    baseRevision: 0,
    commandId: id,
    featureId: "0195b5ac-b250-7a2c-8c33-000000000031",
    dependencies: [id],
    references: [],
    suppressed: false,
    parameters,
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_fdm", "update_fdm"]) {
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
      for (const invalid of [
        { ...args, parameters: { ...parameters, axis: "custom" } },
        { ...args, parameters: { ...parameters, kind: "unsupported" } },
        { ...args, parameters: { ...parameters, roofAngle: quantity(45, "length", "mm") } },
        { ...args, parameters: { ...parameters, sourceFaceIndex: 1 } },
      ])
        expect(validate(invalid).valid).toBe(false)
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
