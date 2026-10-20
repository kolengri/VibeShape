import { BufferAttribute, BufferGeometry, EdgesGeometry } from "three"
import type { EdgePreparationRequest } from "./edge-preparation-schema"

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
    return new Float32Array(array.buffer, array.byteOffset, array.length)
  } finally {
    edges?.dispose()
    geometry.dispose()
  }
}
