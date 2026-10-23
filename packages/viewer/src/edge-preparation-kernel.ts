import { BufferAttribute, BufferGeometry, EdgesGeometry } from "three"
import { MeshBVH } from "three-mesh-bvh"
import type { EdgePreparationRequest } from "./edge-preparation-schema"

function transferableIndirection(array: Uint16Array | Uint32Array) {
  const buffer = array.buffer
  if (!(buffer instanceof ArrayBuffer)) throw new Error("Invalid picking buffer.")
  return array instanceof Uint16Array
    ? new Uint16Array(buffer, array.byteOffset, array.length)
    : new Uint32Array(buffer, array.byteOffset, array.length)
}

/** Runs only in the worker; shares Three's exact display-crease algorithm and threshold. */
export function prepareCreaseEdges(request: EdgePreparationRequest) {
  const geometry = new BufferGeometry()
  let edges: EdgesGeometry | undefined
  try {
    geometry.setAttribute("position", new BufferAttribute(request.positions, 3))
    geometry.setIndex(new BufferAttribute(request.indices, 1))
    edges = new EdgesGeometry(geometry, 28)
    const attribute = edges.getAttribute("position")
    // Three owns this output array; transferring it never detaches a model buffer.
    const array = attribute.array
    if (!(array instanceof Float32Array) || !(array.buffer instanceof ArrayBuffer)) {
      throw new Error("Invalid edge buffer.")
    }
    const positions = new Float32Array(array.buffer, array.byteOffset, array.length)
    // Small bodies already pick cheaply. Indirect mode preserves worker triangle-to-face identity.
    const serialized =
      request.preparePicking && request.indices.length / 3 >= 10_000
        ? MeshBVH.serialize(new MeshBVH(geometry, { indirect: true, verbose: false }), {
            cloneBuffers: false,
          })
        : null
    const picking = serialized?.indirectBuffer
      ? {
          roots: serialized.roots,
          indirectBuffer: transferableIndirection(serialized.indirectBuffer),
        }
      : null
    return { positions, picking }
  } finally {
    edges?.dispose()
    geometry.dispose()
  }
}
