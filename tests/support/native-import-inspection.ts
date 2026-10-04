import { IMPORT_UPLOAD_CHUNK_MAX_BYTES } from "../../packages/automation-api/src/imports"

export function nativeImportInspection(format: "step" | "brep" | "stl" | "3mf") {
  const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
  const exact = format === "step" || format === "brep"
  return {
    upload: {
      uploadId: id(1),
      documentId: id(2),
      baseRevision: 4,
      uploadVersion: 1,
      filename: `source.${format}`,
      format,
      sourceUnit: format === "3mf" ? null : "millimeter",
      byteLength: 3,
      receivedBytes: 3,
      sha256: "a".repeat(64),
      status: "ready",
      expiresAt: "2099-10-04T00:00:00Z",
      chunkMaxBytes: IMPORT_UPLOAD_CHUNK_MAX_BYTES,
    },
    featureId: id(3),
    representation: exact ? "exact-solid" : "triangle-mesh",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [
      {
        outputRole: `body.${id(4)}`,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        volumeMm3: exact ? 1 : null,
        surfaceAreaMm2: 6,
        triangleCount: 12,
      },
    ],
    warnings: [],
  }
}
