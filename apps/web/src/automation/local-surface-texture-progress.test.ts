// @vitest-environment jsdom
import {
  localConnectResponseSchema,
  localPollRequestSchema,
  localPollResponseSchema,
  localWorkSchema,
} from "@vibeshape/automation-api/local-session"
import { localFailure, localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { surfaceTextureCommandSchema } from "@vibeshape/automation-host/surface-texture-proposal-contract"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  surfaceTextureProjectFixture,
  textureFixtureId,
} from "../../../../tests/fixtures/surface-texture-project"
import { automationReviews } from "./automation-review-controller"
import type { AutomationReviewState } from "./automation-review-state"
import { createLocalAutomationConnection } from "./local-automation-connection"

const mocks = vi.hoisted(() => ({ request: vi.fn(), createHandle: vi.fn(), execute: vi.fn() }))
vi.mock("./local-automation-http", () => ({ localAutomationRequest: mocks.request }))
vi.mock("../document/document-controller", () => ({
  createActiveDocumentAutomationSession: mocks.createHandle,
}))
vi.mock("./local-tool-executor", () => ({
  createLocalToolExecutor: () => ({ execute: mocks.execute }),
}))

const { snapshot, layer } = surfaceTextureProjectFixture()
const { id: _id, featureId: _featureId, ...recipe } = layer
const credential = localConnectResponseSchema.parse({
  protocolVersion: 1,
  token: "A".repeat(43),
  actor: { type: "mcp", clientId: "org.example.texture", sessionId: textureFixtureId(9) },
  expiresAt: Date.parse("2099-01-01T00:00:00Z"),
  client: { name: "Surface texture client", version: "1" },
})
const ok = (data: unknown) => ({ ok: true, status: 200, data })
const emptyPoll = localPollResponseSchema.parse({
  protocolVersion: 1,
  work: null,
  cancelledRequestIds: [],
})
let connection: ReturnType<typeof createLocalAutomationConnection>
let review: AutomationReviewState | null

function textureReview(operation: "create" | "update" | "remove"): AutomationReviewState {
  return {
    id: "texture-review",
    status: "ready",
    diagnostic: null,
    input: {
      kind: "surface-texture",
      actor: credential.actor,
      documentName: snapshot.name,
      featureName: "Housing",
      operation,
      layerId: layer.id,
      draft: {
        draftId: textureFixtureId(500),
        baseRevision: snapshot.revision,
        draftVersion: 0,
        expiresAt: "2099-01-01T00:00:00Z",
      },
      command: surfaceTextureCommandSchema.parse({
        schemaVersion: 3,
        kind: "org.vibeshape.document.metadata-command",
        commandId: textureFixtureId(501),
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        issuedAt: "2026-10-04T00:00:00Z",
        actor: credential.actor,
        payload: {
          kind: "textures.replace-layers",
          featureId: layer.featureId,
          layers:
            operation === "remove"
              ? []
              : [{ ...layer, heightMm: operation === "update" ? 0.45 : layer.heightMm }],
        },
      }),
      preview: { bodyCount: 1, sourceTriangleCount: 12, triangleCount: 48, vertexCount: 26 },
    },
  }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.clearAllMocks()
  review = null
  vi.spyOn(automationReviews, "getSnapshot").mockImplementation(() => review)
  document.head.innerHTML = '<meta name="vibeshape-local-automation" content="1">'
  mocks.createHandle.mockReturnValue({
    ok: true,
    documentId: snapshot.id,
    revision: snapshot.revision,
    dispose: vi.fn(),
    enableAutoApply: vi.fn(),
    readInfo: () => ({
      summary: {
        documentId: snapshot.id,
        revision: snapshot.revision,
        data: { name: snapshot.name },
      },
    }),
  })
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/status")
      return ok({ protocolVersion: 1, client: credential.client, paired: false })
    if (path === "/connect") return ok(credential)
    if (path === "/poll") return ok(emptyPoll)
    return ok({ ok: true })
  })
  connection = createLocalAutomationConnection()
})
afterEach(() => {
  connection.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function startPending(operation: unknown) {
  const work = localWorkSchema.parse({
    requestId: textureFixtureId(502),
    operation: localOperationSchema.parse(operation),
  })
  let release: (value: unknown) => void = () => undefined
  mocks.execute.mockReturnValue(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  let delivered = false
  const request = mocks.request.getMockImplementation()
  mocks.request.mockImplementation(async (path: string, body: unknown, ...rest: unknown[]) => {
    if (path !== "/poll") return request?.(path, body, ...rest)
    localPollRequestSchema.parse(body)
    const value = { ...emptyPoll, work: delivered ? null : work }
    delivered = true
    return ok(localPollResponseSchema.parse(value))
  })
  connection.start()
  await connection.status()
  expect(await connection.enable()).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(work.operation, expect.any(AbortSignal))
  return {
    work,
    release: () => release(localFailure("draft-review-cancelled", "The texture was not applied.")),
  }
}

async function currentProgress() {
  await vi.advanceTimersByTimeAsync(500)
  const poll = mocks.request.mock.calls.filter(([path]) => path === "/poll").at(-1)
  return localPollRequestSchema.parse(poll?.[1]).progress
}

describe("local surface texture manual review progress", () => {
  it.each(["create", "update", "remove"] as const)(
    "reports %s texture review and applying for its pending request",
    async (kind) => {
      const { work, release } = await startPending({
        tool: `${kind}_surface_texture`,
        arguments: {
          baseRevision: snapshot.revision,
          layerId: layer.id,
          ...(kind === "create" ? { featureId: layer.featureId, recipe } : {}),
          ...(kind === "update" ? { patch: { heightMm: 0.45 } } : {}),
        },
      })
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "executing" })
      review = textureReview(kind)
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "review" })
      review = { ...review, status: "applying" }
      expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "applying" })
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(await currentProgress()).toBeNull()
      expect(connection.getSnapshot()).toMatchObject({ connected: true, busy: false })
    },
  )

  it("keeps a texture summary read executing even while an unrelated manual review is ready", async () => {
    const { work, release } = await startPending({
      tool: "model_surface_textures",
      arguments: { revision: snapshot.revision, featureId: layer.featureId },
    })
    review = textureReview("create")
    expect(await currentProgress()).toEqual({ requestId: work.requestId, stage: "executing" })
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(await currentProgress()).toBeNull()
  })
})
