import { afterEach, describe, expect, it } from "bun:test"
import { IMPORT_UPLOAD_CHUNK_MAX_BYTES } from "@vibeshape/automation-api/imports"
import {
  localConnectResponseSchema,
  localPollResponseSchema,
} from "@vibeshape/automation-api/local-session"
import {
  type LocalToolResult,
  localOperationSchema,
  localToolOutputs,
} from "@vibeshape/automation-api/local-tools"
import { modelVariableUsageViewSchema } from "@vibeshape/automation-api/queries"
import {
  lightweightingMaterialCatalogResult,
  lightweightingOperation,
} from "../../../packages/automation-api/src/lightweighting.test-fixtures"
import {
  printOptimizationOperation,
  printOptimizationValue,
} from "../../../packages/automation-api/src/print-optimization.test-fixtures"
import {
  quickLightweightingOperation,
  quickLightweightingValue,
} from "../../../packages/automation-api/src/quick-lightweighting.test-fixtures"
import { nativeImportInspection } from "../../../tests/support/native-import-inspection"
import { vi } from "../../../tests/unit/support/bun-test"
import { createBrowserBroker } from "./browser-broker"

const origin = "http://127.0.0.1:43114"
const document = {
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f6101",
  name: "Bracket",
  revision: 4,
}
const brokers: Array<ReturnType<typeof createBrowserBroker>> = []

function makeBroker(options: Parameters<typeof createBrowserBroker>[0]) {
  const broker = createBrowserBroker(options)
  brokers.push(broker)
  return broker
}

