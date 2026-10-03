// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { expect, it } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers strict custom Thread tools and requires pairing before draft mutation", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "thread-schema-test", version: "1" })
  const id = "0195b5ac-b250-7a2c-8c33-000000000030"
  const quantity = (
    value: number,
    dimension = "length",
    unit = "mm",
    expression: string | null = null,
  ) => ({ schemaVersion: 0, dimension, value, unit, source: { value, unit, expression } })
  const parameters = {
    targetBody: { schemaVersion: 0, featureId: id, outputRole: "split.negative" },
    kind: "external",
    axis: "Z",
    handedness: "right",
    origin: { x: quantity(0), y: quantity(0), z: quantity(0) },
    nominalDiameter: quantity(10),
    pitch: quantity(2, "length", "mm", "#pitch"),
    length: quantity(6),
    depth: quantity(0.8),
    clearance: quantity(0.1),
    starts: quantity(1, "scalar", "1"),
    phase: quantity(0, "angle", "rad"),
    runIn: quantity(0),
    runOut: quantity(0),
  }
  const args = {
    draftId: id,
    baseRevision: 0,
    commandId: id,
    featureId: id,
    dependencies: [id],
    references: [],
    suppressed: false,
    parameters,
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_thread", "update_thread"]) {
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
        { ...args, dependencies: [] },
        { ...args, parameters: { ...parameters, axis: "custom" } },
        { ...args, parameters: { ...parameters, kind: "ISO" } },
        { ...args, parameters: { ...parameters, starts: quantity(1, "length", "mm") } },
        { ...args, parameters: { ...parameters, smoothTaper: true } },
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
