import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import {
  lifecycleId as id,
  primitiveNames,
  primitiveParameters,
} from "../../../tests/support/primitive-lifecycle"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("advertises all registered primitives and review-bound lifecycle tools with client-valid schemas", async () => {
  const adapter = createLocalMcpAdapter(
    createBrowserBroker({ origin: "http://127.0.0.1:45500" }),
    createExportResources(),
  )
  const client = new Client({ name: "primitive-lifecycle-schema-test", version: "1" })
  const base = { draftId: id(1), baseRevision: 0, commandId: id(2) }
  const cases: { name: string; arguments: Record<string, unknown>; destructive: boolean }[] =
    primitiveNames.flatMap((name) =>
      (name === "box" ? ["update"] : ["create", "update"]).map((action) => ({
        name: `${action}_${name}`,
        arguments: {
          ...base,
          featureId: id(3),
          suppressed: false,
          parameters: primitiveParameters(name),
        },
        destructive: false,
      })),
    )
  cases.push(
    { name: "remove_feature", arguments: { ...base, featureId: id(3) }, destructive: true },
    { name: "remove_sketch", arguments: { ...base, sketchId: id(3) }, destructive: true },
    {
      name: "set_feature_suppressed",
      arguments: { ...base, featureId: id(3), suppressed: false },
      destructive: false,
    },
    { name: "rename_project", arguments: { ...base, name: "Named project" }, destructive: false },
  )
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    const listed = await client.listTools()
    for (const input of cases) {
      const tool = listed.tools.find(({ name }) => name === input.name)
      if (!tool) throw new Error(`Missing ${input.name}.`)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: input.destructive,
        openWorldHint: false,
      })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(input.arguments).valid).toBe(true)
      for (const extra of [{ actor: {} }, { documentId: id(9) }, { cascade: true }])
        expect(validate({ ...input.arguments, ...extra }).valid).toBe(false)
      expect(await client.callTool({ name: input.name, arguments: input.arguments })).toMatchObject(
        {
          isError: true,
          structuredContent: { result: { ok: false, diagnostic: { code: "not-paired" } } },
        },
      )
    }
    expect(listed.tools.some(({ name }) => name === "create_box")).toBe(true)
  } finally {
    await client.close()
    await adapter.close()
  }
})
