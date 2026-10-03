// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { expect, it } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers strict ordered Loft and directed Sweep tools without unpaired document authority", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "sweep-loft-schema-test", version: "1" })
  const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
  const section = (n: number) => ({
    schemaVersion: 0,
    sketchId: id(n),
    outerBoundaryEntityIds: [id(n + 10)],
    holeBoundaryEntityIds: [],
  })
  const base = {
    draftId: id(40),
    commandId: id(41),
    baseRevision: 0,
    featureId: id(42),
    dependencies: [],
    references: [],
    suppressed: false,
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_loft", "update_loft", "create_sweep", "update_sweep"]) {
      const tool = listed.tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      const parameters = name.endsWith("loft")
        ? { sections: [section(2), section(1)], ruled: false }
        : {
            profile: section(1),
            path: { schemaVersion: 0, sketchId: id(3), entityIds: [id(20)], startPointId: id(21) },
          }
      const input = { ...base, parameters }
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(input).valid).toBe(true)
      expect(validate({ ...input, parameters: { ...parameters, autoPosition: true } }).valid).toBe(
        false,
      )
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      })
      expect(await client.callTool({ name, arguments: input })).toMatchObject({
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
