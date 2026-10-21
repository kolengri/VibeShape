import { describe, expect, it } from "bun:test"
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { vi } from "../../../tests/unit/support/bun-test"
import { EdgePresentation } from "./edge-presentation"
import { createViewerGeometry, viewerBodyKey } from "./mesh-geometry"
import { firstViewerSelectionHit } from "./mesh-selection"
import type { ViewerEdgeCandidate, ViewerMesh } from "./three-viewport"

function body(outputRole: string | undefined = "result", z = 0) {
  const source: ViewerMesh = {
    featureId: "box",
    ...(outputRole === undefined ? {} : { outputRole }),
    positions: new Float32Array([-10, -10, z, 10, -10, z, 10, 10, z, -10, 10, z]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    triangleFaceIds: new Uint32Array([17, 17]),
  }
  const surface = new Mesh(
    createViewerGeometry(source),
    new MeshBasicMaterial({ side: DoubleSide }),
  )
  surface.name = viewerBodyKey(source)
  surface.updateMatrixWorld()
  return { source, surface }
}

function edge(
  id = "edge-a",
  outputRole: string | undefined = "result",
  z = 0,
): ViewerEdgeCandidate {
  return {
    featureId: "box",
    outputRole,
    candidateId: id,
    label: id,
    points: [
      [-8, 0, z],
      [8, 0, z],
    ],
  }
}

function fixture() {
  const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 100)
  camera.position.set(0, 0, 30)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const preselection = vi.fn()
  const stack = vi.fn()
  const presentation = new EdgePresentation({ preselection, stack, changed: () => undefined })
  const model = body()
  presentation.setBodies([model])
  const pick = (x = 0, y = 0) => presentation.pick(camera, new Vector2(x / 200, y / 200), 400, 400)
  const dispose = () => {
    presentation.dispose()
    model.surface.geometry.dispose()
    model.surface.material.dispose()
  }
  return { camera, presentation, model, preselection, stack, pick, dispose }
}