afterEach(() => {
  for (const broker of brokers.splice(0)) broker.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function request(path: string, body: unknown, token?: string, requestOrigin = origin) {
  return new Request(`${origin}/__vibeshape/automation/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      host: "127.0.0.1:43114",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function connect(broker: ReturnType<typeof createBrowserBroker>) {
  broker.setClient({ name: "test-client", version: "1.0" })
  const response = await broker.handle(request("connect", { protocolVersion: 1, document }))
  return (await response.json()) as { token: string }
}

describe("browser automation broker", () => {
  it("accepts fast numerical receipts then correlates job controls and completed evidence", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const jobId = "0195b5ac-b220-7a2c-8c33-000000000030"
    const value = {
      jobId,
      tool: "request_quick_lightweighting",
      documentId: document.id,
      baseRevision: 4,
      status: "running",
    }
    let sequence = 0
    const dispatch = async (operation: Parameters<typeof broker.invoke>[0]) => {
      const pending = broker.invoke(operation)
      const poll = await broker.handle(
        request(
          "poll",
          { protocolVersion: 1, sequence: ++sequence, document, progress: null },
          token,
        ),
      )
      const { work } = localPollResponseSchema.parse(await poll.json())
      if (!work) throw new Error("Expected numerical job work.")
      const respond = (output: unknown) =>
        broker.handle(
          request(
            "result",
            {
              protocolVersion: 1,
              requestId: work.requestId,
              tool: operation.tool,
              result: { ok: true, value: output },
            },
            token,
          ),
        )
      return { pending, respond }
    }
    const started = await dispatch(quickLightweightingOperation(true))
    for (const patch of [
      { baseRevision: 3 },
      { documentId: "0195b5ac-b220-7a2c-8c33-000000000099" },
      { tool: "analyze_quick_lightweighting" },
    ])
      expect((await started.respond({ ...value, ...patch })).status).toBe(400)
    expect((await started.respond(value)).status).toBe(200)
    await expect(started.pending).resolves.toEqual(
      localToolOutputs.request_quick_lightweighting.parse({ ok: true, value }),
    )

    for (const tool of ["get_numerical_job", "cancel_numerical_job"] as const) {
      const control = await dispatch(localOperationSchema.parse({ tool, arguments: { jobId } }))
      const status = {
        ...value,
        status: tool === "get_numerical_job" ? "running" : "cancelling",
        result: null,
      }
      for (const patch of [
        { jobId: "0195b5ac-b220-7a2c-8c33-000000000099" },
        { documentId: "0195b5ac-b220-7a2c-8c33-000000000099" },
      ])
        expect((await control.respond({ ...status, ...patch })).status).toBe(400)
      expect((await control.respond(status)).status).toBe(200)
      await expect(control.pending).resolves.toEqual(
        localToolOutputs[tool].parse({ ok: true, value: status }),
      )
    }
    const finished = await dispatch(
      localOperationSchema.parse({ tool: "get_numerical_job", arguments: { jobId } }),
    )
    const original = quickLightweightingValue(true)
    const result = {
      ok: true,
      value: {
        ...original,
        documentId: document.id,
        snapshot: { ...original.snapshot, documentId: document.id },
      },
    }
    const completed = { ...value, status: "completed", result }
    expect(
      (
        await finished.respond({
          ...completed,
          result: { ...result, value: { ...result.value, baseRevision: 3 } },
        })
      ).status,
    ).toBe(400)
    expect((await finished.respond(completed)).status).toBe(200)
    await expect(finished.pending).resolves.toEqual(
      localToolOutputs.get_numerical_job.parse({ ok: true, value: completed }),
    )
  })

  it("binds variable usage response identity and paging to the paired saved document", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const variableId = "0195b5ac-b220-7a2c-8c33-000000000001"
    const operation = localOperationSchema.parse({
      tool: "model_variable_usage",
      arguments: { revision: 4, variableId },
    })
    const pending = broker.invoke(operation)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = localPollResponseSchema.parse(await poll.json())
    if (!work) throw new Error("Expected variable usage inspection.")
    const value = modelVariableUsageViewSchema.parse({
      kind: "org.vibeshape.cad.variable-usage",
      schemaVersion: 1,
      documentId: document.id,
      revision: 4,
      variableId,
      variableName: "root",
      transitive: false,
      classification: "semantic",
      nextCursor: null,
      data: { coverage: "complete", total: 0, items: [], diagnosticTotal: 0, diagnostics: [] },
    })
    const respond = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: operation.tool,
            result: { ok: true, value },
          },
          token,
        ),
      )
    for (const change of [
      { documentId: "0195b5ac-b220-7a2c-8c33-000000000099" },
      { revision: 3 },
      { variableId: "0195b5ac-b220-7a2c-8c33-000000000002" },
      { transitive: true },
      { nextCursor: "1" },
    ])
      expect((await respond({ ...value, ...change })).status).toBe(400)
    expect((await respond(value)).status).toBe(200)
    await expect(pending).resolves.toEqual({ ok: true, value })
  })

  it("accepts a validated material catalog without requiring a draft or document receipt", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const { value: catalog } = lightweightingMaterialCatalogResult()
    const operation = localOperationSchema.parse({
      tool: "list_lightweighting_materials",
      arguments: {},
    })
    const pending = broker.invoke(operation)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = localPollResponseSchema.parse(await poll.json())
    if (!work) throw new Error("Expected a material catalog operation.")
    const respond = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: operation.tool,
            result: { ok: true, value },
          },
          token,
        ),
      )
    expect((await respond({ ...catalog, presets: [] })).status).toBe(400)
    expect((await respond(catalog)).status).toBe(200)
    await expect(pending).resolves.toEqual({ ok: true, value: catalog })
    expect(broker.isPaired()).toBe(true)
    const next = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 2, document, progress: null }, token),
    )
    expect(next.status).toBe(200)
  })

  it.each([false, true])(
    "binds exact print results and rejects forged verification (request=%s)",
    async (snapshot) => {
      const broker = makeBroker({ origin })
      const { token } = await connect(broker)
      const operation = printOptimizationOperation(snapshot)
      const base = printOptimizationValue(snapshot)
      const value = {
        ...base,
        documentId: document.id,
        ...(snapshot ? { snapshot: { ...base.snapshot, documentId: document.id } } : {}),
      }
      const pending = broker.invoke(operation)
      const poll = await broker.handle(
        request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
      )
      const { work } = localPollResponseSchema.parse(await poll.json())
      if (!work) throw new Error("Expected exact print work.")
      const respond = (output: unknown) =>
        broker.handle(
          request(
            "result",
            {
              protocolVersion: 1,
              requestId: work.requestId,
              tool: operation.tool,
              result: { ok: true, value: output },
            },
            token,
          ),
        )
      const exact = value.summary.exact
      if (!exact) throw new Error("Expected exact evidence.")
      expect(
        (
          await respond({
            ...value,
            summary: { ...value.summary, exact: { ...exact, preservedFaceCount: 0 } },
          })
        ).status,
      ).toBe(400)
      expect((await respond(value)).status).toBe(200)
      expect(await pending).toMatchObject({ ok: true, value })
    },
  )

  it.each([false, true])(
    "accepts quick evidence only for captured source/settings/snapshot (request=%s)",
    async (requestSnapshot) => {
      vi.useFakeTimers()
      const broker = makeBroker({ origin })
      const { token } = await connect(broker)
      const operation = localOperationSchema.parse(quickLightweightingOperation(requestSnapshot))
      const value = {
        ...quickLightweightingValue(requestSnapshot),
        documentId: document.id,
        ...(requestSnapshot
          ? { snapshot: { ...quickLightweightingValue(true).snapshot, documentId: document.id } }
          : {}),
      }
      const pending = broker.invoke(operation)
      const poll = await broker.handle(
        request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
      )
      const { work } = localPollResponseSchema.parse(await poll.json())
      if (!work) throw new Error("Expected quick lightweighting work.")
      for (let sequence = 2; sequence <= 62; sequence += 1) {
        await vi.advanceTimersByTimeAsync(10_000)
        const heartbeat = await broker.handle(
          request("poll", { protocolVersion: 1, sequence, document, progress: null }, token),
        )
        expect(heartbeat.status).toBe(200)
      }
      expect(broker.isPaired()).toBe(true)
      const respond = (output: unknown) =>
        broker.handle(
          request(
            "result",
            {
              protocolVersion: 1,
              requestId: work.requestId,
              tool: operation.tool,
              result: { ok: true, value: output },
            },
            token,
          ),
        )
      expect(
        (await respond({ ...value, source: { ...value.source, contentHash: "b".repeat(64) } }))
          .status,
      ).toBe(400)
      expect(
        (await respond({ ...value, summary: { ...value.summary, requestedRemovalPercent: 36 } }))
          .status,
      ).toBe(400)
      expect((await respond(value)).status).toBe(200)
      await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
      expect(broker.isPaired()).toBe(true)
    },
  )

  it("moves pairing only after an exact project transition receipt and rejects old target guards", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const target = { id: "0195b5ac-b220-7a2c-8c33-67a36a7f6102", name: "Target", revision: 2 }
    const pending = broker.invoke(
      localOperationSchema.parse({
        tool: "open_project",
        arguments: {
          expectedProjectId: document.id,
          expectedRevision: document.revision,
          projectId: target.id,
        },
      }),
    )
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = (await poll.json()) as { work: { requestId: string } }
    const respond = (projectId: string) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "open_project",
            result: {
              ok: true,
              value: { projectId, name: target.name, revision: target.revision },
            },
          },
          token,
        ),
      )
    expect((await respond(document.id)).status).toBe(400)
    expect((await respond(target.id)).status).toBe(200)
    await expect(pending).resolves.toMatchObject({ ok: true, value: { projectId: target.id } })
    expect((await respond(target.id)).status).toBe(200)
    const next = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 2, document: target, progress: null }, token),
    )
    expect(next.status).toBe(200)
    await expect(
      broker.invoke(
        localOperationSchema.parse({ tool: "model_info", projectId: document.id, arguments: {} }),
      ),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "project-target-mismatch" } })
    await expect(
      broker.invoke(
        localOperationSchema.parse({
          tool: "open_project",
          arguments: { expectedProjectId: document.id, expectedRevision: 4, projectId: target.id },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-project" } })
  })

  it("rejects forged history document, base, direction and command receipts before forwarding the exact save", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const commandId = "0195b5ac-b260-7a2c-8c33-000000000777"
    const pending = broker.invoke(
      localOperationSchema.parse({
        tool: "undo_model",
        arguments: { documentId: document.id, baseRevision: 4, commandId },
      }),
    )
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = (await poll.json()) as { work: { requestId: string } }
    const exact = {
      documentId: document.id,
      baseRevision: 4,
      revision: 5,
      commandId,
      direction: "undo",
      targetRevision: 3,
    }
    const respond = (value: typeof exact) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "undo_model",
            result: { ok: true, value },
          },
          token,
        ),
      )
    for (const forged of [
      { ...exact, documentId: commandId },
      { ...exact, baseRevision: 3, revision: 4 },
      { ...exact, direction: "redo" },
      { ...exact, commandId: document.id },
    ]) {
      const response = await respond(forged)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        diagnostic: { code: "result-context-mismatch" },
      })
    }
    expect((await respond(exact)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: exact })
  })
  it("binds surface texture read receipts to the paired document, revision and feature", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const featureId = "0195b5ac-b220-7a2c-8c33-000000000001"
    const pending = broker.invoke(
      localOperationSchema.parse({
        tool: "model_surface_textures",
        arguments: { revision: document.revision, featureId },
      }),
    )
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = (await poll.json()) as { work: { requestId: string } }
    const value = {
      schemaVersion: 1,
      documentId: document.id,
      revision: document.revision,
      featureId,
      layers: [],
    }
    const respond = (patch: Record<string, unknown> = {}) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_surface_textures",
            result: { ok: true, value: { ...value, ...patch } },
          },
          token,
        ),
      )
    for (const patch of [{ documentId: featureId }, { revision: 5 }, { featureId: document.id }]) {
      const rejected = await respond(patch)
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({
        diagnostic: { code: "result-context-mismatch" },
      })
    }
    expect((await respond()).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
  })
  it("rejects forged solid STL inspection before forwarding a valid mesh result", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const value = nativeImportInspection("stl")
    value.upload.documentId = document.id
    const operation = localOperationSchema.parse({
      tool: "inspect_import_upload",
      arguments: { uploadId: value.upload.uploadId },
    })
    const pending = broker.invoke(operation)
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = (await polled.json()) as { work: { requestId: string } }
    const respond = (inspection: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: operation.tool,
            result: { ok: true, value: inspection },
          },
          token,
        ),
      )
    const forged = {
      ...value,
      representation: "exact-solid",
      outputs: value.outputs.map((output) => ({ ...output, volumeMm3: 1 })),
    }
    const rejected = await respond(forged)
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ diagnostic: { code: "invalid-result" } })
    expect((await respond(value)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
  })

  it("correlates an import's captured document, base and source intent before accepting its browser result", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const operation = localOperationSchema.parse({
      tool: "begin_import_upload",
      arguments: { revision: 4, filename: "source.step", byteLength: 3, sourceUnit: "millimeter" },
    })
    const pending = broker.invoke(operation)
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const body = (await polled.json()) as { work: { requestId: string } }
    const value = {
      uploadId: "0195b5ac-b250-7a2c-8c33-000000000001",
      documentId: document.id,
      baseRevision: 4,
      uploadVersion: 0,
      filename: "source.step",
      byteLength: 3,
      sourceUnit: "millimeter",
      format: "step",
      receivedBytes: 0,
      sha256: null,
      status: "uploading",
      expiresAt: "2099-10-04T00:00:00Z",
      chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
    }
    const respond = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: body.work.requestId,
            tool: operation.tool,
            result: { ok: true, value },
          },
          token,
        ),
      )
    for (const wrong of [
      { ...value, documentId: "0195b5ac-b250-7a2c-8c33-000000000002" },
      { ...value, baseRevision: 5 },
      { ...value, byteLength: 4 },
      { ...value, uploadVersion: 1 },
    ])
      expect((await respond(wrong)).status).toBe(400)
    expect((await respond(value)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
  })

  it("requires the exact unique unordered interference pair set before forwarding inspection", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const a = "0195b5ac-b220-7a2c-8c33-000000000001"
    const b = "0195b5ac-b220-7a2c-8c33-000000000002"
    const c = "0195b5ac-b220-7a2c-8c33-000000000003"
    const pair = (leftInstanceId: string, rightInstanceId: string) => ({
      leftInstanceId,
      rightInstanceId,
      status: "clear",
      volume: 0,
      solidCount: 0,
    })
    const pending = broker.invoke(
      localOperationSchema.parse({
        tool: "inspect_assembly",
        arguments: {
          revision: document.revision,
          interferencePairs: [pair(a, b), pair(a, c)].map(
            ({ leftInstanceId, rightInstanceId }) => ({ leftInstanceId, rightInstanceId }),
          ),
        },
      }),
    )
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const { work } = (await poll.json()) as { work: { requestId: string } }
    const result = (interference: ReturnType<typeof pair>[]) => ({
      ok: true,
      value: {
        schemaVersion: 1,
        documentId: document.id,
        revision: document.revision,
        occurrences: [],
        interference,
      },
    })
    const respond = (inspection: ReturnType<typeof result>) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "inspect_assembly",
            result: inspection,
          },
          token,
        ),
      )
    for (const wrong of [
      [pair(a, b), pair(a, b)],
      [pair(a, b), pair(b, a)],
      [pair(a, b), pair(b, c)],
      [pair(a, b)],
      [pair(a, b), pair(a, c), pair(b, c)],
    ]) {
      const rejected = await respond(result(wrong))
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({
        diagnostic: { code: "result-context-mismatch" },
      })
    }
    const exact = result([pair(c, a), pair(b, a)])
    expect((await respond(exact)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>(exact)
  })
  it("denies hostile or missing origins and requires the exact JSON method", async () => {
    const broker = makeBroker({ origin })
    broker.setClient({ name: "test", version: "1" })
    expect((await broker.handle(request("status", {}, undefined, "http://evil.test"))).status).toBe(
      403,
    )
    const missing = new Request(`${origin}/__vibeshape/automation/status`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:43114" },
      body: "{}",
    })
    expect((await broker.handle(missing)).status).toBe(403)
    expect(
      (
        await broker.handle(
          new Request(`${origin}/__vibeshape/automation/status`, {
            method: "GET",
            headers: { origin, host: "127.0.0.1:43114" },
          }),
        )
      ).status,
    ).toBe(400)
  })

  it("pairs once, delivers work once, and validates the matching result", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const bodyBroker = makeBroker({ origin })
    bodyBroker.setClient({ name: "test-client", version: "1.0" })
    const operation = { tool: "create_draft", arguments: { baseRevision: 4 } } as const
    const workPromise = broker.invoke(operation)
    const first = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as {
      work: { requestId: string; operation: typeof operation }
    }
    expect(firstBody.work?.operation).toEqual(operation)
    const updatedDocument = { ...document, name: "Bracket v2", revision: 5 }
    const second = await broker.handle(
      request(
        "poll",
        { protocolVersion: 1, sequence: 2, document: updatedDocument, progress: null },
        token,
      ),
    )
    expect(((await second.json()) as { work: unknown }).work).toBeNull()
    await broker.handle(
      request(
        "result",
        {
          protocolVersion: 1,
          requestId: firstBody.work.requestId,
          tool: "model_info",
          result: { ok: false, diagnostic: { code: "wrong", message: "wrong", retryable: false } },
        },
        token,
      ),
    )
    const result = {
      ok: false,
      diagnostic: { code: "failed", message: "failed", retryable: false },
    }
    await broker.handle(
      request(
        "result",
        { protocolVersion: 1, requestId: firstBody.work.requestId, tool: "create_draft", result },
        token,
      ),
    )
    await expect(workPromise).resolves.toEqual<unknown>(result)
    expect((await broker.handle(request("connect", { protocolVersion: 1, document }))).status).toBe(
      409,
    )
  })

  it("suspends aborted work without replay and retains authenticated recovery", async () => {
    const onRevoke = vi.fn()
    const broker = makeBroker({ origin, onRevoke })
    const { token } = await connect(broker)
    const controller = new AbortController()
    const work = broker.invoke({ tool: "model_info", arguments: {} }, { signal: controller.signal })
    controller.abort()
    await expect(work).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "outcome-unknown" },
    })
    expect(onRevoke).toHaveBeenCalledTimes(1)
    expect(
      (
        await broker.handle(
          request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
        )
      ).status,
    ).toBe(409)
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(
      broker.invoke({ tool: "model_info", arguments: {} }, { signal: alreadyAborted.signal }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
  })

  it("rejects oversized bodies, altered poll replays, and mismatched export results", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const bodyBroker = makeBroker({ origin })
    bodyBroker.setClient({ name: "test-client", version: "1.0" })
    const oversized = new Request(`${origin}/__vibeshape/automation/connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        host: "127.0.0.1:43114",
        "content-length": "70000",
      },
      body: "{}",
    })
    expect((await bodyBroker.handle(oversized)).status).toBe(413)
    const operation = { tool: "export_model", arguments: { revision: 4, format: "step" } } as const
    const pending = broker.invoke(operation)
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await polled.json()) as { work: { requestId: string } }).work
    expect(
      (
        await broker.handle(
          request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
        )
      ).status,
    ).toBe(200)
    const badResult = {
      ok: true,
      value: {
        documentId: "0195b5ac-b250-7a2c-8c33-000000000001",
        revision: 4,
        format: "step",
        filename: "model.step",
        mimeType: "model/step",
        base64: "U1RFUA==",
      },
    }
    expect(
      (
        await broker.handle(
          request(
            "result",
            {
              protocolVersion: 1,
              requestId: work.requestId,
              tool: "export_model",
              result: badResult,
            },
            token,
          ),
        )
      ).status,
    ).toBe(400)
    broker.revoke()
    await expect(pending).resolves.toMatchObject({ ok: false })
  })

  it("rejects oversized CAD work without losing the paired session", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const operation = localOperationSchema.parse({
      tool: "create_sketch",
      arguments: {
        draftId: "0195b5ac-b250-7a2c-8c33-000000000010",
        commandId: "0195b5ac-b250-7a2c-8c33-000000000011",
        baseRevision: 4,
        sketch: {
          schemaVersion: 0,
          id: "0195b5ac-b250-7a2c-8c33-000000000012",
          label: "Large sketch",
          plane: "xy",
          constraints: [],
          entities: Array.from({ length: 1800 }, (_, i) => ({
            schemaVersion: 0,
            id: `0195b5ac-b250-7a2c-8c33-${String(i + 100).padStart(12, "0")}`,
            type: "point",
            x: i,
            y: 0,
            construction: false,
          })),
        },
      },
    })
    const bytes = Buffer.byteLength(JSON.stringify(operation))
    expect(bytes).toBeGreaterThan(192 * 1024)
    expect(bytes).toBeLessThan(256 * 1024)
    await expect(broker.invoke(operation)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "operation-too-large" },
    })
    expect(broker.isPaired()).toBe(true)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    expect(await poll.json()).toMatchObject({ work: null })
  })

  it("rejects CAD inspection responses for another revision or entity", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const entityId = "0195b5ac-b250-7a2c-8c33-000000000010"
    const operation = localOperationSchema.parse({
      tool: "model_entity",
      arguments: {
        revision: 4,
        entity: { kind: "sketch", id: entityId },
      },
    })
    const pending = broker.invoke(operation)
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await polled.json()) as { work: { requestId: string } }).work
    const view = {
      kind: "org.vibeshape.cad.inspection.detail",
      schemaVersion: 1,
      documentId: document.id,
      revision: 4,
      classification: "semantic",
      data: {
        entityKind: "sketch",
        record: {
          schemaVersion: 0,
          id: entityId,
          label: "Sketch",
          plane: "xy",
          entities: [],
          constraints: [],
        },
      },
    }
    const send = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_entity",
            result: { ok: true, value },
          },
          token,
        ),
      )
    expect((await send({ ...view, revision: 5 })).status).toBe(400)
    expect(
      (
        await send({
          ...view,
          data: {
            ...view.data,
            record: { ...view.data.record, id: "0195b5ac-b250-7a2c-8c33-000000000011" },
          },
        })
      ).status,
    ).toBe(400)
    expect((await send(view)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: view })
  })

  it("binds variable inspection to the requested revision and paired document", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const operation = localOperationSchema.parse({
      tool: "model_variables",
      arguments: { revision: 4 },
    })
    const pending = broker.invoke(operation)
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await polled.json()) as { work: { requestId: string } }).work
    const view = {
      kind: "org.vibeshape.variable.list",
      schemaVersion: 1,
      documentId: document.id,
      revision: 4,
      classification: "semantic",
      nextCursor: null,
      data: { variables: [] },
    }
    const send = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_variables",
            result: { ok: true, value },
          },
          token,
        ),
      )
    expect((await send({ ...view, revision: 5 })).status).toBe(400)
    expect(
      (await send({ ...view, documentId: "0195b5ac-b250-7a2c-8c33-000000000020" })).status,
    ).toBe(400)
    expect((await send(view)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: view })
  })

  it("binds edge inspection to its requested feature, document and revision", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const featureId = "0195b5ac-b250-7a2c-8c33-000000000030"
    const operation = localOperationSchema.parse({
      tool: "model_edges",
      arguments: { revision: 4, featureId },
    })
    const pending = broker.invoke(operation)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await poll.json()) as { work: { requestId: string } }).work
    const view = {
      kind: "org.vibeshape.model.edges",
      schemaVersion: 1,
      documentId: document.id,
      revision: 4,
      generation: 5,
      rebuildId: "current-rebuild",
      featureId,
      contentHash: "a".repeat(64),
      classification: "derived",
      nextCursor: null,
      data: { edges: [], total: 0 },
    }
    const send = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_edges",
            result: { ok: true, value },
          },
          token,
        ),
      )
    expect((await send({ ...view, revision: 3 })).status).toBe(400)
    expect((await send({ ...view, featureId: document.id })).status).toBe(400)
    expect((await send({ ...view, documentId: featureId })).status).toBe(400)
    expect((await send(view)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: view })
  })

  it("binds body measurement inspection to document, revision, feature and role", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const featureId = "0195b5ac-b250-7a2c-8c33-000000000030"
    const operation = localOperationSchema.parse({
      tool: "model_body_measurements",
      arguments: { revision: 4, featureId, outputRole: "pattern.instance.0" },
    })
    const pending = broker.invoke(operation)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await poll.json()) as { work: { requestId: string } }).work
    const shape = {
      valid: true,
      volume: 1,
      surfaceArea: 6,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      solidCount: 1,
      faceCount: 6,
      edgeCount: 12,
    }
    const view = {
      kind: "org.vibeshape.model.body-measurements",
      schemaVersion: 1,
      documentId: document.id,
      revision: 4,
      generation: 5,
      classification: "derived",
      nextCursor: null,
      units: { length: "mm", area: "mm2", volume: "mm3" },
      data: {
        bodies: [
          { featureId, outputRole: "pattern.instance.0", contentHash: "a".repeat(64), shape },
        ],
        total: 1,
      },
    }
    const send = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_body_measurements",
            result: { ok: true, value },
          },
          token,
        ),
      )
    expect((await send({ ...view, revision: 3 })).status).toBe(400)
    expect(
      (await send({ ...view, documentId: "0195b5ac-b250-7a2c-8c33-000000000020" })).status,
    ).toBe(400)
    expect(
      (
        await send({
          ...view,
          data: { ...view.data, bodies: [{ ...view.data.bodies[0], featureId: document.id }] },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await send({
          ...view,
          data: {
            ...view.data,
            bodies: [{ ...view.data.bodies[0], outputRole: "pattern.instance.1" }],
          },
        })
      ).status,
    ).toBe(400)
    expect((await send(view)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: view })
  })

  it("binds body topology responses and cursors to the exact body and rebuild", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const featureId = "0195b5ac-b250-7a2c-8c33-000000000030"
    const provenance = {
      documentId: document.id,
      revision: 4,
      generation: 5,
      rebuildId: "rebuild-1",
      featureId,
      outputRole: "pattern.instance.0",
      contentHash: "a".repeat(64),
      topologyKind: "edge",
    }
    const operation = localOperationSchema.parse({
      tool: "model_body_topology",
      arguments: {
        revision: 4,
        featureId,
        outputRole: provenance.outputRole,
        topologyKind: "edge",
        cursor: { ...provenance, offset: 0 },
      },
    })
    const pending = broker.invoke(operation)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await poll.json()) as { work: { requestId: string } }).work
    const view = {
      ...provenance,
      kind: "org.vibeshape.model.body-topology",
      schemaVersion: 1,
      classification: "derived",
      nextCursor: null,
      data: { topology: [], total: 0 },
    }
    const send = (value: unknown) =>
      broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: work.requestId,
            tool: "model_body_topology",
            result: { ok: true, value },
          },
          token,
        ),
      )
    for (const mismatch of [
      { documentId: featureId },
      { revision: 3 },
      { generation: 6 },
      { rebuildId: "rebuild-2" },
      { featureId: document.id },
      { outputRole: "pattern.instance.1" },
      { contentHash: "b".repeat(64) },
      { topologyKind: "face" },
    ])
      expect((await send({ ...view, ...mismatch })).status).toBe(400)
    expect((await send(view)).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>({ ok: true, value: view })
  })

  it("returns 204 on authenticated revoke and expires liveness", async () => {
    let clock = 1_000
    const broker = makeBroker({ origin, now: () => clock })
    const { token } = await connect(broker)
    expect((await broker.handle(request("revoke", {}, token))).status).toBe(204)
    const second = makeBroker({ origin, now: () => clock })
    const pair = await connect(second)
    clock += 16_000
    expect(second.isPaired()).toBe(false)
    expect(
      (
        await second.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            pair.token,
          ),
        )
      ).status,
    ).toBe(409)
  })

  it("closes an in-flight connect race and rejects old tokens after re-pairing", async () => {
    const broker = makeBroker({ origin })
    broker.setClient({ name: "test-client", version: "1.0" })
    let release!: () => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"))
        release = () => {
          controller.enqueue(
            new TextEncoder().encode(`"protocolVersion":1,"document":${JSON.stringify(document)}}`),
          )
          controller.close()
        }
      },
    })
    const pendingConnect = broker.handle(
      new Request(`${origin}/__vibeshape/automation/connect`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, host: "127.0.0.1:43114" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    )
    broker.setClient(null)
    release()
    expect((await pendingConnect).status).toBe(409)

    const first = await connect(broker)
    broker.revoke()
    const second = await connect(broker)
    expect(
      (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            first.token,
          ),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            second.token,
          ),
        )
      ).status,
    ).toBe(200)
  })

  it.each([
    localOperationSchema.parse({ tool: "model_info", arguments: {} }),
    localOperationSchema.parse({
      tool: "export_model",
      arguments: { revision: 4, format: "step" },
    }),
    localOperationSchema.parse({ tool: "commit_draft", arguments: { draftId: document.id } }),
    lightweightingOperation(false),
    lightweightingOperation(true),
    quickLightweightingOperation(false),
    quickLightweightingOperation(true),
    printOptimizationOperation(),
    printOptimizationOperation(true),
  ])(
    "completes live $tool after ten minutes and honors subsequent revocation",
    async (operation) => {
      vi.useFakeTimers()
      const broker = makeBroker({ origin })
      const { token } = await connect(broker)
      const pending = broker.invoke(localOperationSchema.parse(operation))
      const settled = vi.fn()
      void pending.then(settled)
      let requestId = ""
      for (let sequence = 1; sequence <= 62; sequence += 1) {
        const poll = await broker.handle(
          request(
            "poll",
            {
              protocolVersion: 1,
              sequence,
              document,
              progress: requestId ? { requestId, stage: "review" } : null,
            },
            token,
          ),
        )
        expect(poll.status).toBe(200)
        const body = (await poll.json()) as { work: { requestId: string } | null }
        if (body.work) requestId = body.work.requestId
        await vi.advanceTimersByTimeAsync(10_000)
      }
      expect(broker.isPaired()).toBe(true)
      expect(settled).not.toHaveBeenCalled()
      const result = {
        ok: false,
        diagnostic: {
          code: "draft-review-rejected",
          message: "Discarded",
          retryable: false,
        },
      }
      expect(
        (
          await broker.handle(
            request(
              "result",
              {
                protocolVersion: 1,
                requestId,
                tool: operation.tool,
                result,
              },
              token,
            ),
          )
        ).status,
      ).toBe(200)
      await expect(pending).resolves.toEqual<unknown>(result)
      const next = broker.invoke(
        localOperationSchema.parse({ tool: "commit_draft", arguments: { draftId: document.id } }),
      )
      broker.revoke()
      await expect(next).resolves.toMatchObject({
        ok: false,
        diagnostic: { code: "session-revoked" },
      })
    },
  )

  it("expires an idle pair and an absolute TTL through its timers", async () => {
    vi.useFakeTimers()
    let clock = 1_000
    const broker = makeBroker({ origin, now: () => clock })
    const first = await connect(broker)
    clock += 16_000
    vi.advanceTimersByTime(15_000)
    expect(broker.isPaired()).toBe(false)
    const second = await connect(broker)
    clock += 60 * 60 * 1_000 + 1
    vi.advanceTimersByTime(60 * 60 * 1_000)
    expect(broker.isPaired()).toBe(false)
    expect(first.token).not.toBe(second.token)
  })

  it("reports idle suspension as recoverable and accepts a fresh identity read after resume", async () => {
    vi.useFakeTimers()
    let clock = 1_000
    const broker = makeBroker({ origin, now: () => clock })
    const { token } = await connect(broker)
    clock += 16_000
    vi.advanceTimersByTime(15_000)
    await expect(broker.invoke({ tool: "model_info", arguments: {} })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "session-suspended", retryable: true },
    })
    const response = await broker.handle(request("resume", { protocolVersion: 1, document }, token))
    const resumed = localConnectResponseSchema.parse(await response.json())
    const pending = broker.invoke({ tool: "model_info", arguments: {} })
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, resumed.token),
    )
    const { work } = localPollResponseSchema.parse(await poll.json())
    expect(work?.operation.tool).toBe("model_info")
    if (!work) throw new Error("Expected a new identity read after resume.")
    const result: LocalToolResult = {
      ok: false,
      diagnostic: { code: "geometry-unavailable", message: "No geometry.", retryable: true },
    }
    expect(
      (
        await broker.handle(
          request(
            "result",
            {
              protocolVersion: 1,
              requestId: work.requestId,
              tool: "model_info",
              result,
            },
            resumed.token,
          ),
        )
      ).status,
    ).toBe(200)
    await expect(pending).resolves.toEqual(result)
    expect(broker.isPaired()).toBe(true)
    await broker.handle(request("revoke", {}, resumed.token))
    await expect(broker.invoke({ tool: "model_info", arguments: {} })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "not-paired", retryable: false },
    })
  })

  it("forwards only increasing progress, rejects busy work, and cleans completion", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const progress: string[] = []
    const operation = broker.invoke(
      { tool: "model_info", arguments: {} },
      { onProgress: (stage) => progress.push(stage) },
    )
    await expect(broker.invoke({ tool: "model_info", arguments: {} })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "busy" },
    })
    const polled = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
    const work = ((await polled.json()) as { work: { requestId: string } }).work
    for (const [sequence, stage] of [
      [2, "executing"],
      [3, "review"],
      [4, "executing"],
      [5, "applying"],
    ] as const)
      await broker.handle(
        request(
          "poll",
          {
            protocolVersion: 1,
            sequence,
            document,
            progress: { requestId: work.requestId, stage },
          },
          token,
        ),
      )
    await broker.handle(
      request(
        "result",
        {
          protocolVersion: 1,
          requestId: work.requestId,
          tool: "model_info",
          result: { ok: false, diagnostic: { code: "done", message: "done", retryable: false } },
        },
        token,
      ),
    )
    await expect(operation).resolves.toMatchObject({ ok: false })
    expect(progress).toEqual(["queued", "executing", "review", "applying"])
  })

  it("keeps feature draft base revision while accepting its current revision", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const operation = localOperationSchema.parse({
      tool: "create_box",
      arguments: {
        draftId: "0195b5ac-b220-7a2c-8c33-67a36a7f6105",
        commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f6102",
        baseRevision: 5,
        featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f6103",
        widthMm: 2,
        depthMm: 3,
        heightMm: 4,
      },
    })
    const pending = broker.invoke(operation)
    const work = (
      (await (
        await broker.handle(
          request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
        )
      ).json()) as { work: { requestId: string } }
    ).work
    const state = {
      schemaVersion: 1,
      draftId: "0195b5ac-b220-7a2c-8c33-67a36a7f6105",
      documentId: document.id,
      baseRevision: 4,
      revision: 6,
      commandCount: 2,
      expiresAt: "2099-01-01T00:00:00.000Z",
    }
    await broker.handle(
      request(
        "result",
        {
          protocolVersion: 1,
          requestId: work.requestId,
          tool: "create_box",
          result: { ok: true, value: state },
        },
        token,
      ),
    )
    await expect(pending).resolves.toMatchObject({
      ok: true,
      value: { baseRevision: 4, revision: 6 },
    })
  })
})

