import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers client-valid exact-body Mirror and Shell tools without granting unpaired document access", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43117" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "mirror-schema-test", version: "1" })
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
      targetBody: { schemaVersion: 0, featureId: id, outputRole: "body.primary" },
      plane: "YZ",
    },
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const name of ["create_mirror", "update_mirror", "create_shell", "update_shell"]) {
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
      const input = name.endsWith("shell")
        ? {
            ...args,
            parameters: {
              targetBody: args.parameters.targetBody,
              thickness: {
                schemaVersion: 0,
                dimension: "length",
                value: 1,
                unit: "mm",
                source: { value: 1, unit: "mm", expression: null },
              },
              direction: "inward",
              sourceContentHash: "a".repeat(64),
              openings: [
                {
                  schemaVersion: 1,
                  featureId: id,
                  outputRole: "body.primary",
                  kind: "face",
                  signature: {
                    kind: "face",
                    geometryClass: "plane",
                    measure: 6,
                    centroid: [0, 0, 4],
                    bounds: { min: [-1, -1.5, 4], max: [1, 1.5, 4] },
                    boundaryCount: 4,
                    adjacentGeometryClasses: [],
                  },
                },
              ],
            },
          }
        : args
      expect(validate(input).valid).toBe(true)
      if (name.endsWith("mirror")) {
        expect(
          validate({
            ...args,
            parameters: {
              ...args.parameters,
              offset: {
                schemaVersion: 0,
                dimension: "length",
                value: -25.4,
                unit: "mm",
                source: { value: -1, unit: "in", expression: null },
              },
              preserveSource: true,
            },
          }).valid,
        ).toBe(true)
        expect(
          validate({
            ...args,
            parameters: {
              ...args.parameters,
              offset: {
                schemaVersion: 0,
                dimension: "length",
                value: 0,
                unit: "mm",
                source: { value: 0, unit: "mm", expression: null },
              },
            },
          }).valid,
        ).toBe(false)
      }
      expect(validate({ ...input, dependencies: [] }).valid).toBe(false)
      expect(
        validate({ ...input, parameters: { ...input.parameters, plane: "custom" } }).valid,
      ).toBe(false)
      expect(
        validate({ ...input, parameters: { ...input.parameters, keepSource: true } }).valid,
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
