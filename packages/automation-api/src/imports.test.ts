import { describe, expect, it } from "vitest"
import { nativeImportInspection } from "../../../tests/support/native-import-inspection"
import {
  IMPORT_UPLOAD_CHUNK_MAX_BYTES,
  IMPORT_UPLOAD_MAX_BYTES,
  importResultMatches,
  importUploadCommitSchema,
  importUploadDescriptorSchema,
  importUploadInspectionSchema,
  localImportInputs,
} from "./imports"
import { localOperationSchema, localToolInputs } from "./local-tools"
import {
  REMOTE_MESSAGE_MAX_BYTES,
  REMOTE_SESSION_MAX_OPERATIONS,
  remoteOperationSchema,
  remoteServerMessageSchema,
} from "./remote-session"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const descriptor = {
  uploadId: id(1),
  documentId: id(2),
  baseRevision: 4,
  uploadVersion: 0,
  filename: "source.step",
  format: "step",
  sourceUnit: "millimeter",
  byteLength: 3,
  receivedBytes: 0,
  sha256: null,
  status: "uploading",
  expiresAt: "2026-10-04T01:00:00Z",
  chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
} as const
describe("bounded native import wire contract", () => {
  it.each(["step", "brep", "stl", "3mf"] as const)(
    "binds %s inspection representation to its captured file format",
    (format) => {
      const value = nativeImportInspection(format)
      const operation = localOperationSchema.parse({
        tool: "inspect_import_upload",
        arguments: { uploadId: value.upload.uploadId },
      })
      if (operation.tool !== "inspect_import_upload") throw new Error("Expected import inspection.")
      expect(importUploadInspectionSchema.safeParse(value).success).toBe(true)
      expect(importResultMatches(operation, value)).toBe(true)
      const forged = {
        ...value,
        representation: value.representation === "exact-solid" ? "triangle-mesh" : "exact-solid",
        outputs: value.outputs.map((output) => ({
          ...output,
          volumeMm3: output.volumeMm3 === null ? 1 : null,
        })),
      }
      expect(importUploadInspectionSchema.safeParse(forged).success).toBe(false)
      expect(() => importResultMatches(operation, forged)).toThrow()
    },
  )

  it("exposes the same five strict tools locally and remotely", () => {
    for (const operation of [
      {
        tool: "begin_import_upload",
        arguments: {
          revision: 4,
          filename: "source.step",
          byteLength: 3,
          sourceUnit: "millimeter",
        },
      },
      { tool: "append_import_chunk", arguments: { uploadId: id(1), offset: 0, base64: "AQID" } },
      { tool: "inspect_import_upload", arguments: { uploadId: id(1) } },
      { tool: "commit_import_upload", arguments: { uploadId: id(1), uploadVersion: 2 } },
      { tool: "discard_import_upload", arguments: { uploadId: id(1) } },
    ])
      expect(remoteOperationSchema.parse(operation)).toEqual(localOperationSchema.parse(operation))
  })
  it.each(["source.step", "source.STP", "source.brep", "source.stl"])(
    "requires explicit physical units for %s",
    (filename) => {
      const input = { revision: 4, filename, byteLength: 3, sourceUnit: "inch" }
      expect(localImportInputs.begin_import_upload.safeParse(input).success).toBe(true)
      expect(
        localImportInputs.begin_import_upload.safeParse({ ...input, sourceUnit: null }).success,
      ).toBe(false)
      expect(
        localImportInputs.begin_import_upload.safeParse({ ...input, sourceUnit: "unitless" })
          .success,
      ).toBe(false)
    },
  )
  it("uses declared 3MF units and excludes caller authority, file paths and unsupported source types", () => {
    const input = { revision: 4, filename: "source.3mf", byteLength: 3, sourceUnit: null }
    expect(localImportInputs.begin_import_upload.safeParse(input).success).toBe(true)
    for (const invalid of [
      { ...input, sourceUnit: "millimeter" },
      { ...input, filename: "../source.3mf" },
      { ...input, filename: "source.svg" },
      { ...input, filename: "source.dxf" },
      { ...input, byteLength: IMPORT_UPLOAD_MAX_BYTES + 1 },
      { ...input, sha256: "a".repeat(64) },
      { ...input, actor: { type: "user" } },
      { ...input, path: "/private/file" },
      { ...input, pin: "approved" },
    ])
      expect(localImportInputs.begin_import_upload.safeParse(invalid).success).toBe(false)
  })
  it("correlates base, owned upload identity, source intent, document and captured version", () => {
    const begin = {
      tool: "begin_import_upload",
      arguments: { revision: 4, filename: "source.step", byteLength: 3, sourceUnit: "millimeter" },
    } as const
    expect(importResultMatches(begin, descriptor, id(2))).toBe(true)
    expect(importResultMatches(begin, descriptor, id(3))).toBe(false)
    expect(importResultMatches(begin, { ...descriptor, baseRevision: 3 })).toBe(false)
    const append = {
      tool: "append_import_chunk",
      arguments: { uploadId: id(1), offset: 0, base64: "AQID" },
    } as const
    expect(importResultMatches(append, { ...descriptor, receivedBytes: 3, uploadVersion: 1 })).toBe(
      true,
    )
    expect(importResultMatches(append, { ...descriptor, receivedBytes: 2, uploadVersion: 1 })).toBe(
      false,
    )
    expect(importResultMatches(append, { ...descriptor, uploadId: id(3), receivedBytes: 3 })).toBe(
      false,
    )
    const commit = {
      tool: "commit_import_upload",
      arguments: { uploadId: id(1), uploadVersion: 2 },
    } as const
    const result = {
      uploadId: id(1),
      uploadVersion: 2,
      documentId: id(2),
      baseRevision: 4,
      revision: 6,
      featureId: id(4),
      outputRoles: [`import.${id(5)}`],
    }
    expect(importResultMatches(commit, result, id(2))).toBe(true)
    expect(importResultMatches(commit, { ...result, uploadVersion: 1 })).toBe(false)
    expect(importResultMatches(commit, { ...result, uploadId: id(6) })).toBe(false)
    expect(
      importResultMatches(
        { tool: "discard_import_upload", arguments: { uploadId: id(1) } },
        { uploadId: id(6), discarded: true },
      ),
    ).toBe(false)
    expect(importUploadCommitSchema.safeParse({ ...result, revision: 4 }).success).toBe(false)
    expect(
      importUploadCommitSchema.safeParse({
        ...result,
        outputRoles: [result.outputRoles[0], result.outputRoles[0]],
      }).success,
    ).toBe(false)
  })
  it("rejects incomplete captured descriptors and inconsistent file representation metadata", () => {
    for (const invalid of [
      { ...descriptor, format: "stl" },
      { ...descriptor, sourceUnit: null },
      { ...descriptor, receivedBytes: 4 },
      { ...descriptor, status: "ready", sha256: "a".repeat(64) },
      { ...descriptor, sha256: "a".repeat(64) },
    ])
      expect(importUploadDescriptorSchema.safeParse(invalid).success).toBe(false)
    expect(
      importUploadDescriptorSchema.safeParse({
        ...descriptor,
        receivedBytes: 3,
        status: "ready",
        sha256: "a".repeat(64),
      }).success,
    ).toBe(true)
  })
  it("fits a full declared upload into remote per-message and session operation budgets", () => {
    const operation = {
      tool: "append_import_chunk",
      arguments: {
        uploadId: id(1),
        offset: 0,
        base64: "A".repeat((IMPORT_UPLOAD_CHUNK_MAX_BYTES / 3) * 4),
      },
    }
    const message = remoteServerMessageSchema.parse({
      type: "work",
      requestId: id(3),
      operation,
    })
    expect(JSON.stringify(message).length).toBeLessThan(REMOTE_MESSAGE_MAX_BYTES)
    expect(Math.ceil(IMPORT_UPLOAD_MAX_BYTES / IMPORT_UPLOAD_CHUNK_MAX_BYTES) + 4).toBeLessThan(
      REMOTE_SESSION_MAX_OPERATIONS,
    )
    expect(
      localToolInputs.append_import_chunk.safeParse({
        ...operation.arguments,
        base64: `${operation.arguments.base64}AAAA`,
      }).success,
    ).toBe(false)
  })
})
