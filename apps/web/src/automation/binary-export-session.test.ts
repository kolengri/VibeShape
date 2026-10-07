import {
  BINARY_EXPORT_CHUNK_MAX_BYTES,
  BINARY_EXPORT_MAX_BYTES,
  BINARY_EXPORT_TTL_MS,
  type BinaryExportChunk,
  type BinaryExportDescriptor,
} from "@vibeshape/automation-api/binary-exports"
import { localOperationSchema } from "@vibeshape/automation-api/local-tools"
import { describe, expect, it, vi } from "vitest"
import { type BinaryExportSourcePort, createBinaryExportSession } from "./binary-export-session"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = { type: "mcp", clientId: "org.example.client", sessionId: id(2) }
const prepareOperation = {
  tool: "prepare_model_export",
  arguments: { revision: 4, format: "step" },
} as const
function fixture(source: Uint8Array = new Uint8Array([1, 2, 3, 4, 5])) {
  let revision = 4,
    active = true,
    now = Date.parse("2026-10-04T00:00:00Z"),
    nextId = 10
  const prepare = vi
    .fn<BinaryExportSourcePort["prepare"]>()
    .mockImplementation(async (format, requested) => ({
      ok: true,
      documentId: id(1),
      revision: requested,
      format,
      file: source,
    }))
  const hash = vi.fn().mockResolvedValue("a".repeat(64))
  const session = createBinaryExportSession({
    documentId: id(1),
    currentRevision: () => revision,
    isActive: () => active,
    prepare,
    hash,
    now: () => now,
    createExportId: () => id(nextId++),
  })
  return {
    session,
    prepare,
    hash,
    setRevision: (value: number) => {
      revision = value
    },
    setActive: (value: boolean) => {
      active = value
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}
function success<T>(value: unknown): T {
  const result = value as { ok: boolean; value: T; diagnostic?: unknown }
  expect(result.ok, JSON.stringify(result.diagnostic)).toBe(true)
  return result.value
}
function read(exportId: string, offset = 0, limit = BINARY_EXPORT_CHUNK_MAX_BYTES) {
  return { tool: "read_export_chunk", arguments: { exportId, offset, limit } } as const
}
describe("paired binary export session", () => {
  it("forwards explicit mesh quality to the revision-bound export source", async () => {
    const f = fixture()
    const meshQuality = { chordTolerance: 0.01, angularTolerance: 0.05 }
    const result = await f.session.execute(actor, {
      tool: "prepare_model_export",
      arguments: { revision: 4, format: "3mf", meshQuality },
    })
    expect(result.ok).toBe(true)
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith("3mf", 4, meshQuality)
  })
  it("copies source bytes and preserves immutable export provenance after later document edits", async () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]),
      f = fixture(source)
    const file = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    source.fill(99)
    f.setRevision(5)
    const first = success<BinaryExportChunk>(
      await f.session.execute(actor, read(file.exportId, 0, 3)),
    )
    const last = success<BinaryExportChunk>(await f.session.execute(actor, read(file.exportId, 3)))
    expect(first).toMatchObject({ documentId: id(1), revision: 4, base64: "AQID", nextOffset: 3 })
    expect(last).toMatchObject({ base64: "BAU=", byteLength: 2, nextOffset: null })
    expect(f.hash).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4, 5]))
    expect(
      success<BinaryExportChunk>(await f.session.execute(actor, read(file.exportId, 5))),
    ).toMatchObject({ base64: "", nextOffset: null })
    expect(await f.session.execute(actor, read(file.exportId, 6))).toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-export-offset" },
    })
  })
  it("denies another paired actor and user actors without exposing retained bytes", async () => {
    const f = fixture(),
      file = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    for (const other of [
      { ...actor, sessionId: id(3) },
      { ...actor, clientId: "org.example.other" },
      { type: "user" },
    ])
      expect(await f.session.execute(other, read(file.exportId))).toMatchObject({
        ok: false,
        diagnostic: { code: "export-owner-mismatch" },
      })
    expect(
      success<BinaryExportChunk>(await f.session.execute(actor, read(file.exportId))).byteLength,
    ).toBe(5)
  })
  it("expires files without renewing their TTL on reads and evicts the previous preparation", async () => {
    const f = fixture(),
      first = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    f.advance(BINARY_EXPORT_TTL_MS - 1)
    success(await f.session.execute(actor, read(first.exportId)))
    f.advance(1)
    expect(await f.session.execute(actor, read(first.exportId))).toMatchObject({
      ok: false,
      diagnostic: { code: "export-unavailable" },
    })
    const second = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    const third = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    expect(await f.session.execute(actor, read(second.exportId))).toMatchObject({ ok: false })
    success(await f.session.execute(actor, read(third.exportId)))
  })
  it("discards idempotently but cannot discard a different retained file", async () => {
    const f = fixture(),
      file = success<BinaryExportDescriptor>(await f.session.execute(actor, prepareOperation))
    expect(
      await f.session.execute(actor, { tool: "discard_export", arguments: { exportId: id(99) } }),
    ).toMatchObject({ ok: false })
    for (let i = 0; i < 2; i++)
      expect(
        await f.session.execute(actor, {
          tool: "discard_export",
          arguments: { exportId: file.exportId },
        }),
      ).toEqual({ ok: true, value: { exportId: file.exportId, discarded: true } })
    expect(await f.session.execute(actor, read(file.exportId))).toMatchObject({ ok: false })
  })
  it.each(["signal", "cancel", "dispose", "revision", "inactive"] as const)(
    "drops late native output after %s and prevents concurrent preparation",
    async (cause) => {
      const f = fixture(),
        controller = new AbortController()
      let resolve!: (result: Awaited<ReturnType<BinaryExportSourcePort["prepare"]>>) => void
      f.prepare.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      const pending = f.session.execute(actor, prepareOperation, controller.signal)
      expect(await f.session.execute(actor, prepareOperation)).toMatchObject({
        ok: false,
        diagnostic: { code: "export-busy" },
      })
      if (cause === "signal") controller.abort()
      if (cause === "cancel") f.session.cancel()
      if (cause === "dispose") f.session.dispose()
      if (cause === "revision") f.setRevision(5)
      if (cause === "inactive") f.setActive(false)
      resolve({
        ok: true,
        documentId: id(1),
        revision: 4,
        format: "step",
        file: new Uint8Array([1]),
      })
      expect(await pending).toMatchObject({ ok: false, diagnostic: { code: "session-revoked" } })
      expect(f.hash).not.toHaveBeenCalled()
      expect(await f.session.execute(actor, read(id(10)))).toMatchObject({ ok: false })
    },
  )
  it("checks revision again after hashing before retaining bytes", async () => {
    const f = fixture()
    f.hash.mockImplementationOnce(async () => {
      f.setRevision(5)
      return "a".repeat(64)
    })
    expect(await f.session.execute(actor, prepareOperation)).toMatchObject({
      ok: false,
      diagnostic: { code: "session-revoked" },
    })
    expect(await f.session.execute(actor, read(id(10)))).toMatchObject({ ok: false })
  })
  it("rejects wrong source provenance, oversized output and an already stale request", async () => {
    const f = fixture()
    for (const changed of [{ documentId: id(99) }, { revision: 3 }, { format: "stl" as const }]) {
      f.prepare.mockResolvedValueOnce({
        ok: true,
        documentId: id(1),
        revision: 4,
        format: "step",
        file: new Uint8Array([1]),
        ...changed,
      })
      expect(await f.session.execute(actor, prepareOperation)).toMatchObject({
        ok: false,
        diagnostic: { code: "stale-revision" },
      })
    }
    f.prepare.mockResolvedValueOnce({
      ok: true,
      documentId: id(1),
      revision: 4,
      format: "step",
      file: new Uint8Array(BINARY_EXPORT_MAX_BYTES + 1),
    })
    expect(await f.session.execute(actor, prepareOperation)).toMatchObject({
      ok: false,
      diagnostic: { code: "export-too-large" },
    })
    f.setRevision(5)
    expect(await f.session.execute(actor, prepareOperation)).toMatchObject({
      ok: false,
      diagnostic: { code: "stale-revision" },
    })
    expect(f.prepare).toHaveBeenCalledTimes(4)
  })
  it("prepares editable backups through the same captured read-only source", async () => {
    const f = fixture(),
      file = success<BinaryExportDescriptor>(
        await f.session.execute(actor, {
          tool: "prepare_project_backup",
          arguments: { revision: 4 },
        }),
      )
    expect(file).toMatchObject({
      format: "vshape",
      filename: "model.vshape",
      mimeType: "application/octet-stream",
    })
    expect(f.prepare).toHaveBeenCalledWith("vshape", 4)
    expect(localOperationSchema.parse(read(file.exportId)).arguments).toMatchObject({
      limit: BINARY_EXPORT_CHUNK_MAX_BYTES,
    })
  })
})
