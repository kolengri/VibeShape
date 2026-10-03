// @vitest-environment node

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, it, vi } from "vitest"
import { createBrowserBroker } from "./browser-broker"
import { createExportResources } from "./export-resources"
import { createLocalMcpAdapter } from "./mcp-adapter"

it("loads the complete operator pack through resources or tools without browser document access", async () => {
  const broker = createBrowserBroker({ origin: "http://127.0.0.1:43114" })
  const invoke = vi.spyOn(broker, "invoke")
  const adapter = createLocalMcpAdapter(broker, createExportResources())
  const client = new Client({ name: "skill-reader", version: "1" })
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([adapter.connect(serverTransport), client.connect(clientTransport)])
    expect(client.getServerCapabilities()).toHaveProperty("resources")
    expect(client.getInstructions()).toContain("vibeshape://agent-skills")
    expect(client.getInstructions()).toContain("read_agent_skill")
    const catalog = await client.listResources()
    const uri = "vibeshape://agent-skills"
    expect(catalog.resources).toContainEqual(expect.objectContaining({ uri }))
    const listed = await client.listTools()
    expect(listed.tools).toContainEqual(
      expect.objectContaining({
        name: "read_agent_skill",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
    )
    const indexRead = await client.readResource({ uri })
    const indexContent = indexRead.contents[0]
    if (!indexContent || !("text" in indexContent)) throw new Error("Expected the skill index.")
    const index = JSON.parse(indexContent.text) as {
      schemaVersion: number
      entrypoint: string
      skills: { name: string; uri: string; references: { uri: string }[] }[]
    }
    expect(index.schemaVersion).toBe(1)
    expect(index.entrypoint).toBe("vibeshape://agent-skills/vibeshape-use/SKILL.md")
    expect(index.skills.map((skill) => skill.name)).toEqual([
      "vibeshape-use",
      "vibeshape-modeling",
      "vibeshape-inspection",
      "vibeshape-organization",
      "vibeshape-export",
    ])
    expect(await client.callTool({ name: "read_agent_skill", arguments: {} })).toMatchObject({
      isError: false,
      structuredContent: { result: { ok: true, value: indexContent } },
    })
    const documents = index.skills.flatMap((skill) => [
      skill.uri,
      ...skill.references.map((reference) => reference.uri),
    ])
    expect(documents).toHaveLength(9)
    for (const documentUri of documents) {
      const read = await client.readResource({ uri: documentUri })
      const content = read.contents[0]
      if (!content || !("text" in content)) throw new Error("Expected skill Markdown.")
      expect(content.mimeType).toBe("text/markdown")
      expect(content.text.length).toBeGreaterThan(100)
      const tool = await client.callTool({
        name: "read_agent_skill",
        arguments: { uri: documentUri },
      })
      expect(tool).toMatchObject({
        isError: false,
        structuredContent: { result: { ok: true, value: content } },
      })
      for (const link of content.text.matchAll(/\]\((vibeshape:\/\/agent-skills[^)]+)\)/g)) {
        expect(documents).toContain(link[1])
        expect((await client.readResource({ uri: String(link[1]) })).contents).toHaveLength(1)
      }
      expect(Buffer.byteLength(JSON.stringify(tool))).toBeLessThan(128 * 1024)
    }
    for (const invalidUri of [
      "file:///etc/passwd",
      `${uri}/../session`,
      `${uri}/vibeshape-use/%2e%2e/secret.md`,
    ]) {
      await expect(client.readResource({ uri: invalidUri })).rejects.toThrow()
      expect(
        await client.callTool({ name: "read_agent_skill", arguments: { uri: invalidUri } }),
      ).toMatchObject({
        isError: true,
        structuredContent: { result: { diagnostic: { code: "unknown-skill-resource" } } },
      })
    }
    expect(
      await client.callTool({
        name: "read_agent_skill",
        arguments: { uri: index.entrypoint, path: "/etc/passwd" },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "invalid-operation" } } },
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
  } finally {
    await client.close()
    await adapter.close()
    broker.dispose()
  }
})
