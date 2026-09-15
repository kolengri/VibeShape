// @vitest-environment node

import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { afterEach, describe, expect, it, vi } from "vitest"
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
    await expect(workPromise).resolves.toEqual(result)
    expect((await broker.handle(request("connect", { protocolVersion: 1, document }))).status).toBe(
      409,
    )
  })

  it("fails pending work immediately when aborted and revokes the pair", async () => {
    const onRevoke = vi.fn()
    const broker = makeBroker({ origin, onRevoke })
    const { token } = await connect(broker)
    const controller = new AbortController()
    const work = broker.invoke({ tool: "model_info", arguments: {} }, { signal: controller.signal })
    controller.abort()
    await expect(work).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
    expect(onRevoke).toHaveBeenCalledOnce()
    expect(
      (
        await broker.handle(
          request("poll", { protocolVersion: 1, sequence: 1, document, progress: null }, token),
        )
      ).status,
    ).toBe(401)
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(
      broker.invoke({ tool: "model_info", arguments: {} }, { signal: alreadyAborted.signal }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
  })

  it("rejects oversized bodies, replayed polls, and mismatched export results", async () => {
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
    ).toBe(409)
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
    await expect(pending).resolves.toEqual({ ok: true, value: view })
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
    await expect(pending).resolves.toEqual({ ok: true, value: view })
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
    await expect(pending).resolves.toEqual({ ok: true, value: view })
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
    await expect(pending).resolves.toEqual({ ok: true, value: view })
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
    await expect(pending).resolves.toEqual({ ok: true, value: view })
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
    ).toBe(401)
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
