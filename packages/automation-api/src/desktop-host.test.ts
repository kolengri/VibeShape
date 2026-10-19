import { describe, expect, it } from "bun:test"
import { desktopMcpDescriptorSchema } from "./desktop-host"

const descriptor = {
  protocolVersion: 1,
  endpoint: "http://127.0.0.1:43115/__vibeshape/native-mcp",
  token: "a".repeat(64),
  pid: 42,
}
describe("desktop attachment descriptor boundary", () => {
  it("accepts only canonical loopback MCP endpoints in the supported port range", () => {
    expect(desktopMcpDescriptorSchema.safeParse(descriptor).success).toBe(true)
    for (const endpoint of [
      "https://127.0.0.1:43115/__vibeshape/native-mcp",
      "http://localhost:43115/__vibeshape/native-mcp",
      "http://127.0.0.1:80/__vibeshape/native-mcp",
      "http://127.0.0.1:65536/__vibeshape/native-mcp",
      "http://127.0.0.1:01024/__vibeshape/native-mcp",
      "http://secret@127.0.0.1:43115/__vibeshape/native-mcp",
      "http://127.0.0.1:43115/__vibeshape/native-mcp?token=secret",
      "http://127.0.0.1:43115/__vibeshape/native-mcp#fragment",
      "http://127.0.0.1:43115/__vibeshape/%6eative-mcp",
      "http://127.0.0.1:43115/another-path",
    ])
      expect(desktopMcpDescriptorSchema.safeParse({ ...descriptor, endpoint }).success).toBe(false)
  })
  it("rejects extra fields and credentials outside the fixed token representation", () => {
    expect(desktopMcpDescriptorSchema.safeParse({ ...descriptor, secret: "extra" }).success).toBe(
      false,
    )
    expect(
      desktopMcpDescriptorSchema.safeParse({ ...descriptor, token: "untrusted" }).success,
    ).toBe(false)
  })
})
