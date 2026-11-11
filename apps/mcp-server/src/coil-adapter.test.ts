import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers strict Coil tools and requires pairing before draft mutation", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "coil-schema-test", version: "1" })
  const id = "0195b5ac-b250-7a2c-8c33-000000000040"
  const quantity = (value: number, dimension = "length", unit = "mm") => ({
    schemaVersion: 0,
    dimension,
    value,
    unit,
    source: { value, unit, expression: null },
  })
  const parameters = {
    axis: { kind: "origin-axis", axis: "Z" },
    handedness: "right",
    radius: quantity(10),
    pitch: quantity(5),
    extent: { kind: "height", height: quantity(20) },
    startAngle: quantity(0, "angle", "rad"),
    section: { kind: "circular", diameter: quantity(2) },
    operation: "new",
    targetBody: null,
  }
  const args = {
    draftId: id,
    baseRevision: 0,
    commandId: id,
    featureId: id,
    dependencies: [],
    references: [],
    suppressed: false,
    parameters,
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_coil", "update_coil"]) {
      const tool = listed.tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(args).valid).toBe(true)
      for (const invalid of [
        { ...args, parameters: { ...parameters, handedness: "up" } },
        { ...args, parameters: { ...parameters, section: { kind: "hexagonal" } } },
        { ...args, parameters: { ...parameters, groundEnds: true } },
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
