import "../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { localModelInfoSchema } from "@vibeshape/automation-api/local-tools"
import { recoveryFixture } from "../../../../packages/automation-host/src/draft-recovery.test-fixtures"
import { vi } from "../../../../tests/unit/support/bun-test"
import { readMcpDescriptor } from "../../../desktop/src/mcp-descriptor"
import { createDesktopMcpService } from "../../../desktop/src/mcp-service"
import { createTestBrowserStorage } from "../test-support/browser-storage"
import { createDocumentAutomationSession } from "./document-automation-session"

mock.module("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: vi.fn(),
  createAutomationProject: vi.fn(),
  listLocalProjects: vi.fn(),
  openAutomationProject: vi.fn(),
}))
const { createLocalAutomationConnection } = await import("./local-automation-connection")
const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

it("serves the first descriptor-authenticated model_info through automatic renderer discovery with manual Apply", async () => {
  vi.stubGlobal("localStorage", createTestBrowserStorage())
  sessionStorage.clear()
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  const root = await mkdtemp(join(tmpdir(), "vibeshape-desktop-access-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing isolated test port.")
  const origin = `http://127.0.0.1:${address.port}`
  const service = createDesktopMcpService(origin)
  server.on("request", async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const headers = new Headers()
    for (let index = 0; index < request.rawHeaders.length; index += 2)
      headers.append(request.rawHeaders[index] ?? "", request.rawHeaders[index + 1] ?? "")
    const incoming = new Request(`${origin}${request.url}`, {
      method: request.method ?? "GET",
      headers,
      ...(request.method === "POST" ? { body: Buffer.concat(chunks).toString() } : {}),
    })
    await service.handle(request, response, incoming)
  })
  cleanups.push(async () => {
    await service.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const descriptorPath = join(root, "desktop-mcp.json")
  await service.publish(descriptorPath)
  const descriptor = await readMcpDescriptor(descriptorPath)
  const nativeFetch = globalThis.fetch
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof input !== "string" || !input.startsWith("/__vibeshape/automation/"))
      return nativeFetch(input, init)
    return service.handleBrowser(
      new Request(`${origin}${input}`, {
        ...init,
        headers: { ...init?.headers, origin, host: new URL(origin).host },
      }),
    )
  })
  const client = new Client({ name: "External desktop test", version: "1" })
  cleanups.push(() => client.close())
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
  })
  await client.connect(transport as Transport)
  expect(client.getInstructions()).toContain("Model changes require manual Apply")
  expect(client.getInstructions()).not.toContain("authorizes validated model commits")
  const fixture = recoveryFixture()
  const createSession = vi.fn()
  createSession.mockImplementation(() => {
    const session = createDocumentAutomationSession({
      commands: fixture.commands,
      modules: fixture.modules,
      documents: fixture.documents,
      createDraftId: fixture.generate,
    })
    if (!session.ok) return session
    return {
      ...session,
      documentId: fixture.saved.id,
      revision: 4,
      readIdentity: () => ({ id: fixture.saved.id, name: fixture.saved.name, revision: 4 }),
      readInfo: () =>
        localModelInfoSchema.parse({
          summary: {
            kind: "org.vibeshape.document.summary",
            schemaVersion: 1,
            documentId: fixture.saved.id,
            revision: 4,
            classification: "semantic",
            truncated: false,
            data: {
              name: fixture.saved.name,
              createdAt: "2026-10-23T00:00:00.000Z",
              updatedAt: "2026-10-23T00:00:00.000Z",
            },
          },
          measurements: null,
          measurementDiagnostic: null,
        }),
      readCad: vi.fn(),
      exportRevisionBound: vi.fn(),
    }
  })
  const connection = createLocalAutomationConnection({
    accessPolicy: "desktop-external",
    createDocumentSession: createSession,
  })
  cleanups.push(async () => {
    await connection.disable()
    connection.dispose()
  })
  const pending = client.callTool({ name: "model_info", arguments: {} })
  connection.start()
  await connection.status()
  expect(await pending).toMatchObject({
    isError: false,
    structuredContent: {
      result: { ok: true, value: { summary: { documentId: fixture.saved.id } } },
    },
  })
  expect(createSession).toHaveBeenCalledWith()
  expect(connection.getSnapshot()).toMatchObject({
    connected: true,
    autoApply: false,
    projectManagement: false,
    defaultAccess: true,
  })
  await connection.disable()
  expect(
    await client.callTool({ name: "model_info", arguments: {} }, undefined, { timeout: 500 }),
  ).toMatchObject({
    isError: true,
    structuredContent: { result: { diagnostic: { code: "not-paired" } } },
  })
}, 15000)
