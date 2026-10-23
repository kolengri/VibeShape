import { BufferAttribute, BufferGeometry } from "three"
import { MeshBVH } from "three-mesh-bvh"
import type { EdgePreparationPort, EdgePreparationSource } from "./edge-preparation"

/** Owns one stable geometry; overlays borrow it before and after asynchronous completion. */
export class PreparedEdges {
  readonly geometry = new BufferGeometry()
  readonly #cancel: () => void
  #disposed = false

  constructor(
    preparation: EdgePreparationPort,
    source: EdgePreparationSource,
    surface: BufferGeometry,
    onChange: () => void,
    preparePicking = false,
  ) {
    // No placeholder attribute: replacing an already-uploaded empty attribute would orphan its GPU buffer.
    // The containing group also includes the surface; conservative bounds preserve scene framing.
    this.geometry.boundingBox = surface.boundingBox?.clone() ?? null
    this.geometry.boundingSphere = surface.boundingSphere?.clone() ?? null
    const job = preparation.prepare(this, {
      positions: source.positions,
      indices: source.indices,
      preparePicking,
    })
    this.#cancel = () => {
      job.cancel()
      delete surface.boundsTree
    }
    void job.result.then(
      ({ positions, picking }) => {
        if (this.#disposed) return
        this.geometry.setAttribute("position", new BufferAttribute(positions, 3))
        if (picking) {
          const data = { version: 1, index: null, ...picking }
          surface.boundsTree = MeshBVH.deserialize(data, surface, { setIndex: false })
        }
        onChange()
      },
      () => {
        // The client reports failures. Surface rendering and picking remain available without edges.
      },
    )
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#cancel()
    this.geometry.dispose()
  }
}
