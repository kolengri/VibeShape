import { describe, expect, it } from "bun:test"
import { appearanceColorSchema, appearancePresets } from "@vibeshape/domain/part-appearance"
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector3,
} from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { edgePreparationFixture } from "../tests/edge-preparation-fixture"
import { createViewerGeometry } from "./mesh-geometry"
import { ModelMeshPresentation } from "./model-meshes"
import type { ViewerMesh } from "./three-viewport"
import { viewerBodyColor } from "./viewer-appearance"

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
  const preparation = edgePreparationFixture()
  const presentation = new ModelMeshPresentation(materials, preparation.client, () => undefined)
  const dispose = () => {
    presentation.dispose()
    preparation.client.dispose()
    for (const pair of Object.values(materials)) {
      pair.surface.dispose()
      pair.edges.dispose()
    }
  }
  return { presentation, materials, preparation, dispose }
}

function denseMesh(geometry: BufferGeometry = new SphereGeometry(3, 128, 64)): ViewerMesh {
  const index = geometry.getIndex()
  if (!index) throw new Error("Expected indexed test geometry.")
  const source = {
    featureId: "dense-body",
    positions: new Float32Array(geometry.getAttribute("position").array),
    normals: new Float32Array(geometry.getAttribute("normal").array),
    indices: new Uint32Array(index.array),
    triangleFaceIds: Uint32Array.from({ length: index.count / 3 }, (_, i) => 500 + i),
  }
  geometry.dispose()
  return source
}

