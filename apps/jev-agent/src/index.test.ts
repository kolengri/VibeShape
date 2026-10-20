import { expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import * as acp from "@agentclientprotocol/sdk"

it("starts the source ACP executable with protocol-only stdout and no provider request", async () => {
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("./index.ts", import.meta.url))],
    {
      env: { TYPESAFE_API_KEY: "offline-test-only" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const reader = child.stdout.getReader()
  try {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} } })}\n`,
    )
    const chunk = await reader.read()
    const response = JSON.parse(new TextDecoder().decode(chunk.value))
    expect(response.id).toBe(1)
    expect(response.result.agentInfo.name).toBe("vibeshape-jev")
    expect(response.result.agentCapabilities.loadSession).toBe(false)
    child.stdin.end()
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stderr).text()).toBe("")
  } finally {
    reader.releaseLock()
    child.kill()
    await child.exited
  }
})
