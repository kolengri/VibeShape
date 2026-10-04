// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { expect, it } from "vitest"

import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

function quantity(value: number, dimension = "length", unit = "mm") {
  return { schemaVersion: 0, dimension, value, unit, source: { value, unit, expression: null } }
}

it("advertises versioned endpoint, recess and axis contracts on all six existing MCP tools", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43118" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "extent-fastener-schema", version: "1" })
  const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
  const targetBody = { schemaVersion: 0, featureId: id(1), outputRole: "split.negative" }
  const face = {
    schemaVersion: 1,
    featureId: id(1),
    outputRole: targetBody.outputRole,
    kind: "face",
    semanticRole: "primitive.box.cap.end",
    signature: {
      kind: "face",
      geometryClass: "PLANE",
      measure: 400,
      centroid: [0, 0, 10],
      bounds: { min: [-10, -10, 10], max: [10, 10, 10] },
      direction: [0, 0, 1],
      directionMode: "oriented",
      boundaryCount: 4,
      adjacentGeometryClasses: ["PLANE"],
    },
  }
  const common = {
    draftId: id(10),
    baseRevision: 0,
    commandId: id(11),
    featureId: id(12),
    dependencies: [id(1)],
    references: [],
    suppressed: false,
  }
  const extrude = {
    profiles: {
      schemaVersion: 0,
      profiles: [
        {
          schemaVersion: 0,
          sketchId: id(2),
          outerBoundaryEntityIds: [id(3)],
          holeBoundaryEntityIds: [],
        },
      ],
    },
    operation: "remove",
    distance: quantity(8),
    symmetric: false,
    reversed: false,
    secondDistance: null,
    targetBody,
    startOffset: quantity(-1),
    draftAngle: quantity(Math.PI / 90, "angle", "rad"),
    endCondition: { kind: "up-to-face", targetBody, sourceContentHash: "a".repeat(64), face },
  }
  const hole = {
    sketchId: id(2),
    pointIds: [id(3)],
    diameter: quantity(2),
    direction: "forward",
    extent: "blind",
    depth: quantity(8),
    targetBody,
    treatment: {
      kind: "countersink",
      diameter: quantity(4),
      angle: quantity(Math.PI / 2, "angle", "rad"),
    },
  }
  const thread = {
    targetBody,
    kind: "internal",
    axis: { kind: "explicit-axis", origin: [0, 0, 0], direction: [0, 0, 1] },
    handedness: "right",
    nominalDiameter: quantity(10),
    pitch: quantity(2),
    length: quantity(40),
    depth: quantity(0.8),
    clearance: quantity(0.1),
    starts: quantity(1, "scalar", "1"),
    phase: quantity(0, "angle", "rad"),
    runIn: quantity(0),
    runOut: quantity(0),
  }
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const [suffix, parameters] of [
      ["extrude", extrude],
      ["hole", hole],
      ["thread", thread],
    ] as const) {
      for (const action of ["create", "update"]) {
        const name = `${action}_${suffix}`
        const tool = listed.tools.find((entry) => entry.name === name)
        if (!tool) throw new Error(`Missing ${name}.`)
        const validate = new AjvJsonSchemaValidator().getValidator({
          ...tool.inputSchema,
          properties: tool.inputSchema.properties ?? {},
          required: tool.inputSchema.required ?? [],
        })
        const args = { ...common, parameters }
        expect(validate(args).valid).toBe(true)
        expect(validate({ ...args, parameters: { ...parameters, nativeFaceIndex: 3 } }).valid).toBe(
          false,
        )
        expect(await client.callTool({ name, arguments: args })).toMatchObject({
          isError: true,
          structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
        })
        expect(
          await client.callTool({ name, arguments: { ...args, dependencies: [] } }),
        ).toMatchObject({
          isError: true,
          structuredContent: { result: { ok: false, diagnostic: { code: "invalid-operation" } } },
        })
      }
    }
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
