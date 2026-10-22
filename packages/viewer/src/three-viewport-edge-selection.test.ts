import "../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerEdgeCandidate,
  ViewerMesh,
} from "./three-viewport"

const originalThree = { ...(await import("three")) }
const renderedCameras: import("three").Camera[] = []
mock.module("three", () => ({
  ...originalThree,
  WebGLRenderer: class {
    localClippingEnabled = false
    setClearAlpha() {}
    setPixelRatio() {}
    getPixelRatio() {
      return 1
    }
    setSize() {}
    setScissorTest() {}
    setViewport() {}
    setScissor() {}
    clearDepth() {}
    render(scene: import("three").Scene, camera: import("three").Camera) {
      if (!renderedCameras.includes(camera)) renderedCameras.push(camera)
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld()
    }
    dispose() {}
  },
}))

const { createGeometryViewport } = await import("./three-viewport")

const model: ViewerMesh = {
  featureId: "box",
  outputRole: "result",
  positions: new Float32Array([-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  triangleFaceIds: new Uint32Array([17, 17]),
}
const edge: ViewerEdgeCandidate = {
  featureId: "box",
  outputRole: "result",
  candidateId: "a",
  label: "Edge A",
  points: [
    [-8, 0, 0],
    [8, 0, 0],
  ],
}

let viewport: GeometryViewport | undefined
afterEach(() => {
  viewport?.dispose()
  viewport = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function fixture(options: GeometryViewportOptions = {}) {
  renderedCameras.length = 0
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback)
    return next
  })
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle))
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback
      }
      observe(target: Element) {
        this.#callback(
          [{ target, contentRect: { width: 400, height: 400 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      disconnect() {}
    },
  )
  vi.stubGlobal(
    "Worker",
    class extends EventTarget {
      postMessage() {}
      terminate() {}
    },
  )
  const canvas = document.createElement("canvas")
  Object.defineProperties(canvas, {
    clientWidth: { value: 400 },
    clientHeight: { value: 400 },
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 400, height: 400 }) },
    getContext: { value: () => ({}) },
  })
  const captures = new Set<number>()
  canvas.setPointerCapture = (id) => {
    captures.add(id)
  }
  canvas.releasePointerCapture = (id) => {
    captures.delete(id)
  }
  canvas.hasPointerCapture = (id) => captures.has(id)
  document.body.append(canvas)
  const current = createGeometryViewport(canvas, options)
  viewport = current
  current.setMeshes([model])
  current.setStandardView("top")
  current.setEdgeCandidates([edge])
  const flush = () => {
    for (let count = 0; frames.size && count < 20; count += 1) {
      const batch = [...frames.values()]
      frames.clear()
      for (const callback of batch) callback(0)
    }
  }
  flush()
  const pointer = (type: string, x = 200, y = 200, button = 0) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button,
      buttons: type === "pointerdown" ? 1 : 0,
    })
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "mouse" },
      isPrimary: { value: true },
    })
    canvas.dispatchEvent(event)
  }
  const click = (x = 200, y = 200) => {
    pointer("pointerdown", x, y)
    pointer("pointerup", x, y)
    flush()
  }
  const camera = renderedCameras[0]
  if (!camera) throw new Error("The viewport must render its model camera.")
  return { viewport: current, canvas, camera, flush, pointer, click }
}

it("cancels an inset drag that began before a blocking operation and permits a new gesture", () => {
  const f = fixture()
  const inset = f.canvas.dataset.orientationInset?.split(",").map(Number)
  if (inset?.length !== 3) throw new Error("The orientation inset requires a placement.")
  const [left = 0, bottom = 0, size = 0] = inset
  const x = left + size / 2
  const y = f.canvas.clientHeight - bottom - size / 2
  f.pointer("pointerdown", x, y)
  f.pointer("pointermove", x + 20, y + 10)
  f.flush()
  f.viewport.cancelInteractions()
  f.flush()
  const pose = f.camera.quaternion.toArray()
  f.pointer("pointermove", x + 60, y + 30)
  f.pointer("pointerup", x + 60, y + 30)
  f.flush()
  expect(f.camera.quaternion.toArray()).toEqual(pose)
  expect(f.canvas.hasPointerCapture(1)).toBe(false)
  f.pointer("pointerdown", x, y)
  f.pointer("pointermove", x - 30, y - 10)
  f.pointer("pointerup", x - 30, y - 10)
  f.flush()
  expect(f.camera.quaternion.toArray()).not.toEqual(pose)
})