it("rejects metadata results from another document, revision, or requested page", async () => {
  const broker = makeBroker({ origin })
  const { token } = await connect(broker)
  const operation = localOperationSchema.parse({
    tool: "model_parts",
    arguments: { revision: 4, cursor: null, limit: 1 },
  })
  const pending = broker.invoke(operation)
  const polled = await broker.handle(
    request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
  )
  const body = (await polled.json()) as { work: { requestId: string } }
  const value = { documentId: document.id, revision: 4, total: 0, nextCursor: null, parts: [] }
  for (const wrong of [
    { ...value, documentId: "0195b5ac-b220-7a2c-8c33-000000000099" },
    { ...value, revision: 5 },
    { ...value, total: 3, nextCursor: 2 },
  ]) {
    const rejected = await broker.handle(
      request(
        "result",
        {
          protocolVersion: 1,
          requestId: body.work.requestId,
          tool: "model_parts",
          result: { ok: true, value: wrong },
        },
        token,
      ),
    )
    expect(rejected.status).toBe(400)
  }
  expect(
    (
      await broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: body.work.requestId,
            tool: "model_parts",
            result: { ok: true, value },
          },
          token,
        ),
      )
    ).status,
  ).toBe(200)
  await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
})

it("requires a metadata commit result to preserve exact command identity, revision and change", async () => {
  const broker = makeBroker({ origin })
  const { token } = await connect(broker)
  const commandId = "0195b5ac-b220-7a2c-8c33-000000000091"
  const change = {
    kind: "part.rename" as const,
    partId: "0195b5ac-b220-7a2c-8c33-000000000092",
    name: "Housing",
  }
  const operation = localOperationSchema.parse({
    tool: "change_metadata",
    arguments: { baseRevision: 4, commandId, change },
  })
  const pending = broker.invoke(operation)
  const polled = await broker.handle(
    request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
  )
  const body = (await polled.json()) as { work: { requestId: string } }
  const value = { documentId: document.id, commandId, baseRevision: 4, revision: 5, change }
  for (const wrong of [
    { ...value, commandId: change.partId },
    { ...value, revision: 6 },
    { ...value, change: { ...change, name: "Redirected" } },
  ]) {
    const rejected = await broker.handle(
      request(
        "result",
        {
          protocolVersion: 1,
          requestId: body.work.requestId,
          tool: "change_metadata",
          result: { ok: true, value: wrong },
        },
        token,
      ),
    )
    expect(rejected.status).toBe(400)
  }
  expect(
    (
      await broker.handle(
        request(
          "result",
          {
            protocolVersion: 1,
            requestId: body.work.requestId,
            tool: "change_metadata",
            result: { ok: true, value },
          },
          token,
        ),
      )
    ).status,
  ).toBe(200)
  await expect(pending).resolves.toEqual<unknown>({ ok: true, value })
})