describe("current model mesh resource ownership", () => {
  it("borrows exact body geometry in duplicate-key order and releases its lookup on replacement", () => {
    const { presentation, preparation, dispose } = fixture()
    try {
      const first = { ...mesh, outputRole: "left" }
      const second = { ...first, positions: new Float32Array([1, 0, 0, 2, 0, 0, 0, 3, 0]) }
      const sibling = { ...first, outputRole: "right" }
      const entries = presentation.setMeshes([first, second, sibling])
      const [a, b, c] = entries
      if (!a || !b || !c) throw new Error("Expected three displayed entries.")
      const requests = preparation.worker.requests.length
      expect(presentation.geometryFor(structuredClone(first))?.surface).toBe(a.surface.geometry)
      expect(presentation.geometryFor(second)?.surface).toBe(b.surface.geometry)
      expect(presentation.geometryFor(sibling)?.surface).toBe(c.surface.geometry)
      expect(presentation.geometryFor({ ...first, outputRole: "missing" })).toBeNull()
      expect(preparation.worker.requests).toHaveLength(requests)

      const reordered = presentation.setMeshes([second, first])
      expect(presentation.geometryFor(second)?.surface).toBe(reordered[0]?.surface.geometry)
      expect(presentation.geometryFor(first)?.surface).toBe(reordered[1]?.surface.geometry)
      expect(presentation.geometryFor(sibling)).toBeNull()
      presentation.setMeshes([])
      expect(presentation.geometryFor(first)).toBeNull()
      presentation.setMeshes([first])
      presentation.dispose()
      expect(presentation.geometryFor(first)).toBeNull()
    } finally {
      dispose()
    }
  })

  it("accelerates dense all-hit picking without changing face identity, clipping, or model buffers", async () => {
    const { presentation, preparation, dispose } = fixture()
    const source = denseMesh()
    const indices = source.indices.slice()
    const [entry] = presentation.setMeshes([source])
    if (!entry) throw new Error("Expected a dense body.")
    const material = entry.surface.material
    if (!(material instanceof MeshStandardMaterial)) throw new Error("Expected a model material.")
    material.side = DoubleSide
    const ray = new Raycaster(new Vector3(0.123, 0.234, 10), new Vector3(0, 0, -1))
    presentation.group.updateMatrixWorld(true)
    const before = ray.intersectObject(entry.surface)
    expect(before).toHaveLength(2)
    expect(entry.surface.geometry.boundsTree).toBeUndefined()
    preparation.worker.complete()
    await Promise.resolve()
    expect(entry.surface.geometry.boundsTree).toBeDefined()
    const after = ray.intersectObject(entry.surface)
    expect(after.map((hit) => [hit.faceIndex, hit.distance])).toEqual(
      before.map((hit) => [hit.faceIndex, hit.distance]),
    )
    const clip = new Plane(new Vector3(0, 0, -1), 0)
    expect(
      after.filter((hit) => clip.distanceToPoint(hit.point) >= 0).map((hit) => hit.faceIndex),
    ).toEqual(
      before.filter((hit) => clip.distanceToPoint(hit.point) >= 0).map((hit) => hit.faceIndex),
    )
    expect(source.indices).toEqual(indices)
    expect(entry.surface.geometry.index?.array).toBe(source.indices)
    expect(entry.surface.geometry.getAttribute("position").array).toBe(source.positions)
    expect(after.map((hit) => source.triangleFaceIds[hit.faceIndex ?? -1])).toEqual(
      before.map((hit) => source.triangleFaceIds[hit.faceIndex ?? -1]),
    )
    const [equal] = presentation.setMeshes([
      {
        ...structuredClone(source),
        triangleFaceIds: new Uint32Array(source.triangleFaceIds.length).fill(42),
      },
    ])
    expect(equal).toBe(entry)
    expect(
      ray
        .intersectObject(entry.surface)
        .map((hit) => entry.surface.geometry.userData.triangleFaceIds[hit.faceIndex ?? -1]),
    ).toEqual([42, 42])
    presentation.setMeshes([])
    expect(entry.surface.geometry.boundsTree).toBeUndefined()
    dispose()
  })

  it("retains stock face ordering when a ray hits an exact dense cube corner", async () => {
    const { presentation, preparation, dispose } = fixture()
    const [entry] = presentation.setMeshes([denseMesh(new BoxGeometry(2, 2, 2, 50, 50, 50))])
    if (!entry) throw new Error("Expected a subdivided cube.")
    presentation.group.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(3, 3, 3), new Vector3(-1, -1, -1).normalize())
    const before = ray.intersectObject(entry.surface)
    expect(before.length).toBeGreaterThan(1)
    expect(new Set(before.map((hit) => hit.distance)).size).toBe(1)
    preparation.worker.complete()
    await Promise.resolve()
    expect(entry.surface.geometry.boundsTree).toBeDefined()
    expect(ray.intersectObject(entry.surface).map((hit) => hit.faceIndex)).toEqual(
      before.map((hit) => hit.faceIndex),
    )
    dispose()
  })

  it("prepares edges without unused picking indexes for dense previews and highlight fallbacks", async () => {
    const { presentation, preparation, dispose } = fixture()
    const source = denseMesh()
    const [preview] = presentation.setMeshes([{ ...source, appearance: "preview" }])
    if (!preview) throw new Error("Expected a preview surface.")
    expect(preparation.worker.requests[0]?.preparePicking).toBe(false)
    preparation.worker.complete()
    await Promise.resolve()
    expect(preview.surface.geometry.boundsTree).toBeUndefined()
    const surface = createViewerGeometry(source)
    const fallback = presentation.createEdges(source, surface)
    expect(preparation.worker.requests[1]?.preparePicking).toBe(false)
    preparation.worker.complete(1)
    await Promise.resolve()
    expect(surface.boundsTree).toBeUndefined()
    fallback.dispose()
    surface.dispose()
    dispose()
  })

  it("discards a dense picking index when its body is replaced before preparation finishes", async () => {
    const { presentation, preparation, dispose } = fixture()
    const [old] = presentation.setMeshes([denseMesh()])
    const [next] = presentation.setMeshes([mesh])
    if (!old || !next) throw new Error("Expected replacement bodies.")
    preparation.worker.complete()
    await Promise.resolve()
    expect(old.surface.geometry.boundsTree).toBeUndefined()
    expect(next.surface.geometry.boundsTree).toBeUndefined()
    preparation.worker.complete(1)
    await Promise.resolve()
    expect(next.surface.geometry.boundsTree).toBeUndefined()
    expect(next.edges.geometry.getAttribute("position").count).toBe(6)
    dispose()
  })

  it("retains equal pending work and prevents replaced owners from publishing late edges", async () => {
    const { presentation, preparation, dispose } = fixture()
    try {
      const [old] = presentation.setMeshes([mesh])
      if (!old) throw new Error("Expected a displayed body.")
      const [equal] = presentation.setMeshes([structuredClone(mesh)])
      expect(equal).toBe(old)
      expect(preparation.worker.requests.length).toBe(1)
      const changed = structuredClone(mesh)
      changed.positions[0] = -5
      const [next] = presentation.setMeshes([changed])
      if (!next) throw new Error("Expected a replacement body.")
      expect(next.surface.geometry.getAttribute("position").array).toBe(changed.positions)
      expect(next.edges.geometry.getAttribute("position")).toBeUndefined()
      preparation.worker.complete()
      await Promise.resolve()
      expect(old.edges.geometry.getAttribute("position")).toBeUndefined()
      expect(preparation.worker.requests.length).toBe(2)
      preparation.worker.complete(1)
      await Promise.resolve()
      expect(next.edges.geometry.getAttribute("position").count).toBe(6)
    } finally {
      dispose()
    }
  })

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
    const [preview] = presentation.setMeshes([
      { ...mesh, appearance: "preview", previewMaterial: "highlight" },
    ])
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

  it("defaults tool previews to shaded opaque results and keeps explicit highlights disposable", () => {
    const { presentation, materials, dispose } = fixture()
    const preview: ViewerMesh = { ...mesh, appearance: "preview", textureSource: mesh }
    const [highlight] = presentation.setMeshes([{ ...preview, previewMaterial: "highlight" }])
    if (!highlight) throw new Error("Expected a highlighted preview.")
    expect(highlight.surface.material).toBe(materials.preview.surface)
    const surface = highlight.surface
    const edges = highlight.edges
    const surfaceGeometry = surface.geometry
    const edgeGeometry = edges.geometry
    const surfaceReleased = vi.spyOn(surfaceGeometry, "dispose")
    const edgesReleased = vi.spyOn(edgeGeometry, "dispose")
    const [solid] = presentation.setMeshes([preview])
    if (!solid || !(solid.surface.material instanceof MeshStandardMaterial))
      throw new Error("Expected a solid preview material.")
    expect(solid.surface.material.transparent).toBe(false)
    expect(solid.surface.material.opacity).toBe(1)
    expect(solid.surface.material.depthTest).toBe(true)
    expect(solid.surface.material.depthWrite).toBe(true)
    expect(solid.edges.material).not.toBe(materials.preview.edges)
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
    const [restored] = presentation.setMeshes([{ ...preview, previewMaterial: "model" }])
    expect(restored?.surface.material).toBeInstanceOf(MeshStandardMaterial)
    expect(restored?.surface.geometry).toBe(surfaceGeometry)
    const [committed] = presentation.setMeshes([mesh])
    if (!committed || !(committed.surface.material instanceof MeshStandardMaterial))
      throw new Error("Expected the committed body material.")
    expect(solidColor).toBe(committed.surface.material.color.getHex())
    expect(surfaceReleased).toHaveBeenCalledTimes(1)
    expect(edgesReleased).toHaveBeenCalledTimes(1)
    dispose()
  })

  it("keeps reversed open import triangles opaque and visible from both sides in preview", () => {
    const { presentation, dispose } = fixture()
    const source: ViewerMesh = {
      ...mesh,
      appearance: "preview",
      indices: new Uint32Array([0, 2, 1]),
    }
    const front = new Raycaster(new Vector3(0.5, 0.5, 10), new Vector3(0, 0, -1))
    const back = new Raycaster(new Vector3(0.5, 0.5, -10), new Vector3(0, 0, 1))
    try {
      for (const preview of [source, { ...source, previewMaterial: "model" as const }]) {
        const [entry] = presentation.setMeshes([preview])
        if (!entry || !(entry.surface.material instanceof MeshStandardMaterial))
          throw new Error("Expected a shaded preview material.")
        expect(entry.surface.material.transparent).toBe(false)
        expect(entry.surface.material.opacity).toBe(1)
        presentation.group.updateMatrixWorld(true)
        expect(front.intersectObject(entry.surface)).toHaveLength(1)
        expect(back.intersectObject(entry.surface)).toHaveLength(1)
      }
      const [committed] = presentation.setMeshes([mesh])
      if (!committed) throw new Error("Expected a committed body.")
      presentation.group.updateMatrixWorld(true)
      expect(front.intersectObject(committed.surface)).toHaveLength(1)
      expect(back.intersectObject(committed.surface)).toHaveLength(0)
    } finally {
      dispose()
    }
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

it("updates authored material and custom color in place, including opacity, reset and exact output-role identity", () => {
  const f = fixture()
  try {
    const source = { ...mesh, featureId: "pattern", outputRole: "copy:1", textureSource: mesh }
    const sibling = { ...mesh, featureId: "pattern", outputRole: "copy:2" }
    const [first, second] = f.presentation.setMeshes([source, sibling])
    if (!first || !second || !(first.surface.material instanceof MeshStandardMaterial))
      throw new Error("Missing model material")
    const geometry = first.surface.geometry
    const edges = first.edges.geometry
    const material = first.surface.material
    const disposed = vi.spyOn(material, "dispose")
    const geometryDisposed = vi.spyOn(geometry, "dispose")
    const prepared = f.preparation.worker.requests.length
    const changed = {
      ...source,
      material: appearancePresets["polycarbonate-clear"],
      color: appearanceColorSchema.parse("#4499cc"),
    }
    const [colored, unchanged] = f.presentation.setMeshes([changed, sibling])
    expect(colored?.surface.geometry).toBe(geometry)
    expect(colored?.edges.geometry).toBe(edges)
    expect(colored?.surface.material).toBe(material)
    expect(colored?.textureSource?.surface.material).toBe(material)
    expect(unchanged?.surface.material).toBe(second.surface.material)
    expect(material.color.getHexString()).toBe("4499cc")
    expect(material.roughness).toBe(0.12)
    expect(material.metalness).toBe(0)
    expect(material.opacity).toBe(0.28)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    f.presentation.setMeshes([
      { ...changed, color: appearanceColorSchema.parse("#ff2200") },
      sibling,
    ])
    expect(material.color.getHexString()).toBe("ff2200")
    expect(material.roughness).toBe(0.12)
    expect(material.opacity).toBe(0.28)
    f.presentation.setMeshes([{ ...source, material: appearancePresets.chrome }, sibling])
    expect(material.color.getHexString()).toBe("e0e5eb")
    expect(material.metalness).toBe(0.98)
    expect(material.roughness).toBe(0.08)
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    f.presentation.setMeshes([source, sibling])
    expect(material.color.getHexString()).toBe(viewerBodyColor(source.featureId).slice(1))
    expect(material.roughness).toBe(0.72)
    expect(material.metalness).toBe(0.04)
    expect(material.opacity).toBe(1)
    expect(f.preparation.worker.requests.length).toBe(prepared)
    expect(geometryDisposed).not.toHaveBeenCalled()
    expect(disposed).not.toHaveBeenCalled()
    f.presentation.setMeshes([])
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(geometryDisposed).toHaveBeenCalledTimes(1)
  } finally {
    f.dispose()
  }
})
