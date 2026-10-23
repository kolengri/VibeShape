import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { LOCAL_AUTOMATION_PATH } from "@vibeshape/automation-api/local-session"
import { localOperationSchema, localToolOutputs } from "@vibeshape/automation-api/local-tools"
import { renderPreviewMetadataSchema } from "@vibeshape/automation-api/render-preview"
import { vi } from "../../../tests/unit/support/bun-test"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it.each(["manual", "native-project", "desktop-external"] as const)(
  "advertises %s pairing instructions without granting document authority",
  async (policy) => {
    const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
    const adapter = createLocalMcpAdapter(
      broker,
      createExportResources(),
      policy === "manual" ? {} : { accessPolicy: policy },
    )
    const client = new Client({ name: "instructions-test", version: "1" })
    try {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
      const instructions = client.getInstructions()
      const manual = "Open the editor and explicitly enable the AI session for one document."
      expect(instructions).toContain("Read model_info, create a revision-bound draft")
      expect(instructions).toContain("preview and repair invalid geometry, then request commit")
      if (policy === "manual") {
        expect(instructions).toContain(manual)
        expect(instructions).toContain("Project tools require separate browser-owned")
        expect(instructions).not.toContain("automatically connects this embedded assistant")
      } else if (policy === "desktop-external") {
        expect(instructions).not.toContain(manual)
        expect(instructions).toContain("automatically connects this authenticated local client")
        expect(instructions).toContain("Model changes require manual Apply")
        expect(instructions).toContain(
          "only the person can restart access in Settings > Connections",
        )
        expect(instructions).not.toContain("authorizes validated model commits")
      } else {
        expect(instructions).not.toContain(manual)
        expect(instructions).toContain("automatically connects this embedded assistant")
        expect(instructions).toContain("current project's read and model-editing tools")
        expect(instructions).toContain(
          "authorizes validated model commits without another Apply step",
        )
        expect(instructions).toContain("Respect Stop AI; never enable access or switch projects")
        expect(instructions).toContain("Project management is unavailable")
      }
      expect(broker.isPaired()).toBe(false)
      expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
        isError: true,
        structuredContent: { result: { diagnostic: { code: "not-paired" } } },
      })
    } finally {
      await client.close()
      await adapter.close()
      broker.dispose()
    }
  },
)

function expectPreviewInputSchema(schema: Tool["inputSchema"]) {
  const validate = new AjvJsonSchemaValidator().getValidator({
    ...schema,
    properties: schema.properties ?? {},
    required: schema.required ?? [],
  })
  expect(
    validate({ source: "draft", draftId: "0195b5ac-b250-7a2c-8c33-000000000001", revision: 5 })
      .valid,
  ).toBe(true)
  expect(validate({ source: "draft", revision: 5 }).valid).toBe(false)
  for (const quality of ["overview", "detail"])
    expect(validate({ source: "model", revision: 4, quality }).valid).toBe(true)
  expect(validate({ source: "model", revision: 4, quality: "high" }).valid).toBe(false)
  expect(validate({ source: "model", revision: 4, quality: null }).valid).toBe(false)
}