describe("authenticated local reload recovery", () => {
  it.each(["list_recoverable_drafts", "restore_draft"] as const)(
    "binds %s results to the current authenticated document and actor",
    async (tool) => {
      const broker = makeBroker({ origin })
      broker.setClient({ name: "test-client", version: "1.0" })
      const credential = localConnectResponseSchema.parse(
        await (await broker.handle(request("connect", { protocolVersion: 1, document }))).json(),
      )
      const recoveryId = "0195b5ac-b220-7a2c-8c33-000000000001"
      const operation = localOperationSchema.parse({
        tool,
        arguments: tool === "restore_draft" ? { recoveryId, baseRevision: document.revision } : {},
      })
      const pending = broker.invoke(operation)
      const polled = localPollResponseSchema.parse(
        await (
          await broker.handle(
            request(
              "poll",
              { protocolVersion: 1, sequence: 1, document, progress: null },
              credential.token,
            ),
          )
        ).json(),
      )
      if (!polled.work) throw new Error("Recovery work must be delivered.")
      const value =
        tool === "list_recoverable_drafts"
          ? { schemaVersion: 1, documentId: document.id, revision: document.revision, items: [] }
          : {
              schemaVersion: 1,
              recoveryId,
              attribution: { type: "current-actor", actor: credential.actor },
              draft: {
                schemaVersion: 1,
                draftId: "0195b5ac-b220-7a2c-8c33-000000000002",
                documentId: document.id,
                baseRevision: document.revision,
                revision: document.revision + 1,
                commandCount: 1,
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
              },
            }
      const incorrect =
        tool === "list_recoverable_drafts"
          ? { ...value, documentId: recoveryId }
          : {
              ...value,
              attribution: {
                type: "current-actor",
                actor: { type: "mcp", clientId: "org.example.other", sessionId: recoveryId },
              },
            }
      const envelope = { protocolVersion: 1, requestId: polled.work.requestId, tool }
      expect(
        (
          await broker.handle(
            request(
              "result",
              { ...envelope, result: { ok: true, value: incorrect } },
              credential.token,
            ),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await broker.handle(
            request("result", { ...envelope, result: { ok: true, value } }, credential.token),
          )
        ).status,
      ).toBe(200)
      expect(await pending).toMatchObject({ ok: true, value })
    },
  )
  it("suspends access, cancels work without replay and rotates the token on resume", async () => {
    let at = 1000
    const broker = makeBroker({ origin, now: () => at })
    const credential = await connect(broker)
    const pending = broker.invoke({ tool: "model_info", arguments: {} })
    expect((await broker.handle(request("suspend", {}, credential.token))).status).toBe(200)
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "outcome-unknown" } })
    expect(broker.isPaired()).toBe(false)
    expect(await broker.invoke({ tool: "model_info", arguments: {} })).toMatchObject({ ok: false })
    at += 20_000
    const resumed = await broker.handle(
      request("resume", { protocolVersion: 1, document }, credential.token),
    )
    expect(resumed.status).toBe(200)
    const next = (await resumed.json()) as { token: string; expiresAt: number }
    expect(next.token).not.toBe(credential.token)
    expect(next.expiresAt).toBe(3_601_000)
    expect(
      (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            credential.token,
          ),
        )
      ).status,
    ).toBe(401)
    const poll = await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, next.token),
    )
    expect(await poll.json()).toMatchObject({ work: null })
    expect(broker.isPaired()).toBe(true)
  })
  it("refuses another document and expired or revoked credentials", async () => {
    let at = 1000
    const broker = makeBroker({ origin, now: () => at })
    const credential = await connect(broker)
    await broker.handle(request("suspend", {}, credential.token))
    expect(
      (
        await broker.handle(
          request(
            "resume",
            {
              protocolVersion: 1,
              document: { ...document, id: "0195b5ac-b250-7a2c-8c33-000000000002" },
            },
            credential.token,
          ),
        )
      ).status,
    ).toBe(409)
    at += 3_600_001
    expect(
      (await broker.handle(request("resume", { protocolVersion: 1, document }, credential.token)))
        .status,
    ).toBe(401)
    const fresh = await connect(broker)
    await broker.handle(request("suspend", {}, fresh.token))
    await broker.handle(request("revoke", {}, fresh.token))
    expect(
      (await broker.handle(request("resume", { protocolVersion: 1, document }, fresh.token)))
        .status,
    ).toBe(401)
  })
})

