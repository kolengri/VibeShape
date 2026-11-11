import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

const id = "0195b5ac-b250-7a2c-8c33-000000000040"
// Reference-frame features reject self-dependencies, so the new feature has its own identity.
const featureId = "0195b5ac-b250-7a2c-8c33-000000000041"
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
const quantity = (dimension: "angle" | "scalar", value: number, unit: "rad" | "1") => ({
  schemaVersion: 0,
  dimension,
  value,
  unit,
  source: { value, unit, expression: null },
})
const inputs = {
  create_face_draft: {
    ...common,
    parameters: {
      targetBody,
      faces: [
        {
          schemaVersion: 1,
          featureId: id,
          outputRole: "body.primary",
          kind: "face",
          signature: {
            kind: "face",
            geometryClass: "PLANE",
            measure: 6,
            centroid: [1, 0, 4],
            bounds: { min: [1, -1.5, 3], max: [1, 1.5, 5] },
            boundaryCount: 4,
            adjacentGeometryClasses: [],
          },
        },
      ],
      neutralPlane: { kind: "origin-plane", plane: "XY" },
      angle: quantity("angle", 0.05, "rad"),
      flip: true,
    },
  },
  create_scale: {
    ...common,
    parameters: {
      targetBody,
      factor: quantity("scalar", 2, "1"),
      center: { kind: "bounding-box-center" },
    },
  },
}

it("discovers client-valid Draft and Scale tools without granting unpaired document access", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "draft-scale-schema-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_face_draft", "update_face_draft", "create_scale", "update_scale"]) {
      const tool = listed.tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      const input = name.endsWith("face_draft") ? inputs.create_face_draft : inputs.create_scale
      expect(validate(input).valid).toBe(true)
      expect(validate({ ...input, dependencies: [] }).valid).toBe(false)
      expect(
        validate({ ...input, parameters: { ...input.parameters, nonUniform: [1, 2, 3] } }).valid,
      ).toBe(false)
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
