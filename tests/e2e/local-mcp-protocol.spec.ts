import { expect, test } from "@playwright/test"
import { createMcpTestClient } from "../../apps/mcp-server/test/client"

test("bounds stdio input and rejects hostile loopback requests without exposing a document", async ({
  request,
}, info) => {
  const local = await createMcpTestClient(43500 + info.parallelIndex)
  const endpoint = `${local.origin}/__vibeshape/automation/status`
  try {
    const hostile = await request.post(endpoint, {
      data: {},
      headers: { Origin: "https://example.invalid" },
    })
    expect(hostile.status()).toBe(403)
    expect(hostile.headers()["access-control-allow-origin"]).toBeUndefined()
    expect((await request.post(endpoint, { data: {} })).status()).toBe(403)
    const status = await request.post(endpoint, { data: {}, headers: { Origin: local.origin } })
    expect(status.status()).toBe(200)
    expect(await status.json()).toEqual({
      protocolVersion: 1,
      paired: false,
      client: { name: "VibeShape integration client", version: "1.0" },
    })
    const html = await request.get(local.origin)
    const policy = html.headers()["content-security-policy"]
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toContain("'unsafe-eval'")
    const text = await html.text()
    const bundle = /src="([^"]+\.js)"/.exec(text)?.[1]
    expect(bundle).toBeDefined()
    const traversal = await request.get(`${local.origin}/%2e%2e/package.json`)
    expect(traversal.status()).toBe(404)
    const tool = await local.callTool({ name: "run_script", arguments: { script: "forbidden" } })
    expect(tool.isError).toBe(true)
    expect(tool.structuredContent?.result).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-operation" },
    })
    await expect(
      local.callTool({ name: "model_info", arguments: { flood: "x".repeat(300_000) } }),
    ).rejects.toThrow()
    await expect
      .poll(async () => {
        try {
          return (await request.post(endpoint, { data: {}, timeout: 1000 })).status()
        } catch {
          return 0
        }
      })
      .toBe(0)
  } finally {
    await local.close()
  }
})
