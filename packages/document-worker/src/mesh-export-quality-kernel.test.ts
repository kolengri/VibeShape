import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createLengthQuantity, cylinderFeatureType } from "@vibeshape/domain"
import { parseGeometryImport } from "@vibeshape/formats/import"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerResponse,
  documentRebuildSnapshotSchema,
  printPreparationSettingsSchema,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { DocumentWorkerRuntime } from "./runtime"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const engine = new ReplicadGeometryEngine()
const messages: DocumentWorkerResponse[] = []
const runtime = new DocumentWorkerRuntime(engine, {
  postMessage: (message) => messages.push(message),
})
const envelope = {
  protocolVersion: DOCUMENT_PROTOCOL_VERSION,
  documentId,
  revision: 1,
  generation: 1,
}
beforeAll(async () => {
  const filesystem = await import("node:fs")
  const bytes = filesystem.readFileSync(
    new URL(
      "../../geometry-worker/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
      import.meta.url,
    ),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(bytes))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
  await runtime.handle({
    ...envelope,
    requestId: "rebuild",
    type: "rebuildDocument",
    mesh: { chordTolerance: 0.005, angularTolerance: 0.01 },
    document: documentRebuildSnapshotSchema.parse({
      schemaVersion: 0,
      id: documentId,
      revision: 1,
      name: "Export cylinder",
      displayUnits: { length: "mm", angle: "deg" },
      features: [
        {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          type: cylinderFeatureType.type,
          parameters: {
            radius: createLengthQuantity(20),
            height: createLengthQuantity(10),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      ],
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
    }),
  })
  expect(messages.find((message) => message.type === "documentRebuilt")?.type).toBe(
    "documentRebuilt",
  )
})
afterAll(() => engine.disposeDocument(documentId))
describe("document 3MF export mesh quality through the native worker", () => {
  it("changes serialized 3MF detail and retains chosen resolution in prepared print copies", async () => {
    const counts: number[] = []
    const choices = [
      { meshQuality: { chordTolerance: 0.2, angularTolerance: 0.3 } },
      { meshQuality: { chordTolerance: 0.01, angularTolerance: 0.05 } },
      {
        meshQuality: { chordTolerance: 0.01, angularTolerance: 0.05 },
        printPreparation: printPreparationSettingsSchema.parse({ rotationX: 0, supports: false }),
      },
    ]
    for (const [index, options] of choices.entries()) {
      const requestId = `export-${index}`
      await runtime.handle({
        ...envelope,
        requestId,
        type: "exportDocument",
        format: "3mf",
        ...options,
      })
      const result = messages.find(
        (message) => message.requestId === requestId && message.type === "documentExported",
      )
      if (result?.type !== "documentExported")
        throw new Error(
          JSON.stringify(messages.filter((message) => message.requestId === requestId)),
        )
      expect(result.bodyCount).toBe(1)
      const parsed = await parseGeometryImport({ format: "3mf", bytes: result.file })
      if (!parsed.ok || parsed.geometry.kind !== "triangle-mesh")
        throw new Error("Export must be a valid closed manifold 3MF mesh.")
      counts.push(parsed.geometry.meshes.reduce((sum, mesh) => sum + mesh.triangles.length, 0))
      if (options.printPreparation) {
        expect(result.printPreparation?.report.finCount).toBe(0)
        expect(result.printPreparation?.report.bounds[2]).toBeCloseTo(10, 4)
      }
    }
    expect(counts[1]).toBeGreaterThan(counts[0] ?? Infinity)
    expect(counts[2]).toBe(counts[1])
  })
})