describe("recoverable local delivery", () => {
  it("returns the same delivery for a lost poll response and rejects an altered retry", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const pending = broker.invoke({ tool: "model_info", arguments: {} })
    const body = { protocolVersion: 1, sequence: 1, document, progress: null }
    const first = await (await broker.handle(request("poll", body, token))).json()
    const retry = await (await broker.handle(request("poll", body, token))).json()
    expect(retry).toEqual(first)
    expect(
      (
        await broker.handle(
          request("poll", { ...body, document: { ...document, revision: 5 } }, token),
        )
      ).status,
    ).toBe(409)
    broker.revoke()
    await pending
  })
  it("restores the approved project after bridge shutdown without replaying pending work", async () => {
    let stored: import("./local-recovery-store").LocalRecoveryRecord | null = null
    const recovery = {
      load: () => stored,
      save: (record: NonNullable<typeof stored>) => {
        stored = record
      },
      clear: () => {
        stored = null
      },
    }
    let at = 1000
    const first = makeBroker({ origin, recovery, now: () => at })
    const credential = await connect(first)
    const pending = first.invoke({ tool: "model_info", arguments: {} })
    first.dispose()
    await expect(pending).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "outcome-unknown" },
    })
    at += 120_000
    const resumed = makeBroker({ origin, recovery, now: () => at })
    resumed.setClient({ name: "test-client", version: "1.0" })
    expect(resumed.isPaired()).toBe(false)
    const response = await resumed.handle(
      request("resume", { protocolVersion: 1, document }, credential.token),
    )
    expect(response.status).toBe(200)
    const next = localConnectResponseSchema.parse(await response.json())
    expect(next.token).not.toBe(credential.token)
    expect(resumed.isPaired()).toBe(true)
    const poll = await resumed.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, next.token),
    )
    expect(await poll.json()).toMatchObject({ work: null })
    await resumed.handle(request("revoke", {}, next.token))
    expect(stored).toBeNull()
  })
  it("retries a lost resume response with the rotated credential and keeps old polls unauthorized", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    await broker.handle(request("suspend", {}, token))
    const body = { protocolVersion: 1, document }
    const first = await (await broker.handle(request("resume", body, token))).json()
    const repeat = await (await broker.handle(request("resume", body, token))).json()
    expect(repeat).toEqual(first)
    expect(
      (await broker.handle(request("poll", { ...body, sequence: 1, progress: null }, token)))
        .status,
    ).toBe(401)
  })
  it("honors Stop AI with the previous token after a lost resume acknowledgement", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const resumed = localConnectResponseSchema.parse(
      await (
        await broker.handle(request("resume", { protocolVersion: 1, document }, token))
      ).json(),
    )
    expect((await broker.handle(request("revoke", {}, token))).status).toBe(204)
    expect(broker.isPaired()).toBe(false)
    for (const credential of [token, resumed.token]) {
      expect(
        (await broker.handle(request("resume", { protocolVersion: 1, document }, credential)))
          .status,
      ).toBe(401)
    }
  })
  it("keeps a concurrent current-token poll valid when the old owner retries its resume", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const body = { protocolVersion: 1, document }
    const next = localConnectResponseSchema.parse(
      await (await broker.handle(request("resume", body, token))).json(),
    )
    let release!: () => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"))
        release = () => {
          controller.enqueue(
            new TextEncoder().encode(
              `"protocolVersion":1,"sequence":1,"progress":null,"document":${JSON.stringify(document)}}`,
            ),
          )
          controller.close()
        }
      },
    })
    const pendingPoll = broker.handle(
      new Request(`${origin}/__vibeshape/automation/poll`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          host: "127.0.0.1:43114",
          authorization: `Bearer ${next.token}`,
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    )
    expect((await broker.handle(request("resume", body, token))).status).toBe(200)
    release()
    expect((await pendingPoll).status).toBe(200)
    expect(broker.isPaired()).toBe(true)
  })
  it("retires the previous token once the browser adopts the rotated credential", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const next = localConnectResponseSchema.parse(
      await (
        await broker.handle(request("resume", { protocolVersion: 1, document }, token))
      ).json(),
    )
    expect(
      (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            next.token,
          ),
        )
      ).status,
    ).toBe(200)
    expect((await broker.handle(request("revoke", {}, token))).status).toBe(401)
    expect(
      (await broker.handle(request("resume", { protocolVersion: 1, document }, token))).status,
    ).toBe(401)
    expect(broker.isPaired()).toBe(true)
  })
  it("recovers a lost resume acknowledgement after a long outage within the approval lease", async () => {
    let at = 1000
    const broker = makeBroker({ origin, now: () => at })
    const { token } = await connect(broker)
    const first = localConnectResponseSchema.parse(
      await (
        await broker.handle(request("resume", { protocolVersion: 1, document }, token))
      ).json(),
    )
    at += 120_000
    const retry = await broker.handle(request("resume", { protocolVersion: 1, document }, token))
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(first)
    expect(
      (
        await broker.handle(
          request(
            "poll",
            { protocolVersion: 1, sequence: 1, document, progress: null },
            first.token,
          ),
        )
      ).status,
    ).toBe(200)
    expect(broker.isPaired()).toBe(true)
  })
  it("never publishes a grant when its recovery checkpoint fails", async () => {
    let stored: import("./local-recovery-store").LocalRecoveryRecord | null = null
    let fail = false
    const recovery = {
      load: () => stored,
      save: (record: NonNullable<typeof stored>) => {
        if (fail) throw new Error("Disk full.")
        stored = record
      },
      clear: () => {
        stored = null
      },
    }
    const broker = makeBroker({ origin, recovery })
    const { token } = await connect(broker)
    const pending = broker.invoke({ tool: "model_info", arguments: {} })
    fail = true
    expect(
      (await broker.handle(request("resume", { protocolVersion: 1, document }, token))).status,
    ).toBe(503)
    expect(broker.isPaired()).toBe(false)
    expect(stored).toBeNull()
    await expect(pending).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "outcome-unknown" },
    })
    expect(
      (await broker.handle(request("resume", { protocolVersion: 1, document }, token))).status,
    ).toBe(401)
    expect((await broker.handle(request("connect", { protocolVersion: 1, document }))).status).toBe(
      503,
    )
    expect(broker.isPaired()).toBe(false)
  })
  it("acknowledges an identical large export retry without settling it twice", async () => {
    const broker = makeBroker({ origin })
    const { token } = await connect(broker)
    const pending = broker.invoke({
      tool: "export_model",
      arguments: { revision: 4, format: "step" },
    })
    const poll = localPollResponseSchema.parse(
      await (
        await broker.handle(
          request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
        )
      ).json(),
    )
    expect(poll.work).not.toBeNull()
    const result = {
      ok: true,
      value: {
        documentId: document.id,
        revision: 4,
        format: "step",
        filename: "model.step",
        mimeType: "model/step",
        base64: "AAAA".repeat(300_000),
      },
    }
    const body = {
      protocolVersion: 1,
      requestId: poll.work?.requestId,
      tool: "export_model",
      result,
    }
    expect((await broker.handle(request("result", body, token))).status).toBe(200)
    await expect(pending).resolves.toEqual<unknown>(result)
    expect((await broker.handle(request("result", body, token))).status).toBe(200)
    expect(
      (
        await broker.handle(
          request(
            "result",
            {
              ...body,
              result: { ...result, value: { ...result.value, base64: "BBBB".repeat(300_000) } },
            },
            token,
          ),
        )
      ).status,
    ).toBe(409)
  })
  it("renews an active approved session but never extends a suspended or revoked session", async () => {
    let at = 1000
    const broker = makeBroker({ origin, now: () => at })
    const { token } = await connect(broker)
    at += 10_000
    const renewed = await broker.handle(request("renew", {}, token))
    expect(renewed.status).toBe(200)
    expect(await renewed.json()).toMatchObject({ token, expiresAt: 3_611_000 })
    await broker.handle(request("suspend", {}, token))
    expect((await broker.handle(request("renew", {}, token))).status).toBe(409)
    await broker.handle(request("revoke", {}, token))
    expect((await broker.handle(request("renew", {}, token))).status).toBe(401)
  })
})

