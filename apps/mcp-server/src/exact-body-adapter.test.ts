import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers additive client-valid exact-body tools without unpaired authority", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43129" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "exact-body-schema-test", version: "1" })
  const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
  const targetBody = { schemaVersion: 0, featureId: id(4), outputRole: "split.positive" }
  const common = {
    draftId: id(1),
    baseRevision: 0,
    commandId: id(2),
    featureId: id(3),
    dependencies: [id(4)],
    references: [],
    suppressed: false,
  }
  const inputs = {
    body_subtract: {
      operation: "subtract",
      targetBody,
      toolBody: { ...targetBody, outputRole: "split.negative" },
      keepTools: true,
    },
    body_revolve: {
      operation: "remove",
      targetBody,
      profiles: {
        schemaVersion: 0,
        profiles: [
          {
            schemaVersion: 0,
            sketchId: id(6),
            outerBoundaryEntityIds: [id(7)],
            holeBoundaryEntityIds: [],
          },
        ],
      },
      axis: { kind: "origin-axis", axis: "x" },
      angle: {
        schemaVersion: 0,
        dimension: "angle",
        value: 2 * Math.PI,
        unit: "rad",
        source: { value: 360, unit: "deg", expression: null },
      },
    },
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const [operation, parameters] of Object.entries(inputs)) {
      for (const action of ["create", "update"]) {
        const name = `${action}_${operation}`
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
        const input = { ...common, parameters }
        expect(validate(input).valid).toBe(true)
        for (const extra of [
          { actor: {} },
          { documentId: id(9) },
          { sourceContentHash: "a".repeat(64) },
          { references: [{}] },
        ])
          expect(validate({ ...input, ...extra }).valid).toBe(false)
        expect(await client.callTool({ name, arguments: input })).toMatchObject({
          isError: true,
          structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
        })
      }
    }
    for (const name of ["create_revolve", "create_boolean"])
      expect(listed.tools.some((tool) => tool.name === name)).toBe(true)
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