it("cancels and restores an active section drag before accepting another gesture", () => {
  const changed = vi.fn()
  const f = fixture({ onSectionChange: changed })
  f.viewport.setStandardView("isometric")
  f.viewport.setSection({ axis: "z", offset: 0, flipped: false })
  f.flush()
  const handle = f.canvas.dataset.sectionGizmoHandle?.split(",").map(Number)
  if (handle?.length !== 2) throw new Error("The section needs a drag handle.")
  const [x = 0, y = 0] = handle
  f.pointer("pointerdown", x, y)
  expect(f.canvas.dataset.sectionDragging).toBe("true")
  f.pointer("pointermove", x + 10, y - 20)
  f.flush()
  expect(changed).toHaveBeenCalled()
  f.viewport.cancelInteractions()
  f.flush()
  expect(changed).toHaveBeenLastCalledWith({ axis: "z", offset: 0, flipped: false })
  const calls = changed.mock.calls.length
  f.pointer("pointermove", x + 70, y - 40)
  f.pointer("pointerup", x + 70, y - 40)
  f.flush()
  expect(changed).toHaveBeenCalledTimes(calls)
  expect(f.canvas.dataset.sectionDragging).toBeUndefined()
  f.pointer("pointerdown", x, y)
  expect(f.canvas.dataset.sectionDragging).toBe("true")
  f.pointer("pointermove", x + 15, y - 15)
  f.flush()
  expect(changed.mock.calls.length).toBeGreaterThan(calls)
  f.pointer("pointerup", x + 15, y - 15)
})

