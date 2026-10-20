import { describe, expect, it } from "bun:test"
import {
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { edgePreparationFixture } from "../tests/edge-preparation-fixture"
import { FeatureHighlightPresentation } from "./feature-highlights"
import { ModelMeshPresentation } from "./model-meshes"
import type { ViewerMesh } from "./three-viewport"

const mesh: ViewerMesh = {
  featureId: "body",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([7]),
}

function fixture() {
  const surface = new MeshBasicMaterial({ transparent: true, opacity: 0.14, depthTest: false })
  const edges = new LineBasicMaterial({ transparent: true, opacity: 0.76 })
  const preparation = edgePreparationFixture()
  const model = new ModelMeshPresentation(
    { preview: { surface, edges }, datum: { surface, edges } },
    preparation.client,
    () => undefined,
  )
  const group = new Group()
  const highlights = new FeatureHighlightPresentation(group, model, surface, edges, 2)
  const dispose = () => {
    highlights.dispose()
    model.dispose()
    preparation.client.dispose()
    surface.dispose()
    edges.dispose()
  }
  return { model, group, highlights, surface, edges, preparation, dispose }
}

function overlay(group: Group) {
  const [surface, edges] = group.children
  if (!(surface instanceof Mesh) || !(edges instanceof LineSegments))
    throw new Error("Expected surface and edges.")
  return { surface, edges }
}

describe("feature highlight geometry ownership", () => {
  it("publishes prepared edges into the same borrowed geometry without blocking surface picking", async () => {
    const state = fixture()
    try {
      const [displayed] = state.model.setMeshes([mesh])
      if (!displayed) throw new Error("Expected a displayed body.")
      state.highlights.setMeshes([mesh])
      const first = overlay(state.group)
      expect(first.edges.geometry.getAttribute("position")).toBeUndefined()
      expect(first.surface.geometry.getAttribute("position").count).toBe(3)
      expect(state.preparation.worker.requests.length).toBe(1)
      expect(state.highlights.setMeshes([structuredClone(mesh)])).toBe(false)
      state.preparation.worker.complete()
      await Promise.resolve()
      expect(overlay(state.group).edges.geometry).toBe(first.edges.geometry)
      expect(first.edges.geometry).toBe(displayed.edges.geometry)
      expect(first.edges.geometry.getAttribute("position").count).toBe(6)
      expect(first.edges.geometry.boundingBox).toEqual(first.surface.geometry.boundingBox)
      expect(first.edges.geometry.boundingBox).not.toBe(first.surface.geometry.boundingBox)
      const dispose = vi.spyOn(first.edges.geometry, "dispose")
      state.highlights.setMeshes([])
      expect(dispose).toHaveBeenCalledTimes(0)
      state.model.setMeshes([])
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      state.dispose()
    }
  })

  it("cancels removed historical owners and ignores late results before preparing the new snapshot", async () => {
    const state = fixture()
    try {
      state.highlights.setMeshes([mesh])
      const old = overlay(state.group)
      const dispose = vi.spyOn(old.edges.geometry, "dispose")
      const historical = structuredClone(mesh)
      historical.positions[0] = -10
      state.highlights.setMeshes([historical])
      const next = overlay(state.group)
      expect(next.edges.geometry).not.toBe(old.edges.geometry)
      expect(dispose).toHaveBeenCalledTimes(1)
      state.preparation.worker.complete()
      await Promise.resolve()
      expect(old.edges.geometry.getAttribute("position")).toBeUndefined()
      expect(next.edges.geometry.getAttribute("position")).toBeUndefined()
      expect(state.preparation.worker.requests.length).toBe(2)
      state.preparation.worker.complete(1)
      await Promise.resolve()
      expect(next.edges.geometry.getAttribute("position").count).toBe(6)
      expect(next.edges.geometry.boundingBox?.min.x).toBe(-10)
    } finally {
      state.dispose()
    }
  })

  it("leaves surfaces and overlays available after worker failure without constructing fallback edges", async () => {
    const state = fixture()
    try {
      const [displayed] = state.model.setMeshes([mesh])
      state.highlights.setMeshes([mesh])
      state.preparation.worker.dispatchEvent(new Event("error"))
      await Promise.resolve()
      expect(state.preparation.errors.length).toBe(1)
      expect(overlay(state.group).surface.geometry).toBe(displayed?.surface.geometry)
      expect(overlay(state.group).edges.geometry.getAttribute("position")).toBeUndefined()
      expect(state.highlights.setMeshes([mesh])).toBe(false)
      expect(state.preparation.worker.requests.length).toBe(1)
    } finally {
      state.dispose()
    }
  })

  it("borrows both displayed geometries on first hover and does zero buffer work on unchanged hover", () => {
    const state = fixture()
    try {
      const [displayed] = state.model.setMeshes([mesh])
      if (!displayed) throw new Error("Expected a displayed body.")
      const buffers = vi.spyOn(BufferGeometry.prototype, "setAttribute")
      const bounds = vi.spyOn(BufferGeometry.prototype, "computeBoundingBox")
      try {
        expect(state.highlights.setMeshes([mesh])).toBe(true)
        const first = overlay(state.group)
        expect(first.surface.geometry).toBe(displayed.surface.geometry)
        expect(first.edges.geometry).toBe(displayed.edges.geometry)
        expect(first.surface).not.toBe(displayed.surface)
        expect(first.edges).not.toBe(displayed.edges)
        expect(displayed.surface.parent).toBe(state.model.group)
        expect(state.highlights.setMeshes([mesh])).toBe(false)
        expect(state.highlights.setMeshes([structuredClone(mesh)])).toBe(false)
        expect(overlay(state.group)).toEqual(first)
        expect(buffers).not.toHaveBeenCalled()
        expect(bounds).not.toHaveBeenCalled()
      } finally {
        buffers.mockRestore()
        bounds.mockRestore()
      }
      const surfaceDisposed = vi.spyOn(displayed.surface.geometry, "dispose")
      const edgesDisposed = vi.spyOn(displayed.edges.geometry, "dispose")
      state.highlights.setMeshes([])
      state.highlights.dispose()
      expect(surfaceDisposed).not.toHaveBeenCalled()
      expect(edgesDisposed).not.toHaveBeenCalled()
      state.model.dispose()
      state.model.dispose()
      expect(surfaceDisposed).toHaveBeenCalledTimes(1)
      expect(edgesDisposed).toHaveBeenCalledTimes(1)
    } finally {
      state.dispose()
    }
  })

  it("retains exact historical fallback geometry and disposes only owned buffers", () => {
    const state = fixture()
    try {
      state.model.setMeshes([mesh])
      const historical = structuredClone(mesh)
      historical.positions[0] = -20
      state.highlights.setMeshes([historical])
      const first = overlay(state.group)
      expect(first.surface.geometry.getAttribute("position").array).toBe(historical.positions)
      expect(first.surface.geometry.boundingBox?.min.x).toBe(-20)
      const released = vi.spyOn(first.surface.geometry, "dispose")
      const edgesReleased = vi.spyOn(first.edges.geometry, "dispose")
      expect(state.highlights.setMeshes([structuredClone(historical)])).toBe(false)
      expect(overlay(state.group).surface).toBe(first.surface)
      state.highlights.dispose()
      state.highlights.dispose()
      expect(released).toHaveBeenCalledTimes(1)
      expect(edgesReleased).toHaveBeenCalledTimes(1)
    } finally {
      state.dispose()
    }
  })

  it("rebinds replacements and material changes, preserving old snapshots when the displayed body changes", () => {
    const state = fixture()
    try {
      const [firstModel] = state.model.setMeshes([mesh])
      if (!firstModel) throw new Error("Expected a displayed body.")
      state.highlights.setMeshes([mesh])
      const oldDisposed = vi.spyOn(firstModel.surface.geometry, "dispose")
      const changed = structuredClone(mesh)
      changed.positions[0] = -10
      const [nextModel] = state.model.setMeshes([changed])
      if (!nextModel) throw new Error("Expected a replacement body.")
      expect(oldDisposed).toHaveBeenCalledTimes(1)
      state.highlights.setMeshes([mesh])
      const historical = overlay(state.group)
      expect(historical.surface.geometry).not.toBe(firstModel.surface.geometry)
      expect(historical.surface.geometry.getAttribute("position").array).toBe(mesh.positions)
      const historicalDisposed = vi.spyOn(historical.surface.geometry, "dispose")
      state.highlights.setMeshes([changed])
      expect(historicalDisposed).toHaveBeenCalledTimes(1)
      expect(overlay(state.group).surface.geometry).toBe(nextModel.surface.geometry)
      const datum = { ...changed, appearance: "datum" as const }
      const [datumModel] = state.model.setMeshes([datum])
      state.highlights.setMeshes([datum])
      expect(overlay(state.group).surface.geometry).toBe(datumModel?.surface.geometry)
      expect(overlay(state.group).surface.material).toBe(state.surface)
      expect(overlay(state.group).edges.material).toBe(state.edges)
      state.surface.opacity = 0.3
      expect(state.highlights.setMeshes([datum])).toBe(false)
      expect(overlay(state.group).surface.material.opacity).toBe(0.3)
    } finally {
      state.dispose()
    }
  })

  it("keeps sibling roles, ordering, group visibility, and overlay materials independent of the model", () => {
    const state = fixture()
    try {
      const left = { ...mesh, outputRole: "left" }
      const right = { ...mesh, outputRole: "right", appearance: "selection-source" as const }
      const [leftModel, rightModel] = state.model.setMeshes([left, right])
      state.group.visible = false
      state.highlights.setMeshes([right, left])
      expect(state.group.children[0]).toMatchObject({
        geometry: rightModel?.surface.geometry,
        material: state.surface,
        renderOrder: 2,
      })
      expect(state.group.children[2]).toMatchObject({
        geometry: leftModel?.surface.geometry,
        material: state.surface,
      })
      expect(state.group.visible).toBe(false)
      state.model.setMeshes([structuredClone(right), structuredClone(left)])
      expect(state.highlights.setMeshes([right, left])).toBe(false)
      state.model.setMeshes([])
      state.highlights.setMeshes([right, left])
      expect(state.group.children[0]).not.toHaveProperty("geometry", rightModel?.surface.geometry)
      expect(state.group.children).toHaveLength(4)
    } finally {
      state.dispose()
    }
  })
})
