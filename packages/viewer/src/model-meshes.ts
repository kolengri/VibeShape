import { appearanceColorSchema } from "@vibeshape/domain/part-appearance"
import {
  type BufferAttribute,
  type BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
} from "three"
import type { EdgePreparationPort } from "./edge-preparation"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import { PreparedEdges } from "./prepared-edges"
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
  preparedEdges: PreparedEdges
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

export function sameViewerGeometry(left: ViewerMesh, right: ViewerMesh) {
  return (
    sameArray(left.positions, right.positions) &&
    sameArray(left.normals, right.normals) &&
    sameArray(left.indices, right.indices)
  )
}

function sameTextureSource(left: ViewerMesh, right: ViewerMesh) {
  return left.textureSource && right.textureSource
    ? sameViewerGeometry(left.textureSource, right.textureSource)
    : left.textureSource === right.textureSource
}

function samePresentation(left: ViewerMesh, right: ViewerMesh) {
  return (
    (left.appearance ?? "model") === (right.appearance ?? "model") &&
    sameViewerGeometry(left, right) &&
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

function disposeEntryMaterials(entry: ModelMeshEntry) {
  if (entry.ownsMaterials) {
    const materials = [entry.surface.material, entry.edges.material].flat()
    for (const material of materials) material.dispose()
  }
}

function disposeEntry(entry: ModelMeshEntry) {
  entry.surface.geometry.dispose()
  entry.preparedEdges.dispose()
  entry.textureSource?.surface.geometry.dispose()
  disposeEntryMaterials(entry)
}

/** Owns only the currently presented bodies; hidden and replaced resources are released immediately. */
export class ModelMeshPresentation {
  readonly group = new Group()
  readonly #materials: SharedMaterials
  readonly #preparation: EdgePreparationPort
  readonly #onChange: () => void
  #entries: ModelMeshEntry[] = []
  #disposed = false

  constructor(materials: SharedMaterials, preparation: EdgePreparationPort, onChange: () => void) {
    this.#materials = materials
    this.#preparation = preparation
    this.#onChange = onChange
  }

  createEdges(source: ViewerMesh, surface: BufferGeometry) {
    return new PreparedEdges(this.#preparation, source, surface, this.#onChange)
  }

  geometryFor(source: ViewerMesh) {
    const entry = this.#entries.find(
      (candidate) =>
        viewerBodyKey(candidate.source) === viewerBodyKey(source) &&
        sameViewerGeometry(candidate.source, source),
    )
    return entry ? { surface: entry.surface.geometry, edges: entry.edges.geometry } : null
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
      if (
        source.appearance === "preview" &&
        previous.source.previewMaterial !== source.previewMaterial
      ) {
        disposeEntryMaterials(previous)
        const materials = this.#entryMaterials(source)
        previous.surface.material = materials.surface
        previous.edges.material = materials.edges
        previous.ownsMaterials = materials.owned
      }
      if (previous.surface.material instanceof MeshStandardMaterial) {
        this.#updateMaterial(previous.surface.material, source)
      }
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
    const materials = this.#entryMaterials(source)
    const surface = new Mesh(createViewerGeometry(source), materials.surface)
    surface.name = viewerBodyKey(source)
    const preparedEdges = this.createEdges(source, surface.geometry)
    const edges = new LineSegments(preparedEdges.geometry, materials.edges)
    edges.name = `${surface.name}:edges`
    return {
      source,
      surface,
      edges,
      preparedEdges,
      textureSource:
        source.appearance !== "preview" && source.textureSource
          ? {
              surface: new Mesh(createViewerGeometry(source.textureSource), materials.surface),
              source: source.textureSource,
            }
          : null,
      ownsMaterials: materials.owned,
    }
  }

  #entryMaterials(source: ViewerMesh) {
    const shared = this.#sharedMaterials(source)
    return {
      surface: shared?.surface ?? this.#modelMaterial(source),
      edges: shared?.edges ?? new LineBasicMaterial({ color: new Color("#263746") }),
      owned: shared === null,
    }
  }

  #sharedMaterials(source: ViewerMesh) {
    if (source.appearance === "preview") {
      if (source.previewMaterial === "highlight") return this.#materials.preview
      if (source.previewMaterial === "datum") return this.#materials.datum
      return null
    }
    if (source.appearance === "datum") return this.#materials.datum
    return null
  }

  #updateMaterial(material: MeshStandardMaterial, source: ViewerMesh) {
    const settings = this.#materialSettings(source)
    const transparent = settings.opacity < 1
    if (material.transparent !== transparent) material.needsUpdate = true
    material.color.set(settings.color)
    material.roughness = settings.roughness
    material.metalness = settings.metalness
    material.opacity = settings.opacity
    material.transparent = transparent
    material.depthWrite = !transparent
  }

  #materialSettings(source: ViewerMesh) {
    const temporary = source.appearance === "preview" || source.appearance === "datum"
    const appearance = temporary ? undefined : source.material
    const settings = appearance ?? {
      color: viewerBodyColor(source.featureId),
      roughness: 0.72,
      metalness: 0.04,
      opacity: 1,
    }
    const color = temporary ? undefined : appearanceColorSchema.safeParse(source.color)
    return {
      ...settings,
      color: color?.success ? color.data : settings.color,
      opacity: source.appearance === "selection-source" ? 0.12 : settings.opacity,
    }
  }

  #modelMaterial(source: ViewerMesh) {
    const material = new MeshStandardMaterial({
      side: source.appearance === "preview" ? DoubleSide : FrontSide,
    })
    this.#updateMaterial(material, source)
    return material
  }
}
