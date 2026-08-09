// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SLICER_ID,
  handoffThreeMfToSlicer,
  PREFERRED_SLICER_STORAGE_KEY,
  readPreferredSlicer,
  readSlicerBridgeToken,
  removeSlicerBridgeToken,
  savePreferredSlicer,
  saveSlicerBridgeToken,
  SLICER_BRIDGE_TOKEN_STORAGE_KEY,
} from "./slicer-handoff"

const token = "a".repeat(43)
const requestId = "0195b5ac-b220-7a2c-8c33-67a36a7f4101" as const

afterEach(() => {
  vi.restoreAllMocks()
})

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe("slicer handoff preferences", () => {
  it("persists the preferred slicer and bridge credential", () => {
    const storage = memoryStorage()
    expect(readPreferredSlicer(storage)).toBe(DEFAULT_SLICER_ID)
    expect(savePreferredSlicer("bambu-studio", storage)).toBe(true)
    expect(storage.getItem(PREFERRED_SLICER_STORAGE_KEY)).toBe("bambu-studio")
    expect(readPreferredSlicer(storage)).toBe("bambu-studio")

    expect(saveSlicerBridgeToken(` ${token} `, storage)).toBe(true)
    expect(storage.getItem(SLICER_BRIDGE_TOKEN_STORAGE_KEY)).toBe(token)
    expect(readSlicerBridgeToken(storage)).toBe(token)
    expect(removeSlicerBridgeToken(storage)).toBe(true)
    expect(readSlicerBridgeToken(storage)).toBeNull()
  })

  it("fails closed without breaking the export flow when storage is blocked or corrupt", () => {
    const blockedStorage = {
      getItem: vi.fn(() => {
        throw new Error("Storage blocked")
      }),
      setItem: vi.fn(() => {
        throw new Error("Storage blocked")
      }),
      removeItem: vi.fn(() => {
        throw new Error("Storage blocked")
      }),
    }

    expect(readPreferredSlicer({ getItem: () => "unknown" })).toBe(DEFAULT_SLICER_ID)
    expect(readSlicerBridgeToken({ getItem: () => "not a token" })).toBeNull()
    expect(readPreferredSlicer(blockedStorage)).toBe(DEFAULT_SLICER_ID)
    expect(savePreferredSlicer("prusa-slicer", blockedStorage)).toBe(false)
    expect(saveSlicerBridgeToken(token, blockedStorage)).toBe(false)
    expect(removeSlicerBridgeToken(blockedStorage)).toBe(false)
  })
})

describe("slicer bridge client", () => {
  it("sends owned 3MF bytes with an authenticated exact request", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const parsedUrl = new URL(String(url))
      return Response.json({
        protocolVersion: 1,
        ok: true,
        requestId: parsedUrl.searchParams.get("requestId"),
        slicerId: parsedUrl.searchParams.get("slicerId"),
        filename: parsedUrl.searchParams.get("filename"),
      })
    })

    await expect(
      handoffThreeMfToSlicer({
        file: new Uint8Array([80, 75, 3, 4]),
        filename: "Printer bracket.3mf",
        slicerId: "snapmaker-orca",
        token,
        fetch,
        createRequestId: () => requestId,
      }),
    ).resolves.toEqual({ ok: true })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const parsedUrl = new URL(url)
    expect(parsedUrl.origin).toBe("http://127.0.0.1:43113")
    expect(parsedUrl.pathname).toBe("/v1/handoffs")
    expect(parsedUrl.searchParams.get("slicerId")).toBe("snapmaker-orca")
    expect(parsedUrl.searchParams.get("filename")).toBe("Printer bracket.3mf")
    expect(url).not.toContain(token)
    expect(init.headers).toEqual({ Authorization: `Bearer ${token}`, "Content-Type": "model/3mf" })
    expect(init.credentials).toBe("omit")
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it("distinguishes missing configuration, bridge rejection, and network failure", async () => {
    await expect(
      handoffThreeMfToSlicer({
        file: new Uint8Array([80, 75, 3, 4]),
        filename: "Bracket.3mf",
        slicerId: "orca-slicer",
        token: null,
      }),
    ).resolves.toEqual({ ok: false, reason: "not-configured" })

    const rejectedFetch = vi.fn(async () =>
      Response.json(
        {
          protocolVersion: 1,
          ok: false,
          diagnostic: {
            code: "slicer-not-installed",
            message: "OrcaSlicer is not installed or configured.",
            retryable: false,
          },
        },
        { status: 404 },
      ),
    )
    await expect(
      handoffThreeMfToSlicer({
        file: new Uint8Array([80, 75, 3, 4]),
        filename: "Bracket.3mf",
        slicerId: "orca-slicer",
        token,
        fetch: rejectedFetch,
        createRequestId: () => requestId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "rejected",
      diagnostic: { code: "slicer-not-installed" },
    })

    await expect(
      handoffThreeMfToSlicer({
        file: new Uint8Array([80, 75, 3, 4]),
        filename: "Bracket.3mf",
        slicerId: "orca-slicer",
        token,
        fetch: vi.fn(async () => {
          throw new TypeError("Failed to fetch")
        }),
        createRequestId: () => requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" })
  })
})
