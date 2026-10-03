import { coneFeatureType, createLengthQuantity } from "@vibeshape/domain"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerResponse,
  documentWorkerResponseSchema,
} from "@vibeshape/protocol"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { DocumentWorkerRuntime } from "./runtime"

const engine = new ReplicadGeometryEngine()
const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f3000"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"
beforeAll(async () => {
  const filesystem = await vi.importActual<{ readFileSync(path: URL): Uint8Array }>("node:fs")
  const wasmBinary = filesystem.readFileSync(
    new URL("../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(Uint8Array.from(wasmBinary))),
  )
  try {
    await engine.initialize()
  } finally {
    vi.unstubAllGlobals()
  }
})
afterAll(() => {
  engine.disposeDocument(documentId)
})

describe("real cone document rebuild", () => {
  it.each([false, true])(
    "publishes valid coordinated worker geometry with centered=%s",
    async (centered) => {
      const messages: DocumentWorkerResponse[] = []
      const runtime = new DocumentWorkerRuntime(engine, {
        postMessage: (message) => {
          messages.push(message)
        },
      })
      try {
        await runtime.handle({
          protocolVersion: DOCUMENT_PROTOCOL_VERSION,
          requestId: "cone-rebuild",
          documentId,
          revision: 1,
          generation: 1,
          type: "rebuildDocument",
          document: {
            schemaVersion: 0,
            id: documentId,
            revision: 1,
            name: "Cone transport regression",
            displayUnits: { length: "mm", angle: "deg" },
            variables: [],
            sketches: [],
            features: [
              {
                schemaVersion: 0,
                id: featureId,
                type: coneFeatureType.type,
                parameters: {
                  radius: createLengthQuantity(12),
                  height: createLengthQuantity(35),
                  centered,
                  origin: {
                    x: createLengthQuantity(40),
                    y: createLengthQuantity(-8),
                    z: createLengthQuantity(0),
                  },
                },
                dependencies: [],
                references: [],
                suppressed: false,
              },
            ],
            createdAt: "2026-10-03T00:00:00Z",
            updatedAt: "2026-10-03T00:00:00Z",
          },
          mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
        })
        const rebuilt = messages.find(({ type }) => type === "documentRebuilt")
        if (rebuilt?.type !== "documentRebuilt") throw new Error(JSON.stringify(messages))
        expect(documentWorkerResponseSchema.safeParse(rebuilt).success).toBe(true)
        expect(rebuilt.evaluation.records).toMatchObject([{ featureId, status: "succeeded" }])
        expect(rebuilt.geometry).toHaveLength(1)
        expect(rebuilt.geometry[0]?.geometry.shape).toMatchObject({ valid: true, solidCount: 1 })
        expect(
          rebuilt.geometry[0]?.geometry.topologyCandidates.filter(
            ({ kind, signature }) => kind === "edge" && signature.measure === 0,
          ),
        ).toEqual([expect.not.objectContaining({ referenceGeometry: expect.anything() })])
      } finally {
        engine.disposeDocument(documentId)
        expect(engine.getHealth().ownedShapeCount).toBe(0)
      }
    },
  )
})
