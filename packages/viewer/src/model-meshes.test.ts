import { describe, expect, it } from "bun:test"
import {
  BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { ModelMeshPresentation } from "./model-meshes"
import type { ViewerMesh } from "./three-viewport"

const mesh: ViewerMesh = {
  featureId: "box",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

function fixture() {
  const materials = {
    preview: { surface: new MeshBasicMaterial(), edges: new LineBasicMaterial() },
    datum: { surface: new MeshBasicMaterial(), edges: new LineBasicMaterial() },
  }
  const presentation = new ModelMeshPresentation(materials)
  const dispose = () => {
    presentation.dispose()
    for (const pair of Object.values(materials)) {
      pair.surface.dispose()
      pair.edges.dispose()
    }
  }
  return { presentation, materials, dispose }
}

describe("current model mesh resource ownership", () => {
  it("reuses equal transferred geometry and updates face identity and CPU buffer references", () => {
    const { presentation, dispose } = fixture()
    const [first] = presentation.setMeshes([mesh])
    if (!first) throw new Error("Expected a presented body.")
    const source = { ...structuredClone(mesh), triangleFaceIds: new Uint32Array([42]) }
    const [next] = presentation.setMeshes([source])
    if (!next) throw new Error("Expected the updated body.")
    expect(next.surface).toBe(first.surface)
    expect(next.edges).toBe(first.edges)
    expect(next.source).toBe(source)
    expect(first.surface.geometry.getAttribute("position").array).toBe(source.positions)
    expect(first.surface.geometry.getAttribute("normal").array).toBe(source.normals)
    expect(first.surface.geometry.index?.array).toBe(source.indices)
    expect(first.surface.geometry.getAttribute("position")).toBeInstanceOf(BufferAttribute)
    expect((first.surface.geometry.getAttribute("position") as BufferAttribute).version).toBe(0)
    expect(first.surface.geometry.index?.version).toBe(0)
    presentation.group.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(0.5, 0.5, 10), new Vector3(0, 0, -1))
    const hit = ray.intersectObject(first.surface)[0]
    expect(hit?.faceIndex).toBe(0)
    expect(first.surface.geometry.userData.triangleFaceIds[hit?.faceIndex ?? -1]).toBe(42)
    dispose()
  })

  it.each(["positions", "normals", "indices"] as const)(
    "replaces changed %s for the same body without rebuilding its unchanged sibling",
    (field) => {
      const { presentation, dispose } = fixture()
      const sibling = { ...mesh, outputRole: "sibling" }
      const [first, other] = presentation.setMeshes([mesh, sibling])
      if (!first || !other) throw new Error("Expected two bodies.")
      const released = vi.fn()
      first.surface.geometry.addEventListener("dispose", released)
      const changed = structuredClone(mesh)
      changed[field][0] = field === "indices" ? 2 : 1
      const [replacement, retained] = presentation.setMeshes([changed, structuredClone(sibling)])
      expect(replacement?.surface).not.toBe(first.surface)
      expect(replacement?.edges).not.toBe(first.edges)
      expect(retained?.surface).toBe(other.surface)
      expect(released).toHaveBeenCalledTimes(1)
      expect(replacement?.surface.geometry.getAttribute("position").array).toBe(changed.positions)
      dispose()
    },
  )

  it("keeps sibling body roles distinct through reordered updates and removes hidden resources", () => {
    const { presentation, dispose } = fixture()
    const left = { ...mesh, outputRole: "left" }
    const right = { ...mesh, outputRole: "right" }
    const [firstLeft, firstRight] = presentation.setMeshes([left, right])
    if (!firstLeft || !firstRight) throw new Error("Expected two bodies.")
    const [nextRight, nextLeft] = presentation.setMeshes([structuredClone(right), left])
    expect(nextRight?.surface).toBe(firstRight.surface)
    expect(nextLeft?.surface).toBe(firstLeft.surface)
    expect(presentation.group.children).toEqual([
      firstRight.surface,
      firstRight.edges,
      firstLeft.surface,
      firstLeft.edges,
    ])
    const surfaceDisposed = vi.fn()
    const edgesDisposed = vi.fn()
    firstLeft.surface.geometry.addEventListener("dispose", surfaceDisposed)
    firstLeft.edges.geometry.addEventListener("dispose", edgesDisposed)
    presentation.setMeshes([right])
    expect(surfaceDisposed).toHaveBeenCalledTimes(1)
    expect(edgesDisposed).toHaveBeenCalledTimes(1)
    expect(presentation.group.children).toHaveLength(2)
    dispose()
    expect(presentation.group.children).toHaveLength(0)
    expect(surfaceDisposed).toHaveBeenCalledTimes(1)
    expect(presentation.setMeshes([mesh])).toEqual([])
  })

  it("changes materials when appearance changes and preserves caller-owned shared materials", () => {
    const { presentation, materials, dispose } = fixture()
    const previewDisposed = vi.spyOn(materials.preview.surface, "dispose")
    const previewEdgesDisposed = vi.spyOn(materials.preview.edges, "dispose")
    const [preview] = presentation.setMeshes([{ ...mesh, appearance: "preview" }])
    const [model] = presentation.setMeshes([{ ...mesh, appearance: "model" }])
    expect(model?.surface).not.toBe(preview?.surface)
    expect(previewDisposed).not.toHaveBeenCalled()
    expect(previewEdgesDisposed).not.toHaveBeenCalled()
    if (!model || Array.isArray(model.surface.material)) throw new Error("Expected model material.")
    const modelDisposed = vi.spyOn(model.surface.material, "dispose")
    const [selectionSource] = presentation.setMeshes([{ ...mesh, appearance: "selection-source" }])
    expect(modelDisposed).toHaveBeenCalledTimes(1)
    if (!selectionSource || Array.isArray(selectionSource.surface.material))
      throw new Error("Expected selection source material.")
    expect(selectionSource.surface.material.opacity).toBe(0.12)
    expect(selectionSource.surface.material.depthWrite).toBe(false)
    const [datum] = presentation.setMeshes([{ ...mesh, appearance: "datum" }])
    expect(datum?.surface.material).toBe(materials.datum.surface)
    presentation.dispose()
    presentation.dispose()
    expect(previewDisposed).not.toHaveBeenCalled()
    dispose()
    expect(previewDisposed).toHaveBeenCalledTimes(1)
    expect(previewEdgesDisposed).toHaveBeenCalledTimes(1)
  })

  it("refreshes equal original texture geometry and releases changed or removed originals once", () => {
    const { presentation, dispose } = fixture()
    const source = { ...mesh, textureSource: mesh }
    const [first] = presentation.setMeshes([source])
    if (!first?.textureSource) throw new Error("Expected an original texture source.")
    const originalGeometry = first.textureSource.surface.geometry
    const released = vi.fn()
    originalGeometry.addEventListener("dispose", released)
    const transferred = structuredClone(source)
    const [equal] = presentation.setMeshes([transferred])
    expect(equal?.textureSource?.surface.geometry).toBe(originalGeometry)
    expect(originalGeometry.getAttribute("position").array).toBe(
      transferred.textureSource.positions,
    )
    const changed = structuredClone(source)
    changed.textureSource.positions[0] = 1
    const [replacement] = presentation.setMeshes([changed])
    expect(released).toHaveBeenCalledTimes(1)
    expect(replacement?.textureSource?.surface.geometry).not.toBe(originalGeometry)
    presentation.setMeshes([mesh])
    dispose()
    expect(released).toHaveBeenCalledTimes(1)
  })

  it("switches preview materials for identical buffers while retaining preview authority and body colors", () => {
    const { presentation, materials, dispose } = fixture()
    const preview: ViewerMesh = { ...mesh, appearance: "preview", textureSource: mesh }
    const [highlight] = presentation.setMeshes([preview])
    if (!highlight) throw new Error("Expected a highlighted preview.")
    expect(highlight.surface.material).toBe(materials.preview.surface)
    const surface = highlight.surface
    const edges = highlight.edges
    const surfaceGeometry = surface.geometry
    const edgeGeometry = edges.geometry
    const surfaceReleased = vi.spyOn(surfaceGeometry, "dispose")
    const edgesReleased = vi.spyOn(edgeGeometry, "dispose")
    const [solid] = presentation.setMeshes([{ ...preview, previewMaterial: "model" }])
    if (!solid || !(solid.surface.material instanceof MeshStandardMaterial))
      throw new Error("Expected a solid preview material.")
    expect(solid.surface.material.transparent).toBe(false)
    expect(solid.surface.material.opacity).toBe(1)
    expect(solid.source.appearance).toBe("preview")
    expect(solid.surface).toBe(surface)
    expect(solid.edges).toBe(edges)
    expect(solid.surface.geometry).toBe(surfaceGeometry)
    expect(solid.edges.geometry).toBe(edgeGeometry)
    expect(solid.textureSource).toBeNull()
    expect(solid.surface.geometry.getAttribute("position").array).toBe(mesh.positions)
    expect(solid.surface.geometry.getAttribute("normal").array).toBe(mesh.normals)
    expect(solid.surface.geometry.index?.array).toBe(mesh.indices)
    const solidColor = solid.surface.material.color.getHex()
    const released = vi.spyOn(solid.surface.material, "dispose")
    const [changes] = presentation.setMeshes([{ ...preview, previewMaterial: "highlight" }])
    if (!changes) throw new Error("Expected the updated preview.")
    expect(changes.surface.material).toBe(materials.preview.surface)
    expect(changes.edges.material).toBe(materials.preview.edges)
    expect(changes.source.appearance).toBe("preview")
    expect(changes.surface).toBe(surface)
    expect(changes.edges).toBe(edges)
    expect(changes.surface.geometry).toBe(surfaceGeometry)
    expect(changes.edges.geometry).toBe(edgeGeometry)
    expect((surfaceGeometry.getAttribute("position") as BufferAttribute).version).toBe(0)
    expect((surfaceGeometry.getAttribute("normal") as BufferAttribute).version).toBe(0)
    expect(surfaceGeometry.index?.version).toBe(0)
    expect(surfaceReleased).not.toHaveBeenCalled()
    expect(edgesReleased).not.toHaveBeenCalled()
    expect(released).toHaveBeenCalledTimes(1)
    const [committed] = presentation.setMeshes([mesh])
    if (!committed || !(committed.surface.material instanceof MeshStandardMaterial))
      throw new Error("Expected the committed body material.")
    expect(solidColor).toBe(committed.surface.material.color.getHex())
    expect(surfaceReleased).toHaveBeenCalledTimes(1)
    expect(edgesReleased).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("keeps datum preview material separate from solid and highlighted draft bodies", () => {
    const { presentation, materials, dispose } = fixture()
    const preview: ViewerMesh = { ...mesh, appearance: "preview", previewMaterial: "datum" }
    const [datum] = presentation.setMeshes([preview])
    const geometry = datum?.surface.geometry
    expect(datum?.surface.material).toBe(materials.datum.surface)
    expect(datum?.edges.material).toBe(materials.datum.edges)
    expect(datum?.source.appearance).toBe("preview")
    const [changes] = presentation.setMeshes([{ ...preview, previewMaterial: "highlight" }])
    expect(changes?.surface.material).toBe(materials.preview.surface)
    const [restored] = presentation.setMeshes([preview])
    expect(restored?.surface.material).toBe(materials.datum.surface)
    expect(restored?.source.appearance).toBe("preview")
    expect(restored?.surface.geometry).toBe(geometry)
    dispose()
  })
})
