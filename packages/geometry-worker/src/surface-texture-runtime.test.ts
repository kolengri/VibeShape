import { describe, expect, it } from "bun:test"
import {
  GEOMETRY_PROTOCOL_VERSION,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
} from "@vibeshape/protocol"
import type { GeometryKernelEngine } from "./engine"
import { GeometryWorkerRuntime } from "./runtime"

function request(
  requestId: string,
  generation = 1,
): Extract<GeometryWorkerRequest, { type: "textureMesh" }> {
  return {
    protocolVersion: GEOMETRY_PROTOCOL_VERSION,
    requestId,
    documentId: "texture-preview",
    revision: 1,
    generation,
    type: "textureMesh",
    mesh: {
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]),
      normals: new Float32Array(12),
      indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
      triangleFaceIds: new Uint32Array([1, 2, 3, 4]),
    },
    layers: [
      {
        id: "test",
        enabled: true,
        targetFaceIds: null,
        mask: { base: "all", strokes: [] },
        map: { kind: "builtin", pattern: "ridges" },
        mapping: { kind: "triplanar", axis: "z" },
        heightMm: 0.1,
        sizeUMm: 2,
        sizeVMm: 2,
        rotationDeg: 0,
        offsetUMm: 0,
        offsetVMm: 0,
        direction: "outward",
        invert: false,
        boundaryFadeMm: 0,
        blend: "add",
      },
    ],
    quality: { maxEdgeLengthMm: 0.25, maxTriangles: 20_000 },
  }
}

describe("surface texture worker lifecycle", () => {
  it("runs without the exact kernel and transfers every owned derived buffer", async () => {
    const messages: GeometryWorkerResponse[] = []
    const transfers: Transferable[][] = []
    const runtime = new GeometryWorkerRuntime({} as GeometryKernelEngine, {
      postMessage: (message, transfer) => {
        messages.push(message)
        transfers.push(transfer ?? [])
      },
    })
    const input = request("preview")
    await runtime.handle(input)
    expect(messages.at(-1)).toMatchObject({
      type: "surfaceTexturePreviewed",
      statistics: { sourceTriangleCount: 4 },
    })
    expect(transfers.at(-1)).toHaveLength(4)
    expect(input.mesh.positions).toHaveLength(12)
  })

  it("cancels active refinement without publishing a late preview", async () => {
    const messages: GeometryWorkerResponse[] = []
    const runtime = new GeometryWorkerRuntime({} as GeometryKernelEngine, {
      postMessage: (message) => {
        messages.push(message)
        if (message.type === "progress")
          void runtime.handle({
            protocolVersion: GEOMETRY_PROTOCOL_VERSION,
            requestId: "cancel-preview",
            documentId: "texture-preview",
            revision: 1,
            generation: 1,
            type: "cancel",
            targetRequestId: "preview",
          })
      },
    })
    await runtime.handle(request("preview"))
    expect(messages.at(-1)).toMatchObject({
      type: "requestCancelled",
      reason: "cancelled",
      targetRequestId: "preview",
    })
    expect(messages.some((message) => message.type === "surfaceTexturePreviewed")).toBe(false)
  })

  it("drops a stale generation and processes only the newer preview", async () => {
    const messages: GeometryWorkerResponse[] = []
    let newer: Promise<void> | undefined
    const runtime = new GeometryWorkerRuntime({} as GeometryKernelEngine, {
      postMessage: (message) => {
        messages.push(message)
        if (message.type === "progress" && message.requestId === "old" && !newer)
          newer = runtime.handle(request("new", 2))
      },
    })
    await runtime.handle(request("old"))
    await newer
    expect(
      messages.find(
        (message) => message.requestId === "old" && message.type === "requestCancelled",
      ),
    ).toMatchObject({ reason: "stale-generation" })
    expect(
      messages
        .filter((message) => message.type === "surfaceTexturePreviewed")
        .map((message) => message.requestId),
    ).toEqual(["new"])
  })
})
