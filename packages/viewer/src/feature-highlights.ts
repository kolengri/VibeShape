import {
  type Group,
  type LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshBasicMaterial,
} from "three"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import { type ModelMeshPresentation, sameViewerGeometry } from "./model-meshes"
import type { PreparedEdges } from "./prepared-edges"
import type { ViewerMesh } from "./three-viewport"

type HighlightEntry = {
  source: ViewerMesh
  surface: Mesh
  edges: LineSegments
  owned: boolean
  preparedEdges: PreparedEdges | null
}

function release(entry: HighlightEntry) {
  // Displayed model buffers belong exclusively to ModelMeshPresentation.
  if (!entry.owned) return
  entry.surface.geometry.dispose()
  entry.preparedEdges?.dispose()
}

/** Owns fallback geometry only; visible model geometry is borrowed by overlay scene objects. */
export class FeatureHighlightPresentation {
  readonly #model: ModelMeshPresentation
  readonly #surfaceMaterial: MeshBasicMaterial
  readonly #edgeMaterial: LineBasicMaterial
  readonly #renderOrder: number
  readonly group: Group
  #entries: HighlightEntry[] = []
  #disposed = false

  constructor(
    group: Group,
    model: ModelMeshPresentation,
    surface: MeshBasicMaterial,
    edges: LineBasicMaterial,
    renderOrder: number,
  ) {
    this.group = group
    this.#model = model
    this.#surfaceMaterial = surface
    this.#edgeMaterial = edges
    this.#renderOrder = renderOrder
  }

  setMeshes(sources: readonly ViewerMesh[]) {
    if (this.#disposed) return false
    const available = new Map<string, HighlightEntry[]>()
    for (const entry of this.#entries) {
      const key = viewerBodyKey(entry.source)
      const entries = available.get(key) ?? []
      entries.push(entry)
      available.set(key, entries)
    }
    const next = sources.map((source) =>
      this.#entry(source, available.get(viewerBodyKey(source))?.shift()),
    )
    for (const entries of available.values()) for (const entry of entries) release(entry)
    const changed =
      next.length !== this.#entries.length ||
      next.some((entry, index) => entry !== this.#entries[index])
    this.#entries = next
    if (changed) {
      this.group.clear()
      for (const entry of next) this.group.add(entry.surface, entry.edges)
    }
    return changed
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#entries) release(entry)
    this.#entries = []
    this.group.clear()
  }

  #entry(source: ViewerMesh, previous: HighlightEntry | undefined): HighlightEntry {
    const displayed = this.#model.geometryFor(source)
    if (
      previous &&
      sameViewerGeometry(previous.source, source) &&
      (displayed ? previous.surface.geometry === displayed.surface : previous.owned)
    ) {
      previous.source = source
      return previous
    }
    if (previous) release(previous)
    return this.#createEntry(source, displayed)
  }

  #createEntry(
    source: ViewerMesh,
    displayed: ReturnType<ModelMeshPresentation["geometryFor"]>,
  ): HighlightEntry {
    const geometry = displayed?.surface ?? createViewerGeometry(source)
    const surface = new Mesh(geometry, this.#surfaceMaterial)
    surface.name = `${viewerBodyKey(source)}:feature-highlight`
    surface.renderOrder = this.#renderOrder
    const preparedEdges = displayed ? null : this.#model.createEdges(source, geometry)
    const edges = new LineSegments(displayed?.edges ?? preparedEdges?.geometry, this.#edgeMaterial)
    edges.name = `${viewerBodyKey(source)}:feature-highlight-edges`
    edges.renderOrder = this.#renderOrder
    return { source, surface, edges, owned: displayed === null, preparedEdges }
  }
}
