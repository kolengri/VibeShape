import { expect, it } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { agentSkillTool } from "@vibeshape/automation-api/agent-skills"
import { localToolNameSchema } from "@vibeshape/automation-api/local-tools"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("discovers client-valid planar import schemas without acquiring unpaired authority", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43130" })
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "planar-import-schema-test", version: "1" })
  const uploadId = "0195b5ac-b250-7a2c-8c33-000000000001"
  try {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(b), client.connect(a)])
    const tools = (await client.listTools()).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...localToolNameSchema.options, agentSkillTool.name].sort(),
    )
    expect(tools).toHaveLength(171)
    const inputs = {
      begin_planar_import_upload: {
        revision: 4,
        filename: "source.svg",
        byteLength: 3,
        unit: "mm",
        plane: "xz",
      },
      append_planar_import_chunk: { uploadId, offset: 0, base64: "AQID" },
      inspect_planar_import_upload: { uploadId },
      commit_planar_import_upload: { uploadId, uploadVersion: 2 },
      discard_planar_import_upload: { uploadId },
    }
    for (const [name, input] of Object.entries(inputs)) {
      const tool = tools.find((entry) => entry.name === name)
      if (!tool) throw new Error(`Missing ${name}.`)
      expect(tool.annotations).toMatchObject({
        readOnlyHint: name !== "commit_planar_import_upload",
        destructiveHint: name === "commit_planar_import_upload",
        openWorldHint: false,
      })
      const validate = new AjvJsonSchemaValidator().getValidator({
        ...tool.inputSchema,
        properties: tool.inputSchema.properties ?? {},
        required: tool.inputSchema.required ?? [],
      })
      expect(validate(input).valid).toBe(true)
      for (const extra of [
        { actor: {} },
        { path: "/private/source.svg" },
        { sha256: "a".repeat(64) },
        { approved: true },
      ])
        expect(validate({ ...input, ...extra }).valid).toBe(false)
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
