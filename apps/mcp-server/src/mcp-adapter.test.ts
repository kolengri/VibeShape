// @vitest-environment node

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"
import { localOperationSchema, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import { expect, it, vi } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers the actual editor and a usable authoring guide before pairing without document access", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43999" })
  const invoke = vi.spyOn(broker, "invoke")
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "onboarding-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listResources()
    expect(listed.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: "vibeshape://session", mimeType: "application/json" }),
        expect.objectContaining({ uri: "vibeshape://authoring-guide", mimeType: "text/markdown" }),
      ]),
    )
    const session = await client.readResource({ uri: "vibeshape://session" })
    const content = session.contents[0]
    if (!content || !("text" in content)) throw new Error("Expected session JSON.")
    expect(JSON.parse(content.text)).toEqual({
      schemaVersion: 1,
      editorUrl: "http://127.0.0.1:43999",
      paired: false,
    })
    const guide = await client.readResource({ uri: "vibeshape://authoring-guide" })
    const resource = guide.contents[0]
    if (!resource || !("text" in resource)) throw new Error("Expected authoring Markdown.")
    const example = resource.text.match(/```json\n([\s\S]*?)\n```/)
    if (!example?.[1]) throw new Error("Expected the plate tool-call example.")
    const operations = JSON.parse(example[1]) as unknown[]
    expect(operations).toHaveLength(5)
    const parsed = operations.map((operation) => localOperationSchema.parse(operation))
    expect(parsed.map(({ tool }) => tool)).toEqual([
      "create_variable",
      "create_sketch",
      "create_extrude",
      "create_sketch",
      "create_hole",
    ])
    expect(invoke).not.toHaveBeenCalled()
    const unpaired = await client.callTool({ name: "model_info", arguments: {} })
    expect(unpaired).toMatchObject({
      isError: true,
      structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
    })
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("reports pairing and revocation through the session resource without leaking paired document data", async () => {
  const origin = "http://127.0.0.1:43998"
  const broker = createBrowserBroker({ origin })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "session-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const paired = await broker.handle(
      new Request(`${origin}${LOCAL_AUTOMATION_PATH}/connect`, {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:43998", origin },
        body: JSON.stringify({
          protocolVersion: 1,
          document: {
            id: "0195b5ac-b250-7a2c-8c33-000000000020",
            name: "Private model",
            revision: 0,
          },
        }),
      }),
    )
    expect(paired.status).toBe(200)
    const session = await client.readResource({ uri: "vibeshape://session" })
    expect(session.contents).toEqual([
      {
        uri: "vibeshape://session",
        mimeType: "application/json",
        text: JSON.stringify({ schemaVersion: 1, editorUrl: origin, paired: true }),
      },
    ])
    broker.revoke()
    const revoked = await client.readResource({ uri: "vibeshape://session" })
    expect(revoked.contents).toEqual([
      {
        uri: "vibeshape://session",
        mimeType: "application/json",
        text: JSON.stringify({ schemaVersion: 1, editorUrl: origin, paired: false }),
      },
    ])
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("advertises client-valid legacy and exact-body Hole input schemas", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "schema-test", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    const id = "0195b5ac-b250-7a2c-8c33-000000000030"
    const parameters = {
      sketchId: id,
      pointIds: [id],
      direction: "forward",
      extent: "through-all",
      diameter: {
        schemaVersion: 0,
        dimension: "length",
        value: 4,
        unit: "mm",
        source: { value: 4, unit: "mm", expression: null },
      },
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
    for (const name of ["create_hole", "update_hole"]) {
      const tool = listed.tools.find((tool) => tool.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(args).valid).toBe(true)
      expect(
        validate({
          ...args,
          parameters: {
            ...parameters,
            targetBody: { schemaVersion: 0, featureId: id, outputRole: "pattern.instance.1" },
          },
        }).valid,
      ).toBe(true)
      expect(
        validate({
          ...args,
          parameters: {
            ...parameters,
            targetBody: { schemaVersion: 0, featureId: id, outputRole: "" },
          },
        }).valid,
      ).toBe(false)
    }
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("publishes read-only body measurements with client-valid labeled output", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const result = localToolOutputs.model_body_measurements.parse({
    ok: true,
    value: {
      kind: "org.vibeshape.model.body-measurements" as const,
      schemaVersion: 1 as const,
      documentId: "0195b5ac-b250-7a2c-8c33-000000000020",
      revision: 4,
      generation: 5,
      classification: "derived" as const,
      nextCursor: null,
      units: { length: "mm" as const, area: "mm2" as const, volume: "mm3" as const },
      data: {
        bodies: [
          {
            featureId: "0195b5ac-b250-7a2c-8c33-000000000030",
            outputRole: "result",
            label: "Measured body",
            contentHash: "a".repeat(64),
            shape: {
              valid: true as const,
              volume: 1,
              surfaceArea: 6,
              bounds: {
                min: [0, 0, 0] as [number, number, number],
                max: [1, 1, 1] as [number, number, number],
              },
              solidCount: 1,
              faceCount: 6,
              edgeCount: 12,
            },
          },
        ],
        total: 1,
      },
    },
  })
  vi.spyOn(broker, "invoke").mockResolvedValue(result)
  try {
    const adapter = createLocalMcpAdapter(broker, createExportResources())
    const client = new Client({ name: "test", version: "1" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    const bodyTool = listed.tools.find(({ name }) => name === "model_body_measurements")
    expect(bodyTool).toMatchObject({
      name: "model_body_measurements",
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    })
    expect(bodyTool?.inputSchema).toBeDefined()
    await expect(
      client.callTool({ name: "model_body_measurements", arguments: { revision: 4 } }),
    ).resolves.toMatchObject({ isError: false, structuredContent: { result } })
    await client.close()
    await adapter.close()
  } finally {
    broker.dispose()
  }
})
