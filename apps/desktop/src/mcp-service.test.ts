import { afterEach, describe, expect, it } from "bun:test"
import { once } from "node:events"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { AssistantQuestionReply } from "@vibeshape/automation-api/assistant"
import { DESKTOP_MCP_DESCRIPTOR_NAME } from "@vibeshape/automation-api/desktop-host"
import { localFailureSchema } from "@vibeshape/automation-api/local-tools"
import type { AssistantQuestionHost } from "@vibeshape/mcp-server/local-host"
import { z } from "zod"
import { vi } from "../../../tests/unit/support/bun-test"
import { startEditorServer } from "./editor-server"
import { publishMcpDescriptor, readMcpDescriptor } from "./mcp-descriptor"
import { createDesktopMcpService } from "./mcp-service"
import { preparePrivateDirectory } from "./private-files"

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function host() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-native-mcp-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const directory = process.platform === "win32" ? join(root, "private") : root
  if (process.platform === "win32") preparePrivateDirectory(directory)
  const editor = join(directory, "editor")
  await mkdir(editor)
  await writeFile(
    join(editor, "index.html"),
    "<html><head></head><body>Existing editor</body></html>",
  )
  const reserve = createServer()
  reserve.listen(0, "127.0.0.1")
  await once(reserve, "listening")
  const address = reserve.address()
  if (!address || typeof address === "string") throw new Error("Missing isolated test port.")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => reserve.close(() => resolve()))
  const service = createDesktopMcpService(origin)
  const http = await startEditorServer(editor, { origin, mcp: service })
  cleanups.push(() => http.close())
  const descriptorPath = join(directory, DESKTOP_MCP_DESCRIPTOR_NAME)
  await service.publish(descriptorPath)
  const descriptor = await readMcpDescriptor(descriptorPath)
  const headers = {
    Authorization: `Bearer ${descriptor.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  }
  return { directory, origin, service, http, descriptorPath, descriptor, headers }
}

async function connect(context: Awaited<ReturnType<typeof host>>, name = "native-test") {
  const client = new Client({ name, version: "1.0" })
  const transport = new StreamableHTTPClientTransport(new URL(context.descriptor.endpoint), {
    requestInit: { headers: context.headers },
  })
  cleanups.push(() => client.close())
  await client.connect(transport as Transport)
  return { client, transport }
}

async function project(
  context: Awaited<ReturnType<typeof host>>,
  id: string,
  questions?: AssistantQuestionHost,
) {
  const path = await context.service.publishProject(
    id,
    join(context.directory, `${id}.json`),
    questions,
  )
  const descriptor = await readMcpDescriptor(path)
  const attached = await connect(
    {
      ...context,
      descriptor,
      headers: { ...context.headers, Authorization: `Bearer ${descriptor.token}` },
    },
    id,
  )
  return { ...attached, descriptor }
}

function initialization() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "replacement", version: "1" },
    },
  }
}

function browser(
  context: Awaited<ReturnType<typeof host>>,
  route = "status",
  body: unknown = {},
  projectId?: string,
  token?: string,
) {
  return fetch(`${context.origin}/__vibeshape/automation/${route}`, {
    method: "POST",
    headers: {
      Origin: context.origin,
      "Content-Type": "application/json",
      ...(projectId ? { "X-VibeShape-Project": projectId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("app-owned native MCP attachment", () => {
  const projectId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
  const document = { id: projectId, name: "Open project", revision: 4 }

  it("reports retryable project discovery before registration without granting access", async () => {
    const context = await host()
    const unavailable = await browser(context, "status", {}, projectId)
    expect(unavailable.status).toBe(404)
    expect(await unavailable.json()).toEqual({
      ok: false,
      diagnostic: {
        code: "project-session-unavailable",
        message: "This project's native assistant is not connected.",
        retryable: true,
      },
    })
    await project(context, projectId)
    expect(await (await browser(context, "status", {}, projectId)).json()).toEqual({
      protocolVersion: 1,
      client: { name: projectId, version: "1.0" },
      paired: false,
    })
  })

  it("discovers and invokes native questions without ACP elicitation and rejects superseded transport callbacks", async () => {
    const context = await host()
    let calls = 0
    let waiting = false
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    let answer!: (reply: AssistantQuestionReply) => void
    const questions: AssistantQuestionHost = {
      canInvoke: () => !waiting,
      request: async (_input, signal) => {
        calls += 1
        waiting = true
        started()
        return new Promise<AssistantQuestionReply>((resolve) => {
          answer = resolve
          signal.addEventListener("abort", () => resolve({ action: "cancel" }), { once: true })
        })
      },
    }
    const native = await project(context, projectId, questions)
    // Discover over HTTP without compiling every CAD output schema on the server's test loop.
    expect(
      (await native.client.request({ method: "tools/list" }, ListToolsResultSchema)).tools,
    ).toContainEqual(expect.objectContaining({ name: "ask_user_question" }))
    const input = {
      message: "Choose a size",
      fields: [{ id: "size", label: "Size", required: true }],
    }
    let completed = false
    const call = native.client
      .callTool({ name: "ask_user_question", arguments: input })
      .then((result) => {
        completed = true
        return result
      })
    await began
    expect(completed).toBe(false)
    const blocked = await native.client.callTool({ name: "model_info", arguments: {} })
    expect(blocked).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "assistant-question-blocked" } } },
    })
    const failure = z
      .object({ result: localFailureSchema })
      .strict()
      .parse(blocked.structuredContent)
    expect(failure.result.diagnostic.code).toBe("assistant-question-blocked")
    const replacement: AssistantQuestionHost = {
      canInvoke: () => true,
      request: async () => ({ action: "accept", content: { size: "20 mm" } }),
    }
    await context.service.publishProject(
      projectId,
      join(context.directory, `${projectId}.json`),
      replacement,
    )
    expect(await call).toMatchObject({ isError: true, structuredContent: { action: "cancel" } })
    answer({ action: "accept", content: { size: "stale answer" } })
    expect(
      await native.client.callTool({ name: "ask_user_question", arguments: input }),
    ).toMatchObject({ isError: true, structuredContent: { action: "cancel" } })
    expect(calls).toBe(1)
    await native.client.close()
    await context.service.whenClientReleased(projectId)
    const current = await project(context, projectId, replacement)
    expect(
      await current.client.callTool({ name: "ask_user_question", arguments: input }),
    ).toMatchObject({
      isError: false,
      structuredContent: { action: "accept", content: { size: "20 mm" } },
    })
    const external = await connect(context)
    expect(
      (await external.client.request({ method: "tools/list" }, ListToolsResultSchema)).tools.some(
        (tool) => tool.name === "ask_user_question",
      ),
    ).toBe(false)
  })

  async function grant(context: Awaited<ReturnType<typeof host>>) {
    const response = await browser(context, "connect", { protocolVersion: 1, document }, projectId)
    expect(response.status).toBe(200)
    return (await response.json()) as { token: string }
  }
  async function poll(context: Awaited<ReturnType<typeof host>>, token: string, sequence = 1) {
    const response = await browser(
      context,
      "poll",
      { protocolVersion: 1, sequence, document, progress: null },
      projectId,
      token,
    )
    expect(response.status).toBe(200)
    return (await response.json()) as {
      work: { requestId: string; operation: { tool: string } } | null
    }
  }

  it("pairs the connected assistant before lazy MCP initialization and preserves its grant on first use", async () => {
    const context = await host()
    const questions: AssistantQuestionHost = {
      canInvoke: () => true,
      request: async () => ({ action: "cancel" }),
    }
    const path = await context.service.publishProject(
      projectId,
      join(context.directory, `${projectId}.json`),
      questions,
    )
    expect(context.service.isClientAttached(projectId)).toBe(false)
    expect(await (await browser(context, "status", {}, projectId)).json()).toMatchObject({
      client: { name: "VibeShape assistant", version: "1" },
      paired: false,
    })
    const credential = await grant(context)
    const descriptor = await readMcpDescriptor(path)
    const native = await connect(
      {
        ...context,
        descriptor,
        headers: { ...context.headers, Authorization: `Bearer ${descriptor.token}` },
      },
      "lazy-provider",
    )
    expect(await (await browser(context, "status", {}, projectId)).json()).toMatchObject({
      paired: true,
    })
    const pending = native.client.callTool({ name: "model_info", arguments: {} })
    let delivered = await poll(context, credential.token)
    let sequence = 1
    await vi.waitFor(async () => {
      if (!delivered.work) delivered = await poll(context, credential.token, ++sequence)
      expect(delivered.work?.operation.tool).toBe("model_info")
    })
    await browser(context, "revoke", {}, projectId, credential.token)
    expect(await pending).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "session-revoked" } } },
    })
    expect(await native.client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
  })

  it("releases lazy reservations by captured assistant owner and ignores a stale disconnect", async () => {
    const context = await host()
    const first: AssistantQuestionHost = {
      canInvoke: () => true,
      request: async () => ({ action: "cancel" }),
    }
    const second: AssistantQuestionHost = { ...first }
    const path = join(context.directory, `${projectId}.json`)
    await context.service.publishProject(projectId, path, first)
    const old = await grant(context)
    await context.service.publishProject(projectId, path, second)
    expect(
      (
        await browser(
          context,
          "poll",
          { protocolVersion: 1, sequence: 1, document, progress: null },
          projectId,
          old.token,
        )
      ).status,
    ).toBe(401)
    const current = await grant(context)
    context.service.releaseProject(projectId, first)
    expect(await (await browser(context, "status", {}, projectId)).json()).toMatchObject({
      paired: true,
    })
    expect((await poll(context, current.token)).work).toBeNull()
    context.service.releaseProject(projectId, second)
    expect(await (await browser(context, "status", {}, projectId)).json()).toMatchObject({
      client: null,
      paired: false,
    })
  })

  it("waits for the initial native identity read to pair normally and executes it only once", async () => {
    const context = await host()
    const native = await project(context, projectId)
    expect(native.client.getInstructions()).toContain(
      "automatically connects this embedded assistant",
    )
    const pending = native.client.callTool({ name: "model_info", arguments: {} })
    // Let the tool reach the unpaired attachment before the renderer's discovery/connect request.
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    const secondId = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"
    await project(context, secondId)
    const secondDocument = { id: secondId, name: "Other project", revision: 0 }
    const secondGrant = (await (
      await browser(context, "connect", { protocolVersion: 1, document: secondDocument }, secondId)
    ).json()) as { token: string }
    expect(
      await (
        await browser(
          context,
          "poll",
          { protocolVersion: 1, sequence: 1, document: secondDocument, progress: null },
          secondId,
          secondGrant.token,
        )
      ).json(),
    ).toMatchObject({ work: null })
    const credential = await grant(context)
    let delivered = await poll(context, credential.token)
    let sequence = 1
    await vi.waitFor(async () => {
      if (!delivered.work) delivered = await poll(context, credential.token, ++sequence)
      expect(delivered.work?.operation.tool).toBe("model_info")
    })
    const result = {
      ok: true,
      value: {
        summary: {
          kind: "org.vibeshape.document.summary",
          schemaVersion: 1,
          documentId: projectId,
          revision: 4,
          classification: "semantic",
          truncated: false,
          data: {
            name: "Open project",
            createdAt: "2026-10-19T00:00:00.000Z",
            updatedAt: "2026-10-19T00:00:00.000Z",
          },
        },
        measurements: null,
        measurementDiagnostic: null,
      },
    }
    expect(
      (
        await browser(
          context,
          "result",
          {
            protocolVersion: 1,
            requestId: delivered.work?.requestId,
            tool: "model_info",
            result,
          },
          projectId,
          credential.token,
        )
      ).status,
    ).toBe(200)
    expect(await pending).toMatchObject({ isError: false, structuredContent: { result } })
    expect((await poll(context, credential.token, ++sequence)).work).toBeNull()

    await browser(context, "revoke", {}, projectId, credential.token)
    expect(
      await native.client.callTool({ name: "model_info", arguments: {} }, undefined, {
        timeout: 500,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
    const replacement = await grant(context)
    expect((await poll(context, replacement.token)).work).toBeNull()
  })

  it(
    "bounds an initial native read and never queues it for a later grant",
    async () => {
      const context = await host()
      const native = await project(context, projectId)
      expect(
        await native.client.callTool({ name: "model_info", arguments: {} }, undefined, {
          timeout: 7000,
        }),
      ).toMatchObject({
        isError: true,
        structuredContent: { result: { diagnostic: { code: "not-paired", retryable: true } } },
      })
      const credential = await grant(context)
      expect((await poll(context, credential.token)).work).toBeNull()
    },
    process.platform === "win32" ? 120_000 : 9000,
  )

  it.each(["abort", "client-close", "service-close"])(
    "cancels native identity readiness on %s without leaking into a later owner",
    async (action) => {
      const context = await host()
      const native = await project(context, projectId)
      const controller = new AbortController()
      const pending = native.client
        .callTool({ name: "model_info", arguments: {} }, undefined, { signal: controller.signal })
        .then(
          (result) => result.isError === true,
          () => true,
        )
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
      if (action === "abort") controller.abort()
      else if (action === "client-close") {
        const released = context.service.whenClientReleased(projectId)
        await native.client.close()
        await released
      } else {
        await context.service.close()
        // Server shutdown ends authority; the SDK client also needs its ordinary owner teardown.
        await native.client.close()
      }
      expect(await pending).toBe(true)
      if (action === "service-close") return
      if (action === "client-close") await project(context, projectId)
      const credential = await grant(context)
      expect((await poll(context, credential.token)).work).toBeNull()
    },
  )

  it("does not defer a native write before the first grant", async () => {
    const context = await host()
    const native = await project(context, projectId)
    expect(
      await native.client.callTool(
        { name: "create_draft", arguments: { baseRevision: 4 } },
        undefined,
        { timeout: 500 },
      ),
    ).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
    const credential = await grant(context)
    expect((await poll(context, credential.token)).work).toBeNull()
  })

  it("isolates simultaneous native project clients, consent, pending tools and revocation", async () => {
    const context = await host()
    const firstId = "0195b5ac-b220-7a2c-8c33-67a36a7f6101"
    const secondId = "0195b5ac-b220-7a2c-8c33-67a36a7f6102"
    const first = await project(context, firstId)
    const second = await project(context, secondId)
    expect(first.descriptor.token).not.toBe(second.descriptor.token)
    const document = (id: string) => ({ id, name: id, revision: 0 })
    expect(
      (
        await browser(
          context,
          "connect",
          {
            protocolVersion: 1,
            document: document(secondId),
          },
          firstId,
        )
      ).status,
    ).toBe(409)
    const firstGrant = (await (
      await browser(
        context,
        "connect",
        {
          protocolVersion: 1,
          document: document(firstId),
        },
        firstId,
      )
    ).json()) as { token: string }
    await browser(
      context,
      "connect",
      {
        protocolVersion: 1,
        document: document(secondId),
      },
      secondId,
    )
    expect(await (await browser(context, "status", {}, firstId)).json()).toMatchObject({
      paired: true,
    })
    expect(await (await browser(context, "status", {}, secondId)).json()).toMatchObject({
      paired: true,
    })
    const pending = first.client.callTool({ name: "model_info", arguments: {} })
    const polled = (await (
      await browser(
        context,
        "poll",
        {
          protocolVersion: 1,
          sequence: 1,
          document: document(firstId),
          progress: null,
        },
        firstId,
        firstGrant.token,
      )
    ).json()) as { work: { operation: { tool: string } } | null }
    // A client may enqueue just after the first heartbeat; another heartbeat delivers its own work.
    if (!polled.work) await new Promise<void>((resolve) => setTimeout(resolve, 10))
    const delivered =
      polled.work ??
      (
        (await (
          await browser(
            context,
            "poll",
            {
              protocolVersion: 1,
              sequence: 2,
              document: document(firstId),
              progress: null,
            },
            firstId,
            firstGrant.token,
          )
        ).json()) as { work: { operation: { tool: string } } }
      ).work
    expect(delivered.operation.tool).toBe("model_info")
    expect(
      await second.client.callTool({ name: "model_info", arguments: { projectId: firstId } }),
    ).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "project-target-mismatch" } } },
    })
    const released = context.service.whenClientReleased(firstId)
    await browser(context, "revoke", {}, firstId, firstGrant.token)
    expect(await pending).toMatchObject({ isError: true })
    await first.client.close()
    await released
    expect(context.service.isClientAttached(firstId)).toBe(false)
    expect(context.service.isClientAttached(secondId)).toBe(true)
    expect(await (await browser(context, "status", {}, secondId)).json()).toMatchObject({
      paired: true,
    })
    expect(await (await browser(context)).json()).toMatchObject({ paired: false, client: null })
  })

  it("discovers existing tools before document access, reserves one client and revokes it when its stream closes", async () => {
    const context = await host()
    if (process.platform !== "win32")
      expect((await lstat(context.descriptorPath)).mode & 0o777).toBe(0o600)
    expect(await (await fetch(context.origin)).text()).toContain(
      'name="vibeshape-local-automation"',
    )
    const { client } = await connect(context)
    expect(client.getInstructions()).toContain(
      "automatically connects this authenticated local client",
    )
    const released = context.service.whenClientReleased()
    let detached = false
    void released.then(() => {
      detached = true
    })
    expect(context.service.isClientAttached()).toBe(true)
    expect(
      (await client.request({ method: "tools/list" }, ListToolsResultSchema)).tools.some(
        (tool) => tool.name === "model_info",
      ),
    ).toBe(true)
    expect((await client.readResource({ uri: "vibeshape://session" })).contents[0]).toMatchObject({
      text: JSON.stringify({ schemaVersion: 1, editorUrl: context.origin, paired: false }),
    })
    expect(await client.callTool({ name: "model_info", arguments: {} })).toMatchObject({
      isError: true,
      structuredContent: { result: { diagnostic: { code: "not-paired" } } },
    })
    const denied = await fetch(context.descriptor.endpoint, {
      method: "POST",
      headers: context.headers,
      body: JSON.stringify(initialization()),
    })
    expect(denied.status).toBe(409)
    expect(detached).toBe(false)
    const grant = await browser(context, "connect", {
      protocolVersion: 1,
      document: { id: "0195b5ac-b220-7a2c-8c33-67a36a7f6101", name: "Open project", revision: 4 },
    })
    expect(grant.status).toBe(200)
    expect(await (await browser(context)).json()).toMatchObject({
      client: { name: "native-test" },
      paired: true,
    })
    await client.close()
    await released
    expect(detached).toBe(true)
    await vi.waitFor(async () =>
      expect(await (await browser(context)).json()).toMatchObject({ client: null, paired: false }),
    )
    const replacement = await connect(context, "next-client")
    await released
    expect(context.service.isClientAttached()).toBe(true)
    expect(
      (await replacement.client.request({ method: "tools/list" }, ListToolsResultSchema)).tools
        .length,
    ).toBeGreaterThan(0)
    await context.http.close()
    await expect(readFile(context.descriptorPath)).rejects.toThrow()
  })

  it("denies missing tokens, browser origins and oversized input without claiming a client", async () => {
    const context = await host()
    for (const headers of [
      { "Content-Type": "application/json" },
      { ...context.headers, Origin: context.origin },
      { ...context.headers, Origin: "null" },
      { ...context.headers, Host: "attacker.invalid" },
    ]) {
      const result = await fetch(context.descriptor.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(initialization()),
      })
      expect(result.status).toBe(403)
    }
    const oversized = await fetch(context.descriptor.endpoint, {
      method: "POST",
      headers: context.headers,
      body: "x".repeat(256 * 1024 + 1),
    })
    expect(oversized.status).toBe(413)
    expect(await (await browser(context)).json()).toMatchObject({ client: null, paired: false })
    expect(
      (
        await (
          await connect(context)
        ).client.request({ method: "tools/list" }, ListToolsResultSchema)
      ).tools.length,
    ).toBeGreaterThan(0)
  })

  it.skipIf(process.platform === "win32")(
    "reads only private POSIX descriptors and never follows symlinks",
    async () => {
      const context = await host()
      const link = join(context.directory, "linked.json")
      await symlink(context.descriptorPath, link)
      await expect(readMcpDescriptor(link)).rejects.toThrow()
      await chmod(context.descriptorPath, 0o644)
      await expect(readMcpDescriptor(context.descriptorPath)).rejects.toThrow("private file")
      await chmod(context.descriptorPath, 0o600)
    },
  )

  it("refuses oversized descriptors", async () => {
    const context = await host()
    await writeFile(context.descriptorPath, "x".repeat(4097))
    await expect(readMcpDescriptor(context.descriptorPath)).rejects.toThrow()
  })

  it("does not remove a descriptor replaced by another launch", async () => {
    const context = await host()
    const remove = await publishMcpDescriptor(context.descriptorPath, {
      ...context.descriptor,
      token: "a".repeat(64),
    })
    await context.http.close()
    expect((await readMcpDescriptor(context.descriptorPath)).token).toBe("a".repeat(64))
    await remove()
    await expect(readFile(context.descriptorPath)).rejects.toThrow()
  })
})
