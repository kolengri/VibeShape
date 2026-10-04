import { describe, expect, it } from "vitest"
import {
  BINARY_EXPORT_CHUNK_MAX_BYTES,
  BINARY_EXPORT_MAX_BYTES,
  binaryExportChunkSchema,
  binaryExportDescriptorSchema,
  binaryExportResultMatches,
} from "./binary-exports"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  REMOTE_MESSAGE_MAX_BYTES,
  REMOTE_SESSION_MAX_OPERATIONS,
  remoteBrowserMessageSchema,
  remoteOperationSchema,
} from "./remote-session"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const descriptor = {
  exportId: id(1),
  documentId: id(2),
  revision: 4,
  format: "step",
  filename: "model.step",
  mimeType: "model/step",
  byteLength: 5,
  sha256: "a".repeat(64),
  expiresAt: "2026-10-04T01:00:00Z",
  chunkMaxBytes: BINARY_EXPORT_CHUNK_MAX_BYTES,
}
const chunk = {
  exportId: id(1),
  documentId: id(2),
  revision: 4,
  offset: 0,
  totalBytes: 5,
  byteLength: 3,
  base64: "AQID",
  nextOffset: 3,
}
describe("binary export wire contract", () => {
  it("advertises the same four bounded operations locally and remotely, excluding the legacy monolithic remote export", () => {
    for (const operation of [
      { tool: "prepare_model_export", arguments: { revision: 4, format: "step" } },
      { tool: "prepare_project_backup", arguments: { revision: 4 } },
      { tool: "read_export_chunk", arguments: { exportId: id(1), offset: 0 } },
      { tool: "discard_export", arguments: { exportId: id(1) } },
    ])
      expect(remoteOperationSchema.parse(operation)).toEqual(localOperationSchema.parse(operation))
    expect(
      remoteOperationSchema.safeParse({
        tool: "export_model",
        arguments: { revision: 4, format: "step" },
      }).success,
    ).toBe(false)
    expect(
      remoteOperationSchema.safeParse({
        tool: "read_export_chunk",
        arguments: { exportId: id(1), offset: 0, limit: BINARY_EXPORT_CHUNK_MAX_BYTES + 1 },
      }).success,
    ).toBe(false)
    expect(
      remoteOperationSchema.safeParse({
        tool: "prepare_project_backup",
        arguments: { revision: 4, path: "/private/file" },
      }).success,
    ).toBe(false)
  })
  it("correlates document, revision, format, export identity, offset and exact requested chunk length", () => {
    const preparation = {
      tool: "prepare_model_export",
      arguments: { revision: 4, format: "step" },
    } as const
    expect(binaryExportResultMatches(preparation, descriptor, id(2))).toBe(true)
    expect(binaryExportResultMatches(preparation, { ...descriptor, revision: 3 }, id(2))).toBe(
      false,
    )
    expect(binaryExportResultMatches(preparation, descriptor, id(3))).toBe(false)
    const read = {
      tool: "read_export_chunk",
      arguments: { exportId: id(1), offset: 0, limit: 3 },
    } as const
    expect(binaryExportResultMatches(read, chunk, id(2))).toBe(true)
    expect(binaryExportResultMatches(read, { ...chunk, exportId: id(3) }, id(2))).toBe(false)
    expect(
      binaryExportResultMatches(
        { ...read, arguments: { ...read.arguments, limit: 4 } },
        chunk,
        id(2),
      ),
    ).toBe(false)
    expect(
      binaryExportResultMatches(
        { ...read, arguments: { ...read.arguments, offset: 1 } },
        chunk,
        id(2),
      ),
    ).toBe(false)
    expect(
      binaryExportResultMatches(
        { tool: "discard_export", arguments: { exportId: id(1) } },
        { exportId: id(3), discarded: true },
      ),
    ).toBe(false)
  })
  it("rejects inconsistent byte lengths, invented cursors, malformed base64 and mismatched file types", () => {
    expect(binaryExportDescriptorSchema.safeParse(descriptor).success).toBe(true)
    expect(
      binaryExportDescriptorSchema.safeParse({ ...descriptor, mimeType: "model/stl" }).success,
    ).toBe(false)
    expect(
      binaryExportDescriptorSchema.safeParse({
        ...descriptor,
        byteLength: BINARY_EXPORT_MAX_BYTES + 1,
      }).success,
    ).toBe(false)
    for (const invalid of [
      { ...chunk, byteLength: 2 },
      { ...chunk, nextOffset: null },
      { ...chunk, nextOffset: 4 },
      { ...chunk, base64: "AQI?" },
      { ...chunk, offset: 4 },
      { ...chunk, byteLength: 0, base64: "", nextOffset: 0 },
    ])
      expect(binaryExportChunkSchema.safeParse(invalid).success).toBe(false)
  })
  it("keeps a maximum decoded chunk under the remote wire budget including base64 and envelope", () => {
    const maximum = {
      ...chunk,
      totalBytes: BINARY_EXPORT_MAX_BYTES,
      byteLength: BINARY_EXPORT_CHUNK_MAX_BYTES,
      base64: "A".repeat((BINARY_EXPORT_CHUNK_MAX_BYTES / 3) * 4),
      nextOffset: BINARY_EXPORT_CHUNK_MAX_BYTES,
    }
    const message = remoteBrowserMessageSchema.parse({
      type: "result",
      protocolVersion: 1,
      requestId: id(4),
      tool: "read_export_chunk",
      result: { ok: true, value: maximum },
    })
    if (message.type !== "result") throw new Error("Expected a binary result envelope.")
    expect(localToolOutputs.read_export_chunk.parse(message.result)).toMatchObject({ ok: true })
    // Every envelope field and the encoded binary chunk contain ASCII only.
    expect(JSON.stringify(message).length).toBeLessThan(REMOTE_MESSAGE_MAX_BYTES)
    expect(Math.ceil(BINARY_EXPORT_MAX_BYTES / BINARY_EXPORT_CHUNK_MAX_BYTES) + 2).toBeLessThan(
      REMOTE_SESSION_MAX_OPERATIONS,
    )
  })
})
