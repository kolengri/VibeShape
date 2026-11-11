import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

const id = "0195b5ac-b250-7a2c-8c33-000000000050"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000051"
const targetBody = { schemaVersion: 0, featureId: id, outputRole: "body.primary" }
const common = {
  draftId: id,
  baseRevision: 0,
  commandId: id,
  featureId,
  dependencies: [id],
  references: [],
  suppressed: false,
}
const length = (value: number) => ({
  schemaVersion: 0,
  dimension: "length",
  value,
  unit: "mm",
  source: { value, unit: "mm", expression: null },
})
const face = {
  schemaVersion: 1,
  featureId: id,
  outputRole: "body.primary",
  kind: "face",
  signature: {
    kind: "face",
    geometryClass: "CYLINDRE",
    measure: 314,
    centroid: [0, 0, 5],
    bounds: { min: [-5, -5, 0], max: [5, 5, 10] },
    boundaryCount: 2,
    adjacentGeometryClasses: [],
  },
}
const inputs = {
  thicken: {
    ...common,
    parameters: {
      targetBody,
      faces: [face],
      thickness: length(2),
      side: "outward",
      operation: "new",
    },
  },
  press_pull: {
    ...common,
    parameters: { targetBody, face, sourceContentHash: "a".repeat(64), distance: length(1) },
  },
}

it("discovers client-valid Thicken and Press Pull tools without granting unpaired access", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "thicken-schema-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of [
      "create_thicken",
      "update_thicken",
      "create_press_pull",
      "update_press_pull",
    ]) {
      const tool = listed.tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      const input = name.endsWith("thicken") ? inputs.thicken : inputs.press_pull
      expect(validate(input).valid).toBe(true)
      expect(validate({ ...input, dependencies: [] }).valid).toBe(false)
      expect(validate({ ...input, parameters: { ...input.parameters, faceIndex: 3 } }).valid).toBe(
        false,
      )
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