it("delivers client-valid native preview images and withholds them after revocation", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
  vi.spyOn(broker, "invoke").mockResolvedValue(
    localToolOutputs.render_preview.parse({
      ok: true,
      value: {
        source: "model",
        documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
        revision: 4,
        generation: 1,
        geometryStatus: "valid",
        bodyCount: 1,
        quality: "detail",
        image: { mimeType: "image/png", base64: png, width: 1, height: 1, views: ["front"] },
      },
    }),
  )
  const paired = vi.spyOn(broker, "isPaired").mockReturnValue(true)
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "preview-image-client", version: "1" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    // Compile the exercised schemas rather than every CAD output schema on this test loop.
    const tool = (await client.request({ method: "tools/list" }, ListToolsResultSchema)).tools.find(
      ({ name }) => name === "render_preview",
    )
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    })
    if (!tool) throw new Error("The render_preview tool was not advertised.")
    expectPreviewInputSchema(tool.inputSchema)
    if (!tool.outputSchema) throw new Error("The render_preview output schema was not advertised.")
    const validateOutput = new AjvJsonSchemaValidator().getValidator({
      ...tool.outputSchema,
      properties: tool.outputSchema.properties ?? {},
      required: tool.outputSchema.required ?? [],
    })
    const request = {
      name: "render_preview",
      arguments: { source: "model", revision: 4, quality: "detail", views: ["front"] },
    }
    const rendered = CallToolResultSchema.parse(await client.callTool(request))
    expect(validateOutput(rendered.structuredContent).valid).toBe(true)
    expect(rendered.content).toContainEqual({ type: "image", data: png, mimeType: "image/png" })
    const structured = rendered.structuredContent?.result as { ok: boolean; value: unknown }
    expect(renderPreviewMetadataSchema.safeParse(structured.value).success).toBe(true)
    expect(structured.value).toMatchObject({ quality: "detail" })
    expect(rendered.content.filter(({ type }) => type === "image")).toHaveLength(1)
    expect(JSON.stringify(rendered.structuredContent)).not.toContain(png)
    paired.mockReturnValue(false)
    const revoked = CallToolResultSchema.parse(await client.callTool(request))
    expect(validateOutput(revoked.structuredContent).valid).toBe(true)
    expect(revoked).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "session-revoked" } } },
    })
    expect(revoked.content.some((content) => content.type === "image")).toBe(false)
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("advertises client-valid Datum Plane, Boolean and exact-body combination tools", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "reference-combination-schema-test", version: "1" })
  const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
  const base = {
    draftId: id(1),
    baseRevision: 7,
    commandId: id(2),
    featureId: id(3),
    references: [],
    suppressed: false,
  }
  const bodies = [
    { schemaVersion: 0, featureId: id(4), outputRole: "split.negative" },
    { schemaVersion: 0, featureId: id(4), outputRole: "split.positive" },
  ]
  const fixtures = [
    {
      suffix: "datum_plane",
      arguments: {
        ...base,
        dependencies: [],
        parameters: {
          mode: "offset",
          support: { kind: "origin-plane", plane: "xy" },
          offset: {
            schemaVersion: 0,
            dimension: "length",
            value: -29.5,
            unit: "mm",
            source: { value: -29.5, unit: "mm", expression: null },
          },
        },
      },
    },
    {
      suffix: "boolean",
      arguments: {
        ...base,
        dependencies: [id(4), id(5)],
        parameters: { operation: "subtract", keepTools: true },
      },
    },
    { suffix: "union", arguments: { ...base, dependencies: [id(4)], parameters: { bodies } } },
    {
      suffix: "compound",
      arguments: {
        ...base,
        dependencies: [id(4)],
        parameters: {
          slots: bodies.map((targetBody, index) => ({ slotId: id(10 + index), targetBody })),
        },
      },
    },
  ]
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    const validator = new AjvJsonSchemaValidator()
    for (const fixture of fixtures) {
      for (const action of ["create", "update"]) {
        const tool = listed.tools.find(({ name }) => name === `${action}_${fixture.suffix}`)
        if (!tool) throw new Error(`Missing advertised ${action}_${fixture.suffix} tool.`)
        expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
        const validate = validator.getValidator({
          ...tool.inputSchema,
          properties: tool.inputSchema.properties ?? {},
          required: tool.inputSchema.required ?? [],
        })
        expect(validate(fixture.arguments).valid).toBe(true)
        expect(validate({ ...fixture.arguments, commandId: "legacy-command" }).valid).toBe(false)
        expect(validate({ ...fixture.arguments, parameters: {} }).valid).toBe(false)
      }
    }
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

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

it("does not recreate an old export resource after concurrent session recovery", async () => {
  const origin = "http://127.0.0.1:43114"
  const document = {
    id: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
    name: "Bracket",
    revision: 4,
  }
  const resources = createExportResources()
  const add = vi.spyOn(resources, "add")
  const broker = createBrowserBroker({ origin, onRevoke: resources.clear })
  const request = (path: string, body: unknown, token?: string) =>
    new Request(`${origin}${LOCAL_AUTOMATION_PATH}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        host: "127.0.0.1:43114",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  const adapter = createLocalMcpAdapter(broker, resources)
  const client = new Client({ name: "reload-race", version: "1" })
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(st), client.connect(ct)])
    const { token } = (await (
      await broker.handle(request("connect", { protocolVersion: 1, document }))
    ).json()) as { token: string }
    const pending = client.callTool({
      name: "export_model",
      arguments: { revision: 4, format: "step" },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const polled = (await (
      await broker.handle(
        request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
      )
    ).json()) as { work: { requestId: string } }
    const result = {
      ok: true,
      value: {
        documentId: document.id,
        revision: 4,
        format: "step",
        filename: "model.step",
        mimeType: "model/step",
        base64: "U1RFUA==",
      },
    }
    const responses = await Promise.all([
      broker.handle(
        request(
          "result",
          { protocolVersion: 1, requestId: polled.work.requestId, tool: "export_model", result },
          token,
        ),
      ),
      broker.handle(request("resume", { protocolVersion: 1, document }, token)),
    ])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect((await pending).structuredContent).toMatchObject({
      result: { ok: false, diagnostic: { code: "session-revoked" } },
    })
    expect(add).not.toHaveBeenCalled()
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})

it("advertises optional project-list pagination accepted by schema-validating clients", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "project-schema-client", version: "1" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const tool = (await client.listTools()).tools.find(({ name }) => name === "list_projects")
    if (!tool) throw new Error("The list_projects tool was not advertised.")
    const validate = new AjvJsonSchemaValidator().getValidator({
      ...tool.inputSchema,
      properties: tool.inputSchema.properties ?? {},
      required: tool.inputSchema.required ?? [],
    })
    expect(validate({}).valid).toBe(true)
    expect(validate({ limit: 100 }).valid).toBe(true)
    expect(validate({ limit: 101 }).valid).toBe(false)
    expect(validate({ cursor: "invalid" }).valid).toBe(false)
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
