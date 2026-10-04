import { describe, expect, it } from "vitest"
import { IMPORT_UPLOAD_CHUNK_MAX_BYTES, IMPORT_UPLOAD_MAX_BYTES } from "./imports"
import { localOperationSchema, localToolOutputs } from "./local-tools"
import {
  localPlanarImportInputs,
  planarImportResultMatches,
  planarUploadDescriptorSchema,
  planarUploadInspectionSchema,
} from "./planar-imports"
import {
  REMOTE_MESSAGE_MAX_BYTES,
  REMOTE_SESSION_MAX_OPERATIONS,
  remoteOperationSchema,
} from "./remote-session"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const input = {
  revision: 4,
  filename: "outline.svg",
  byteLength: 3,
  unit: "mm",
  plane: "xz",
} as const
const upload = {
  uploadId: id(1),
  documentId: id(2),
  baseRevision: 4,
  uploadVersion: 0,
  filename: input.filename,
  format: "svg",
  unit: "mm",
  plane: "xz",
  byteLength: 3,
  receivedBytes: 0,
  sha256: null,
  status: "uploading",
  expiresAt: "2026-10-04T01:00:00Z",
  chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
} as const
const inspection = {
  upload: {
    ...upload,
    uploadVersion: 2,
    receivedBytes: 3,
    status: "ready",
    sha256: "a".repeat(64),
  },
  sketchId: id(3),
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  unitPolicy: "selected",
  bounds: { min: [0, 0], max: [10, 20] },
  pathOutputs: [id(4)],
  closedPaths: 1,
  curves: 4,
} as const
describe("bounded SVG/DXF import wire contract", () => {
  it("exposes five strict named tools in both transports and rejects caller authority", () => {
    for (const operation of [
      { tool: "begin_planar_import_upload", arguments: input },
      {
        tool: "append_planar_import_chunk",
        arguments: { uploadId: id(1), offset: 0, base64: "AQID" },
      },
      { tool: "inspect_planar_import_upload", arguments: { uploadId: id(1) } },
      { tool: "commit_planar_import_upload", arguments: { uploadId: id(1), uploadVersion: 2 } },
      { tool: "discard_planar_import_upload", arguments: { uploadId: id(1) } },
    ]) {
      expect(localOperationSchema.safeParse(operation).success).toBe(true)
      expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
      for (const extra of [
        { actor: {} },
        { sha256: "a".repeat(64) },
        { path: "/private/source.svg" },
        { approved: true },
        { matrix: [1, 0, 0, 1, 0, 0] },
      ])
        expect(
          localOperationSchema.safeParse({
            ...operation,
            arguments: { ...operation.arguments, ...extra },
          }).success,
        ).toBe(false)
    }
  })
  it("validates explicit SVG units and DXF declared or selected physical units, safe filenames and file limits", () => {
    const schema = localPlanarImportInputs.begin_planar_import_upload
    for (const unit of ["mm", "cm", "m", "in", "ft", "um", "px"])
      expect(schema.safeParse({ ...input, unit }).success).toBe(true)
    for (const unit of ["declared", "mm", "in"])
      expect(schema.safeParse({ ...input, filename: "circle.dxf", unit }).success).toBe(true)
    for (const invalid of [
      { ...input, unit: "declared" },
      { ...input, filename: "circle.dxf", unit: "px" },
      { ...input, filename: "source.step" },
      { ...input, filename: "../outline.svg" },
      { ...input, byteLength: IMPORT_UPLOAD_MAX_BYTES + 1 },
      { ...input, plane: "custom" },
    ])
      expect(schema.safeParse(invalid).success).toBe(false)
  })
  it("correlates source intent, units, plane, owned identity, document and inspected version", () => {
    const begin = { tool: "begin_planar_import_upload", arguments: input } as const
    expect(planarImportResultMatches(begin, upload, id(2))).toBe(true)
    for (const change of [
      { documentId: id(9) },
      { unit: "in" },
      { plane: "xy" },
      { filename: "other.svg" },
      { baseRevision: 3 },
      { receivedBytes: 1 },
      { uploadVersion: 1 },
    ])
      expect(planarImportResultMatches(begin, { ...upload, ...change }, id(2))).toBe(false)
    const inspect = {
      tool: "inspect_planar_import_upload",
      arguments: { uploadId: id(1) },
    } as const
    expect(planarImportResultMatches(inspect, inspection, id(2))).toBe(true)
    expect(
      planarImportResultMatches(
        inspect,
        { ...inspection, upload: { ...inspection.upload, uploadId: id(9) } },
        id(2),
      ),
    ).toBe(false)
    const commit = {
      tool: "commit_planar_import_upload",
      arguments: { uploadId: id(1), uploadVersion: 2 },
    } as const
    const value = {
      uploadId: id(1),
      uploadVersion: 2,
      documentId: id(2),
      baseRevision: 4,
      revision: 6,
      sketchId: id(3),
      pathOutputs: [id(4)],
    }
    expect(planarImportResultMatches(commit, value, id(2))).toBe(true)
    expect(planarImportResultMatches(commit, { ...value, uploadVersion: 1 })).toBe(false)
    expect(
      localToolOutputs.commit_planar_import_upload.safeParse({
        ok: true,
        value: { ...value, revision: 4 },
      }).success,
    ).toBe(false)
  })
  it("fails closed on forged normalization, policy, path manifests, bounds and incomplete captured uploads", () => {
    expect(planarUploadInspectionSchema.safeParse(inspection).success).toBe(true)
    for (const change of [
      { unitPolicy: "declared" },
      { normalization: { ...inspection.normalization, sourceUnit: "inch" } },
      { normalization: { ...inspection.normalization, scaleToMillimeters: 25.4 } },
      { pathOutputs: [id(4), id(4)] },
      { closedPaths: 2 },
      { curves: 0 },
      { bounds: { min: [1, 0], max: [0, 1] } },
    ])
      expect(planarUploadInspectionSchema.safeParse({ ...inspection, ...change }).success).toBe(
        false,
      )
    expect(
      planarUploadInspectionSchema.safeParse({
        ...inspection,
        upload: { ...inspection.upload, filename: "outline.dxf", format: "dxf", unit: "declared" },
        unitPolicy: "declared",
        normalization: {
          sourceUnit: "unitless",
          scaleToMillimeters: 25.4 / 96,
          normalizedUnit: "millimeter",
        },
      }).success,
    ).toBe(false)
    expect(
      planarUploadDescriptorSchema.safeParse({ ...upload, status: "ready", sha256: "a".repeat(64) })
        .success,
    ).toBe(false)
  })
  it("fits a full source into unchanged remote message and operation budgets", () => {
    const operation = {
      tool: "append_planar_import_chunk",
      arguments: {
        uploadId: id(1),
        offset: 0,
        base64: "A".repeat((IMPORT_UPLOAD_CHUNK_MAX_BYTES / 3) * 4),
      },
    }
    expect(remoteOperationSchema.safeParse(operation).success).toBe(true)
    expect(JSON.stringify(operation).length).toBeLessThan(REMOTE_MESSAGE_MAX_BYTES)
    expect(
      Math.ceil(IMPORT_UPLOAD_MAX_BYTES / IMPORT_UPLOAD_CHUNK_MAX_BYTES) + 4,
    ).toBeLessThanOrEqual(REMOTE_SESSION_MAX_OPERATIONS)
  })
})
