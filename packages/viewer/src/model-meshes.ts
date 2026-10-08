import {
  type BufferAttribute,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
} from "three"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import type { ViewerMesh } from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

type SharedMaterials = Readonly<{
  preview: Readonly<{ surface: MeshBasicMaterial; edges: LineBasicMaterial }>
  datum: Readonly<{ surface: MeshBasicMaterial; edges: LineBasicMaterial }>
}>

type ModelMeshEntry = {
  source: ViewerMesh
  surface: Mesh
  edges: LineSegments
  textureSource: { surface: Mesh; source: ViewerMesh } | null
  ownsMaterials: boolean
}

function sameArray(left: Float32Array | Uint32Array, right: Float32Array | Uint32Array) {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sameGeometry(left: ViewerMesh, right: ViewerMesh) {
  return (
    sameArray(left.positions, right.positions) &&
    sameArray(left.normals, right.normals) &&
    sameArray(left.indices, right.indices)
  )
}

function sameTextureSource(left: ViewerMesh, right: ViewerMesh) {
  return left.textureSource && right.textureSource
    ? sameGeometry(left.textureSource, right.textureSource)
    : left.textureSource === right.textureSource
}

function samePresentation(left: ViewerMesh, right: ViewerMesh) {
  return (
    (left.appearance ?? "model") === (right.appearance ?? "model") &&
    sameGeometry(left, right) &&
    sameTextureSource(left, right)
  )
}

function refreshGeometry(surface: Mesh, source: ViewerMesh) {
  // Equal transferred arrays replace the CPU references without invalidating equal GPU buffers.
  const geometry = surface.geometry
  const positions = geometry.getAttribute("position") as BufferAttribute
  const normals = geometry.getAttribute("normal") as BufferAttribute
  positions.array = source.positions
  normals.array = source.normals
  if (geometry.index) geometry.index.array = source.indices
  geometry.userData = {
    featureId: source.featureId,
    ...(source.outputRole === undefined ? {} : { outputRole: source.outputRole }),
    triangleFaceIds: source.triangleFaceIds,
  }
}

function disposeEntry(entry: ModelMeshEntry) {
  entry.surface.geometry.dispose()
  entry.edges.geometry.dispose()
  entry.textureSource?.surface.geometry.dispose()
  if (entry.ownsMaterials) {
    const materials = [entry.surface.material, entry.edges.material].flat()
    for (const material of materials) material.dispose()
  }
}

/** Owns only the currently presented bodies; hidden and replaced resources are released immediately. */
export class ModelMeshPresentation {
  readonly group = new Group()
  readonly #materials: SharedMaterials
  #entries: ModelMeshEntry[] = []
  #disposed = false

  constructor(materials: SharedMaterials) {
    this.#materials = materials
  }

  setMeshes(meshes: readonly ViewerMesh[]): readonly ModelMeshEntry[] {
    if (this.#disposed) return []
    const available = new Map<string, ModelMeshEntry[]>()
    for (const entry of this.#entries) {
      const key = viewerBodyKey(entry.source)
      const entries = available.get(key) ?? []
      entries.push(entry)
      available.set(key, entries)
    }
    const next = meshes.map((source) => {
      const previous = available.get(viewerBodyKey(source))?.shift()
      return this.#updateEntry(previous, source)
    })
    for (const entries of available.values()) {
      for (const entry of entries) disposeEntry(entry)
    }
    this.#entries = next
    this.group.clear()
    for (const entry of next) this.group.add(entry.surface, entry.edges)
    return next
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const entry of this.#entries) disposeEntry(entry)
    this.#entries = []
    this.group.clear()
  }

  #updateEntry(previous: ModelMeshEntry | undefined, source: ViewerMesh): ModelMeshEntry {
    if (previous && samePresentation(previous.source, source)) {
      refreshGeometry(previous.surface, source)
      if (previous.textureSource && source.textureSource) {
        refreshGeometry(previous.textureSource.surface, source.textureSource)
        previous.textureSource.source = source.textureSource
      }
      previous.source = source
      return previous
    }
    if (previous) disposeEntry(previous)
    return this.#createEntry(source)
  }

  #createEntry(source: ViewerMesh): ModelMeshEntry {
    const shared = this.#sharedMaterials(source.appearance)
    const surfaceMaterial = shared?.surface ?? this.#modelMaterial(source)
    const edgeMaterial = shared?.edges ?? new LineBasicMaterial({ color: new Color("#263746") })
    const surface = new Mesh(createViewerGeometry(source), surfaceMaterial)
    surface.name = viewerBodyKey(source)
    const edges = new LineSegments(new EdgesGeometry(surface.geometry, 28), edgeMaterial)
    edges.name = `${surface.name}:edges`
    return {
      source,
      surface,
      edges,
      textureSource:
        source.appearance !== "preview" && source.textureSource
          ? {
              surface: new Mesh(createViewerGeometry(source.textureSource), surfaceMaterial),
              source: source.textureSource,
            }
          : null,
      ownsMaterials: shared === null,
    }
  }

  #sharedMaterials(appearance: ViewerMesh["appearance"]) {
    if (appearance === "preview") return this.#materials.preview
    if (appearance === "datum") return this.#materials.datum
    return null
  }

  #modelMaterial(source: ViewerMesh) {
    return new MeshStandardMaterial({
      color: new Color(viewerBodyColor(source.featureId)),
      roughness: 0.72,
      metalness: 0.04,
      ...(source.appearance === "selection-source"
        ? { transparent: true, opacity: 0.12, depthWrite: false }
        : {}),
    })
  }
}
