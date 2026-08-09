import {
  SLICER_BRIDGE_HANDOFF_PATH,
  SLICER_BRIDGE_ORIGIN,
  SLICER_BRIDGE_PROTOCOL_VERSION,
  slicerHandoffResponseSchema,
} from "@vibeshape/slicer-handoff/protocol"
import { describe, expect, it, vi } from "vitest"
import type { BridgeConfiguration } from "./config"
import { createSlicerBridgeHandler } from "./server"

const configuration: BridgeConfiguration = {
  schemaVersion: 1,
  origin: "https://cad.example.test",
  token: "a".repeat(43),
}
const requestId = "0195b5ac-b220-7a2c-8c33-67a36a7f4101"

function handoffRequest(input: {
  token?: string
  origin?: string
  requestId?: string
  bytes?: Uint8Array
  filename?: string
}) {
  const query = new URLSearchParams({
    protocolVersion: String(SLICER_BRIDGE_PROTOCOL_VERSION),
    requestId: input.requestId ?? requestId,
    slicerId: "orca-slicer",
    filename: input.filename ?? "Bracket.3mf",
  })
  return new Request(`${SLICER_BRIDGE_ORIGIN}${SLICER_BRIDGE_HANDOFF_PATH}?${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token ?? configuration.token}`,
      "content-type": "model/3mf",
      origin: input.origin ?? configuration.origin,
    },
    body: input.bytes ?? new Uint8Array([80, 75, 3, 4]),
  })
}

async function parsedResponse(response: Response) {
  return slicerHandoffResponseSchema.parse(await response.json())
}

describe("slicer bridge server", () => {
  it("writes and launches one authenticated 3MF handoff", async () => {
    const scheduleCleanup = vi.fn()
    const persist = vi.fn(async () => ({ path: "/tmp/Bracket.3mf", scheduleCleanup }))
    const launch = vi.fn(async () => ({
      slicerId: "orca-slicer" as const,
      executable: "/Applications/OrcaSlicer",
    }))
    const handler = createSlicerBridgeHandler({
      configuration,
      fileStore: { persist },
      launch,
    })

    const response = await handler(handoffRequest({}))

    expect(response.status).toBe(200)
    await expect(parsedResponse(response)).resolves.toMatchObject({
      ok: true,
      requestId,
      slicerId: "orca-slicer",
    })
    expect(persist).toHaveBeenCalledWith("Bracket.3mf", new Uint8Array([80, 75, 3, 4]))
    expect(launch).toHaveBeenCalledWith({
      slicerId: "orca-slicer",
      filePath: "/tmp/Bracket.3mf",
    })
    expect(scheduleCleanup).toHaveBeenCalledOnce()
  })

  it("deduplicates a completed request without launching twice", async () => {
    const launch = vi.fn(async () => ({
      slicerId: "orca-slicer" as const,
      executable: "/Applications/OrcaSlicer",
    }))
    const persist = vi.fn(async () => ({ path: "/tmp/Bracket.3mf", scheduleCleanup: vi.fn() }))
    const handler = createSlicerBridgeHandler({ configuration, fileStore: { persist }, launch })

    const first = await handler(handoffRequest({}))
    const second = await handler(handoffRequest({}))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(persist).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledOnce()
  })

  it("rejects unpaired origins, invalid credentials, metadata, and bytes", async () => {
    const handler = createSlicerBridgeHandler({
      configuration,
      fileStore: {
        persist: vi.fn(async () => ({ path: "/tmp/file", scheduleCleanup: vi.fn() })),
      },
      launch: vi.fn(),
    })

    expect((await handler(handoffRequest({ origin: "https://evil.example" }))).status).toBe(403)
    await expect(
      parsedResponse(await handler(handoffRequest({ token: "b".repeat(43) }))),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "unauthorized" } })
    await expect(
      parsedResponse(await handler(handoffRequest({ filename: "../bad.3mf" }))),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "invalid-request" } })
    await expect(
      parsedResponse(await handler(handoffRequest({ bytes: new Uint8Array([1, 2, 3, 4]) }))),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "invalid-request" } })
  })

  it("reports an unavailable slicer without exposing a file path", async () => {
    const handler = createSlicerBridgeHandler({
      configuration,
      fileStore: {
        persist: vi.fn(async () => ({
          path: "/secret/path/Bracket.3mf",
          scheduleCleanup: vi.fn(),
        })),
      },
      launch: vi.fn(async ({ slicerId }) => {
        const { SlicerNotInstalledError } = await import("./launcher")
        throw new SlicerNotInstalledError(slicerId)
      }),
    })

    const response = await handler(handoffRequest({}))
    const result = await parsedResponse(response)

    expect(response.status).toBe(404)
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "slicer-not-installed", retryable: false },
    })
    expect(JSON.stringify(result)).not.toContain("/secret/path")
  })
})
