import type { MeshImportInspection, SourceImportInspection } from "@vibeshape/protocol"
import type { ImportDocumentContext, ImportFile } from "./import-model"
export const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
export const context: ImportDocumentContext = {
  documentId: id(1),
  revision: 7,
  authorityVersion: 2,
  historyAfter: null,
}
export const inspection: SourceImportInspection = {
  unitEvidence: "explicit-source-metadata",
  outputs: [
    {
      signature: {
        volume: 1000,
        area: 600,
        centroid: [5, 5, 5],
        bounds: { min: [0, 0, 0], max: [10, 10, 10] },
        faceCount: 6,
        edgeCount: 24,
      },
      mesh: {
        positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        triangleFaceIds: new Uint32Array([1]),
      },
    },
  ],
}
export function sourceFile(name = "source.step", bytes = new Uint8Array([1, 2, 3])): ImportFile {
  return { name, size: bytes.byteLength, arrayBuffer: async () => Uint8Array.from(bytes).buffer }
}

export const meshInspection: MeshImportInspection = {
  normalization: { sourceUnit: "millimeter", scaleToMillimeters: 1, normalizedUnit: "millimeter" },
  outputs: [
    {
      nodeKey: "build-node-1",
      shape: {
        valid: true,
        volume: 0,
        surfaceArea: 50,
        bounds: { min: [0, 0, 0], max: [10, 10, 0] },
        solidCount: 0,
        faceCount: 0,
        edgeCount: 0,
      },
      mesh: {
        positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        triangleFaceIds: new Uint32Array([0]),
      },
    },
  ],
  warnings: [],
}