describe("ordinary viewport edge selection integration", () => {
  it("prioritizes a visible edge, clears a face before emitting it, and clears edges before face/background callbacks", () => {
    const calls: string[] = []
    const f = fixture({
      onSelectionChange: (selection) => calls.push(selection ? "face" : "face:null"),
      onEdgeSelectionChange: (candidate) => calls.push(candidate ? "edge" : "edge:null"),
    })
    f.click(200, 225)
    expect(calls.slice(-2)).toEqual(["edge:null", "face"])
    calls.length = 0
    f.click()
    expect(calls).toEqual(["face:null", "edge"])
    calls.length = 0
    f.click(200, 225)
    expect(calls).toEqual(["edge:null", "face"])
    calls.length = 0
    f.click(300, 200)
    expect(calls).toEqual(["edge:null", "face:null"])
  })

  it("retains externally cycled overlaps through OrbitControls pointer-down and repicks without a hover", () => {
    const selected = vi.fn()
    const stack = vi.fn()
    const hover = vi.fn()
    const f = fixture({
      onEdgeSelectionChange: selected,
      onEdgeCandidateStackChange: stack,
      onEdgePreselectionChange: hover,
    })
    const other = { ...edge, candidateId: "b" }
    f.viewport.setEdgeCandidates([other, edge])
    f.pointer("pointermove")
    f.flush()
    expect(stack).toHaveBeenLastCalledWith([edge, other])
    f.viewport.setEdgePreselection(other)
    f.click()
    expect(selected).toHaveBeenLastCalledWith(other)
    f.pointer("pointerleave")
    expect(stack).toHaveBeenLastCalledWith([])
    expect(hover).toHaveBeenLastCalledWith(null)
    f.click()
    expect(selected).toHaveBeenLastCalledWith(edge)
  })

  it("prioritizes edges over adjacent profiles and clears profile and plane selections before committing edges", () => {
    const calls: string[] = []
    const f = fixture({
      onEdgeSelectionChange: (candidate) => calls.push(candidate ? "edge" : "edge:null"),
      onSketchProfileSelectionChange: (profile) => calls.push(profile ? "profile" : "profile:null"),
      onOriginPlaneSelectionChange: (plane) => calls.push(plane ? "plane" : "plane:null"),
    })
    f.viewport.setSketches([
      {
        sketchId: "sketch",
        frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
        curvePositions: new Float32Array(),
        constructionCurvePositions: new Float32Array(),
        pointPositions: new Float32Array(),
        constructionPointPositions: new Float32Array(),
        profiles: [
          {
            selector: {
              schemaVersion: 0,
              sketchId: "sketch",
              outerBoundaryEntityIds: ["loop"],
              holeBoundaryEntityIds: [],
            },
            outerPositions: new Float32Array([-10, -10, 10, -10, 10, 10, -10, 10]),
            holePositions: [],
          },
        ],
      },
    ])
    f.flush()
    f.click(200, 225)
    expect(calls).toEqual(["edge:null", "profile"])
    calls.length = 0
    f.click()
    expect(calls).toEqual(["profile:null", "edge"])
    f.viewport.setOriginPlaneSelection("xy", false, true)
    calls.length = 0
    f.click()
    expect(calls).toEqual(["profile:null", "plane:null", "edge"])
    f.viewport.setMeshes([])
    f.viewport.setSketches([])
    f.flush()
    calls.length = 0
    f.click()
    expect(calls.at(0)).toBe("edge:null")
    expect(calls.at(-1)).toBe("plane")
  })

  it("cancels pending hover on mesh replacement and disposal without reviving stale stacks", () => {
    const stack = vi.fn()
    const hover = vi.fn()
    const f = fixture({ onEdgeCandidateStackChange: stack, onEdgePreselectionChange: hover })
    f.pointer("pointermove")
    f.viewport.setMeshes([])
    f.flush()
    expect(hover).not.toHaveBeenCalledWith(edge)
    f.viewport.setMeshes([model])
    f.viewport.setEdgeCandidates([edge])
    f.flush()
    f.pointer("pointermove")
    f.flush()
    expect(stack).toHaveBeenLastCalledWith([edge])
    expect(hover).toHaveBeenLastCalledWith(edge)
    f.pointer("pointermove")
    f.viewport.dispose()
    f.flush()
    expect(stack).toHaveBeenLastCalledWith([])
    expect(hover).toHaveBeenLastCalledWith(null)
  })

  it("suppresses ordinary edges in specialized modes and active brush workflows", () => {
    const selected = vi.fn()
    const stack = vi.fn()
    const f = fixture({ onEdgeSelectionChange: selected, onEdgeCandidateStackChange: stack })
    for (const mode of ["face-select", "sketch-reference-select", "camera-only"] as const) {
      f.viewport.setInteractionMode(mode)
      selected.mockClear()
      f.click()
      expect(selected).not.toHaveBeenCalled()
    }
    f.viewport.setInteractionMode("select")
    f.viewport.setSurfaceTextureBrush(null, true)
    f.click()
    expect(selected).toHaveBeenLastCalledWith(null)
    f.viewport.setSurfaceTextureBrush(null, false)
    f.click()
    expect(selected).toHaveBeenLastCalledWith(edge)
    f.viewport.setOriginPlaneSelection(null, true)
    expect(stack).toHaveBeenLastCalledWith([])
    selected.mockClear()
    f.click()
    expect(selected).not.toHaveBeenCalled()
  })

  it("does not activate an edge after a drag or a gizmo-owned gesture", () => {
    const selected = vi.fn()
    const f = fixture({ onEdgeSelectionChange: selected })
    f.pointer("pointerdown", 200, 180)
    f.pointer("pointerup", 200, 200)
    expect(selected).not.toHaveBeenCalled()
    f.viewport.showAngularGizmo({
      angle: Math.PI,
      axisOrigin: [0, 0, 0],
      axisDirection: [0, 0, 1],
      rotationOrigin: [5, 0, 0],
    })
    f.flush()
    const handle = f.canvas.dataset.angularGizmoHandle?.split(",").map(Number)
    expect(handle).toHaveLength(2)
    f.click(handle?.[0], handle?.[1])
    expect(selected).not.toHaveBeenCalled()
    f.viewport.hideAngularGizmo()
    f.viewport.setPointerOrbit(true)
    f.click()
    expect(selected).not.toHaveBeenCalled()
  })
})
