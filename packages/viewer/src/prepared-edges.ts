import { BufferAttribute, BufferGeometry } from "three"
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
  ) {
    // No placeholder attribute: replacing an already-uploaded empty attribute would orphan its GPU buffer.
    // The containing group also includes the surface; conservative bounds preserve scene framing.
    this.geometry.boundingBox = surface.boundingBox?.clone() ?? null
    this.geometry.boundingSphere = surface.boundingSphere?.clone() ?? null
    const job = preparation.prepare(this, source)
    this.#cancel = job.cancel
    void job.result.then(
      (positions) => {
        if (this.#disposed) return
        this.geometry.setAttribute("position", new BufferAttribute(positions, 3))
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
