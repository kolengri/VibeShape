import { type Group, Mesh, type MeshBasicMaterial } from "three"
import { viewerBodyKey } from "./mesh-geometry"
import { createFaceHighlightGeometry, sameViewerSelection } from "./mesh-selection"
import type { ViewerMesh, ViewerSelection } from "./three-viewport"

type FaceTarget = Readonly<{ selection: ViewerSelection; source: ViewerMesh | undefined }>

/** Owns extracted multi-face overlays for the current selection and source snapshots. */
export class FaceHighlightPresentation {
  readonly #group: Group
  readonly #material: MeshBasicMaterial
  readonly #sources: ReadonlyMap<string, ViewerMesh>
  #targets: FaceTarget[] = []

  constructor(group: Group, material: MeshBasicMaterial, sources: ReadonlyMap<string, ViewerMesh>) {
    this.#group = group
    this.#material = material
    this.#sources = sources
  }

  setSelections(selections: readonly ViewerSelection[]) {
    const targets = selections.map((selection) => ({
      selection,
      source: this.#sources.get(viewerBodyKey(selection)),
    }))
    if (
      targets.length === this.#targets.length &&
      targets.every((target, index) => {
        const previous = this.#targets[index]
        return (
          previous &&
          target.source === previous.source &&
          sameViewerSelection(target.selection, previous.selection)
        )
      })
    )
      return false
    this.clear()
    this.#targets = targets
    for (const { selection, source } of targets) {
      const geometry = source ? createFaceHighlightGeometry(source, selection.faceId) : null
      if (!geometry) continue
      const mesh = new Mesh(geometry, this.#material)
      mesh.renderOrder = 4
      this.#group.add(mesh)
    }
    return true
  }

  clear() {
    for (const child of [...this.#group.children]) {
      this.#group.remove(child)
      if (child instanceof Mesh) child.geometry.dispose()
    }
    this.#targets = []
  }
}
