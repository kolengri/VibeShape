import { describe, expect, it } from "bun:test"
import { ArrowHelper, Line, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector3 } from "three"
import { vi } from "../../../tests/unit/support/bun-test"
import { AnalysisOverlayDecoration } from "./analysis-overlays"
import {
  createFaceHighlightGeometry,
  createViewerGeometry,
  type ViewerMesh,
} from "./three-viewport"

const source: ViewerMesh = {
  featureId: "captured-source",
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  triangleFaceIds: new Uint32Array([7, 19]),
}

describe("disposable analysis overlays", () => {
  it("extracts only requested captured faces and distinguishes support, load, and preservation", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "face", mesh: source, faceIds: [7, 7, 99, -1, Number.NaN], role: "support" },
      { kind: "face", mesh: source, faceIds: [19], role: "load" },
      { kind: "face", mesh: source, faceIds: [7], role: "preserve" },
    ])
    expect(decoration.group.children).toHaveLength(3)
    const colors = new Set<string>()
    for (const child of decoration.group.children) {
      if (!(child instanceof Mesh) || Array.isArray(child.material))
        throw new Error("Expected face.")
      const position = child.geometry.getAttribute("position")
      expect(position.count).toBe(3)
      expect(position.array).toEqual(
        new Float32Array(
          child.name === "analysis-load:19"
            ? [0, 0, 0, 0, 3, 0, 0, 0, 4]
            : [0, 0, 0, 2, 0, 0, 0, 3, 0],
        ),
      )
      expect(position.array).not.toBe(source.positions)
      expect(child.material.transparent).toBe(true)
      expect(child.material.depthWrite).toBe(false)
      colors.add(child.material.color.getHexString())
    }
    expect(colors.size).toBe(3)
    decoration.dispose()
  })

  it("shows the signed force direction with an independent display length", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "force-arrow", origin: [2, 3, 4], vector: [-30, 0, -40], length: 10 },
    ])
    const arrow = decoration.group.children[0]
    if (!(arrow instanceof ArrowHelper)) throw new Error("Expected force arrow.")
    decoration.group.updateMatrixWorld(true)
    expect(arrow.position.toArray()).toEqual([2, 3, 4])
    const tip = arrow.cone.getWorldPosition(new Vector3())
    expect(tip.x).toBeCloseTo(-4)
    expect(tip.y).toBeCloseTo(3)
    expect(tip.z).toBeCloseTo(-4)
    const direction = new Vector3(0, 1, 0).applyQuaternion(arrow.quaternion)
    expect(direction.x).toBeCloseTo(-0.6)
    expect(direction.z).toBeCloseTo(-0.8)
    decoration.dispose()
  })

  it("ignores zero, non-finite force and invalid display lengths without allocating arrows", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 0], length: 10 },
      { kind: "force-arrow", origin: [0, 0, 0], vector: [Number.NaN, 0, 1], length: 10 },
      {
        kind: "force-arrow",
        origin: [0, 0, Number.POSITIVE_INFINITY],
        vector: [0, 0, 1],
        length: 10,
      },
      { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 1], length: 0 },
      { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 1], length: -1 },
    ])
    expect(decoration.group.children).toHaveLength(0)
    decoration.dispose()
  })

  it("normalizes very small finite force components without overflowing their reciprocal", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "force-arrow", origin: [0, 0, 0], vector: [1e-320, 0, 0], length: 10 },
    ])
    const arrow = decoration.group.children[0]
    if (!(arrow instanceof ArrowHelper)) throw new Error("Expected force arrow.")
    decoration.group.updateMatrixWorld(true)
    const tip = arrow.cone.getWorldPosition(new Vector3())
    expect(tip.x).toBeCloseTo(10)
    expect(tip.y).toBeCloseTo(0)
    expect(tip.z).toBeCloseTo(0)
    decoration.dispose()
  })

  it("cannot obscure source face picking even in a recursive scene raycast", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "face", mesh: source, faceIds: [7], role: "support" },
      { kind: "force-arrow", origin: [0.5, 0.5, 0], vector: [0, 0, 1], length: 10 },
    ])
    const surface = new Mesh(createViewerGeometry(source), new MeshBasicMaterial())
    surface.updateMatrixWorld(true)
    decoration.group.updateMatrixWorld(true)
    const raycaster = new Raycaster(new Vector3(0.5, 0.5, 20), new Vector3(0, 0, -1))
    expect(raycaster.intersectObject(decoration.group, true)).toEqual([])
    const hits = raycaster.intersectObjects([decoration.group, surface], true)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.object).toBe(surface)
    expect(hits[0]?.faceIndex).toBe(0)
    surface.geometry.dispose()
    surface.material.dispose()
    decoration.dispose()
  })

  it("clips both the face surfaces and the force shaft and head", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    decoration.setOverlays([
      { kind: "face", mesh: source, faceIds: [7], role: "support" },
      { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 1], length: 10 },
    ])
    const planes = [new Plane(new Vector3(1, 0, 0), -1)]
    decoration.setClipping(planes)
    let materialCount = 0
    decoration.group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Line) || Array.isArray(object.material))
        return
      materialCount += 1
      expect(object.material.clippingPlanes).toBe(planes)
    })
    expect(materialCount).toBe(3)
    decoration.dispose()
  })

  it("releases every owned geometry and material on replacement, clear, and final disposal", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    const watchResources = () => {
      const resources: ReturnType<typeof vi.fn>[] = []
      decoration.group.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof Line) || Array.isArray(object.material))
          return
        for (const resource of [object.geometry, object.material]) {
          const onDispose = vi.fn()
          resource.addEventListener("dispose", onDispose)
          resources.push(onDispose)
        }
      })
      return resources
    }
    const overlays = [
      { kind: "face" as const, mesh: source, faceIds: [7], role: "support" as const },
      {
        kind: "force-arrow" as const,
        origin: [0, 0, 0] as const,
        vector: [0, 0, 1] as const,
        length: 10,
      },
    ]
    decoration.setOverlays(overlays)
    const replaced = watchResources()
    expect(replaced).toHaveLength(6)
    decoration.setOverlays(overlays)
    for (const onDispose of replaced) expect(onDispose).toHaveBeenCalledTimes(1)
    const cleared = watchResources()
    decoration.setOverlays(null)
    for (const onDispose of cleared) expect(onDispose).toHaveBeenCalledTimes(1)
    expect(decoration.group.children).toHaveLength(0)
    decoration.setOverlays(overlays)
    const final = watchResources()
    decoration.dispose()
    decoration.dispose()
    for (const onDispose of final) expect(onDispose).toHaveBeenCalledTimes(1)
    decoration.setOverlays(overlays)
    expect(decoration.group.children).toHaveLength(0)
  })

  it("owns arrow geometry independently from another live arrow", () => {
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry)
    const other = new ArrowHelper(new Vector3(0, 1, 0))
    const sharedLineDisposed = vi.fn()
    const sharedConeDisposed = vi.fn()
    other.line.geometry.addEventListener("dispose", sharedLineDisposed)
    other.cone.geometry.addEventListener("dispose", sharedConeDisposed)
    decoration.setOverlays([
      { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 1], length: 10 },
    ])
    const arrow = decoration.group.children[0]
    if (!(arrow instanceof ArrowHelper)) throw new Error("Expected force arrow.")
    expect(arrow.line.geometry).not.toBe(other.line.geometry)
    expect(arrow.cone.geometry).not.toBe(other.cone.geometry)
    decoration.dispose()
    expect(sharedLineDisposed).not.toHaveBeenCalled()
    expect(sharedConeDisposed).not.toHaveBeenCalled()
    for (const object of [other.line, other.cone]) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    }
  })

  it("refreshes semantic colors on theme changes and disconnects the observer on disposal", () => {
    let notify = () => {}
    let rgba = [20, 40, 60, 255]
    const disconnect = vi.fn()
    const onThemeChange = vi.fn()
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          notify = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    vi.stubGlobal("document", {
      documentElement: {},
      createElement: () => ({
        getContext: () => ({
          fillStyle: "",
          fillRect: () => {},
          getImageData: () => ({ data: rgba }),
        }),
      }),
    })
    const getPropertyValue = vi.fn(() => "oklch(0.7 0.1 200)")
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue }))
    const decoration = new AnalysisOverlayDecoration(createFaceHighlightGeometry, onThemeChange)
    try {
      decoration.setOverlays([
        { kind: "face", mesh: source, faceIds: [7], role: "support" },
        { kind: "force-arrow", origin: [0, 0, 0], vector: [0, 0, 1], length: 10 },
      ])
      const face = decoration.group.children[0]
      const arrow = decoration.group.children[1]
      if (
        !(face instanceof Mesh) ||
        Array.isArray(face.material) ||
        !(arrow instanceof ArrowHelper)
      )
        throw new Error("Expected face and force arrow.")
      expect(face.material.color.getHexString()).toBe("14283c")
      rgba = [100, 130, 150, 255]
      notify()
      expect(face.material.color.getHexString()).toBe("648296")
      expect(getPropertyValue).toHaveBeenCalledWith("--preselection")
      expect(getPropertyValue).toHaveBeenCalledWith("--diagnostic-warning")
      expect(onThemeChange).toHaveBeenCalledTimes(1)
      decoration.dispose()
      expect(disconnect).toHaveBeenCalledTimes(1)
    } finally {
      decoration.dispose()
      vi.unstubAllGlobals()
    }
  })
})