it("acknowledges a lost result response once and rejects an altered completion", async () => {
  const broker = makeBroker({ origin })
  const { token } = await connect(broker)
  const pending = broker.invoke({ tool: "create_draft", arguments: { baseRevision: 4 } })
  const poll = (await (
    await broker.handle(
      request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
    )
  ).json()) as { work: { requestId: string } }
  const body = {
    protocolVersion: 1,
    requestId: poll.work.requestId,
    tool: "create_draft",
    result: {
      ok: true,
      value: {
        schemaVersion: 1,
        draftId: "0195b5ac-b250-7a2c-8c33-000000000003",
        documentId: document.id,
        baseRevision: 4,
        revision: 4,
        commandCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    },
  }
  expect((await broker.handle(request("result", body, token))).status).toBe(200)
  await expect(pending).resolves.toMatchObject(body.result)
  expect((await broker.handle(request("result", body, token))).status).toBe(200)
  const altered = {
    ...body,
    result: { ...body.result, value: { ...body.result.value, revision: 5 } },
  }
  expect((await broker.handle(request("result", altered, token))).status).toBe(409)
})

it("replaces suspended authority with a fresh pairing without displacing an active owner", async () => {
  const broker = makeBroker({ origin })
  const { token } = await connect(broker)
  expect((await broker.handle(request("connect", { protocolVersion: 1, document }))).status).toBe(
    409,
  )
  expect(broker.isPaired()).toBe(true)
  expect((await broker.handle(request("suspend", {}, token))).status).toBe(200)
  expect(
    (await broker.handle(request("connect", { protocolVersion: 1, document: {} }))).status,
  ).toBe(400)
  const target = { ...document, id: "0195b5ac-b220-7a2c-8c33-67a36a7f6102" }
  const response = await broker.handle(request("connect", { protocolVersion: 1, document: target }))
  expect(response.status).toBe(200)
  const fresh = localConnectResponseSchema.parse(await response.json())
  expect(fresh.token).not.toBe(token)
  expect(broker.isPaired()).toBe(true)
  expect(
    (await broker.handle(request("resume", { protocolVersion: 1, document }, token))).status,
  ).toBe(401)
  expect((await broker.handle(request("suspend", {}, fresh.token))).status).toBe(200)
})