describe("ordinary CAD edge presentation", () => {
  it("offers the visible edge at the pixel threshold and leaves the adjacent face available outside it", () => {
    const f = fixture()
    try {
      const candidate = edge()
      f.presentation.setCandidates([candidate])
      expect(f.pick(0, 6)).toBe(candidate)
      expect(f.pick(0, 6.1)).toBeNull()
      const raycaster = new Raycaster()
      raycaster.setFromCamera(new Vector2(0, 6.1 / 200), f.camera)
      expect(
        firstViewerSelectionHit(
          raycaster.intersectObject(f.model.surface),
          new Map([[viewerBodyKey(f.model.source), f.model.source]]),
          null,
        )?.selection.faceId,
      ).toBe(17)
    } finally {
      f.dispose()
    }
  })

  it("keeps the CSS-pixel threshold under zoom, camera distance, and non-square viewports", () => {
    const f = fixture()
    try {
      const candidate = edge()
      f.presentation.setCandidates([candidate])
      for (const zoom of [0.1, 1, 10, 100]) {
        f.camera.zoom = zoom
        f.camera.position.z = 50
        f.camera.updateProjectionMatrix()
        expect(f.presentation.pick(f.camera, new Vector2(0, 5.9 / 150), 800, 300)).toBe(candidate)
        expect(f.presentation.pick(f.camera, new Vector2(0, 6.1 / 150), 800, 300)).toBeNull()
      }
    } finally {
      f.dispose()
    }
  })

  it("orders overlaps deterministically, retains keyboard preselection, and repicks changed pointer positions", () => {
    const f = fixture()
    try {
      const a = edge("a")
      const b = edge("b")
      f.presentation.setCandidates([b, a, a])
      expect(f.pick()).toBe(a)
      expect(f.stack).toHaveBeenLastCalledWith([a, b])
      f.presentation.setPreselection(b)
      expect(f.pick()).toBe(b)
      expect(f.pick(0, 20)).toBeNull()
      expect(f.stack).toHaveBeenLastCalledWith([])
      expect(f.preselection).toHaveBeenLastCalledWith(null)
      expect(f.pick()).toBe(a)
      f.presentation.clearPicking()
      expect(f.preselection).toHaveBeenLastCalledWith(null)
    } finally {
      f.dispose()
    }
  })

  it("measures rotated camera hits in screen pixels and invalidates moved samples with a reused candidate ID", () => {
    const f = fixture()
    try {
      const candidate = edge()
      f.presentation.setCandidates([candidate])
      f.camera.up.set(1, 0, 0)
      f.camera.lookAt(0, 0, 0)
      expect(f.pick(5.9, 0)).toBe(candidate)
      expect(f.pick(6.1, 0)).toBeNull()
      expect(f.pick()).toBe(candidate)
      const moved = {
        ...candidate,
        points: [
          [-8, 5, 0],
          [8, 5, 0],
        ] as const,
      }
      f.presentation.setCandidates([moved])
      expect(f.preselection).toHaveBeenLastCalledWith(null)
      expect(f.stack).toHaveBeenLastCalledWith([])
      expect(f.pick()).toBeNull()
    } finally {
      f.dispose()
    }
  })

  it("never widens a missing role to a sibling body or assigns preview, datum, or selection-source ownership", () => {
    const f = fixture()
    try {
      for (const candidate of [
        edge("sibling", "other"),
        { ...edge("legacy"), outputRole: undefined },
      ]) {
        f.presentation.setCandidates([candidate])
        expect(f.pick()).toBeNull()
      }
      for (const appearance of ["preview", "datum", "selection-source"] as const) {
        f.presentation.setBodies([{ ...f.model, source: { ...f.model.source, appearance } }])
        f.presentation.setCandidates([edge()])
        expect(f.pick()).toBeNull()
      }
      const legacy = body()
      const source = { ...legacy.source }
      delete source.outputRole
      f.presentation.setBodies([{ ...legacy, source }])
      const wholeProducer = { ...edge("legacy"), outputRole: undefined }
      f.presentation.setCandidates([wholeProducer, edge("invented-result")])
      expect(f.pick()).toBe(wholeProducer)
      expect(f.stack).toHaveBeenLastCalledWith([wholeProducer])
      legacy.surface.geometry.dispose()
      legacy.surface.material.dispose()
    } finally {
      f.dispose()
    }
  })

  it("invalidates hidden and replaced geometry without reviving old candidates on reappearance", () => {
    const f = fixture()
    try {
      f.presentation.setCandidates([{ ...edge(), selected: true }])
      expect(f.pick()).not.toBeNull()
      f.model.surface.visible = false
      f.presentation.setBodies([f.model])
      expect(f.pick()).toBeNull()
      expect(f.presentation.group.children.every((group) => group.children.length === 0)).toBe(true)
      f.model.surface.visible = true
      f.presentation.setBodies([f.model])
      expect(f.pick()).toBeNull()
      f.presentation.setCandidates([edge()])
      expect(f.pick()).not.toBeNull()
      const replacement = body("result", 1)
      f.presentation.setBodies([replacement])
      expect(f.pick()).toBeNull()
      f.presentation.setCandidates([edge("new", "result", 1)])
      expect(f.pick()?.candidateId).toBe("new")
      replacement.surface.geometry.dispose()
      replacement.surface.material.dispose()
    } finally {
      f.dispose()
    }
  })

  it("rejects occluded edges using the edge's screen point and ignores clipped occluders", () => {
    const f = fixture()
    const front = body("front", 5)
    try {
      f.presentation.setBodies([f.model, front])
      f.presentation.setCandidates([edge()])
      expect(f.pick()).toBeNull()
      expect(f.pick(0, 5)).toBeNull()
      f.presentation.setClipping([new Plane(new Vector3(0, 0, -1), 1)])
      expect(f.pick()?.candidateId).toBe("edge-a")
      f.presentation.setClipping([new Plane(new Vector3(0, 0, 1), -1)])
      expect(f.pick()).toBeNull()
    } finally {
      front.surface.geometry.dispose()
      front.surface.material.dispose()
      f.dispose()
    }
  })

  it("does not expose edges just behind a surface when zooming out", () => {
    const f = fixture()
    try {
      f.presentation.setCandidates([edge("hidden", "result", -0.001)])
      for (const zoom of [0.01, 0.1, 1, 10]) {
        f.camera.zoom = zoom
        f.camera.updateProjectionMatrix()
        expect(f.pick()).toBeNull()
      }
    } finally {
      f.dispose()
    }
  })

  it("clips crossing segments before distance tests and rejects points outside camera depth", () => {
    const f = fixture()
    try {
      f.presentation.setCandidates([edge()])
      f.presentation.setClipping([new Plane(new Vector3(1, 0, 0), 0)])
      expect(f.pick(-7)).toBeNull()
      expect(f.pick(7)?.candidateId).toBe("edge-a")
      f.presentation.setClipping(null)
      f.presentation.setCandidates([edge("behind-camera", "result", 40)])
      expect(f.pick()).toBeNull()
      f.presentation.setCandidates([edge("past-far", "result", -100)])
      expect(f.pick()).toBeNull()
    } finally {
      f.dispose()
    }
  })

  it("clears hover and stacks on mode changes and disposes clipped depth-tested strokes exactly once", () => {
    const f = fixture()
    try {
      const selected = { ...edge(), selected: true }
      f.presentation.setCandidates([selected])
      f.presentation.resize(800, 600)
      expect(f.pick()).toBe(selected)
      const stroke = f.presentation.group.children[0]?.children[0]
      if (!(stroke instanceof LineSegments2)) throw new Error("Expected a selected edge stroke.")
      const geometryDisposed = vi.fn()
      const materialDisposed = vi.fn()
      stroke.geometry.addEventListener("dispose", geometryDisposed)
      stroke.material.addEventListener("dispose", materialDisposed)
      expect(stroke.material.depthTest).toBe(true)
      expect(stroke.material.depthWrite).toBe(false)
      expect(stroke.material.resolution.toArray()).toEqual([800, 600])
      const plane = new Plane(new Vector3(1, 0, 0), 0)
      f.presentation.setClipping([plane])
      expect(stroke.material.clippingPlanes).toEqual([plane])
      expect(f.preselection).toHaveBeenLastCalledWith(null)
      f.presentation.setEnabled(false)
      expect(f.presentation.group.visible).toBe(false)
      expect(f.pick()).toBeNull()
      f.presentation.setEnabled(true)
      expect(f.pick()).toBe(selected)
      f.presentation.dispose()
      f.presentation.dispose()
      expect(geometryDisposed).toHaveBeenCalledTimes(1)
      expect(materialDisposed).toHaveBeenCalledTimes(1)
      expect(f.pick()).toBeNull()
      expect(f.stack).toHaveBeenLastCalledWith([])
      expect(f.preselection).toHaveBeenLastCalledWith(null)
    } finally {
      f.dispose()
    }
  })
})
