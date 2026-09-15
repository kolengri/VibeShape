// @vitest-environment node

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { localToolOutputs } from "@vibeshape/automation-api/local-tools"
import { expect, it, vi } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

const documentId = "0195b5ac-b250-7a2c-8c33-000000000020"
const featureId = "0195b5ac-b250-7a2c-8c33-000000000030"
const otherFeatureId = "0195b5ac-b250-7a2c-8c33-000000000031"

const signature = {
  kind: "edge" as const,
  geometryClass: "LINE",
  measure: 10,
  centroid: [0, 0, 0] as [number, number, number],
  bounds: {
    min: [-1, -1, -1] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  },
  direction: [1, 0, 0] as [number, number, number],
  directionMode: "axis" as const,
  boundaryCount: 2,
  adjacentGeometryClasses: [],
}

const view = {
  kind: "org.vibeshape.model.body-topology" as const,
  schemaVersion: 1 as const,
  documentId,
  revision: 4,
  generation: 5,
  rebuildId: "rebuild-5",
  featureId,
  contentHash: "a".repeat(64),
  outputRole: "result",
  topologyKind: "edge" as const,
  classification: "derived" as const,
  nextCursor: null,
  data: {
    topology: [
      {
        reference: {
          schemaVersion: 1 as const,
          featureId,
          outputRole: "result",
          kind: "edge" as const,
          semanticRole: "body.edge.start",
          signature,
        },
        resolution: "resolved" as const,
      },
    ],
    total: 1,
  },
}

it("advertises a client-valid body topology schema and read-only annotation", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "body-topology-schema-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    const tool = listed.tools.find(({ name }) => name === "model_body_topology")
    expect(tool).toMatchObject({
      name: "model_body_topology",
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    })
    if (!tool) throw new Error("Missing model_body_topology tool.")
    const validateInput = new AjvJsonSchemaValidator().getValidator({
      ...tool.inputSchema,
      properties: tool.inputSchema.properties ?? {},
      required: tool.inputSchema.required ?? [],
    })
    expect(
      validateInput({
        revision: 4,
        featureId,
        outputRole: "result",
        topologyKind: "edge",
        cursor: null,
        limit: 20,
      }).valid,
    ).toBe(true)
    expect(
      validateInput({
        revision: 4,
        featureId,
        outputRole: "Bad Role",
        topologyKind: "edge",
        cursor: null,
        limit: 20,
      }).valid,
    ).toBe(false)
    expect(
      validateInput({
        revision: 4,
        featureId,
        outputRole: "result",
        topologyKind: "vertex",
        cursor: null,
        limit: 20,
      }).valid,
    ).toBe(false)

    if (!tool.outputSchema) throw new Error("Missing body topology output schema.")
    const validateOutput = new AjvJsonSchemaValidator().getValidator({
      ...tool.outputSchema,
      properties: tool.outputSchema.properties ?? {},
      required: tool.outputSchema.required ?? [],
    })
    expect(validateOutput({ result: { ok: true, value: view } }).valid).toBe(true)
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("publishes body topology through the independent in-memory SDK client", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const result = localToolOutputs.model_body_topology.parse({ ok: true, value: view })
  vi.spyOn(broker, "invoke").mockResolvedValue(result)
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "body-topology-client-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    await expect(
      client.callTool({
        name: "model_body_topology",
        arguments: {
          revision: 4,
          featureId,
          outputRole: "result",
          topologyKind: "edge",
          cursor: null,
          limit: 20,
        },
      }),
    ).resolves.toMatchObject({ isError: false, structuredContent: { result } })
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("rejects wrong body scope and invalid roles in the strict output contract", () => {
  const topologyEntry = view.data.topology[0]
  if (!topologyEntry) throw new Error("Missing topology fixture entry.")
  expect(
    localToolOutputs.model_body_topology.safeParse({
      ok: true,
      value: {
        ...view,
        data: {
          ...view.data,
          topology: [
            {
              ...topologyEntry,
              reference: { ...topologyEntry.reference, featureId: otherFeatureId },
            },
          ],
        },
      },
    }).success,
  ).toBe(false)
  expect(
    localToolOutputs.model_body_topology.safeParse({
      ok: true,
      value: { ...view, outputRole: "Bad Role" },
    }).success,
  ).toBe(false)
})
