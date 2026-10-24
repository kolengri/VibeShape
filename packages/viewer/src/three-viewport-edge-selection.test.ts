import "../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../tests/unit/support/bun-test"
import type { EdgePreparationRequest } from "./edge-preparation-schema"
import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerEdgeCandidate,
  ViewerMesh,
  ViewerSketch,
  ViewerVector3,
} from "./three-viewport"

const originalThree = { ...(await import("three")) }
const renderedCameras: import("three").Camera[] = []
const renderedScenes = new Map<import("three").Camera, import("three").Scene>()
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
      renderedScenes.set(camera, scene)
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
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fixture(options: GeometryViewportOptions = {}) {
  renderedCameras.length = 0
  renderedScenes.clear()
  vi.stubGlobal("MessageEvent", window.MessageEvent)
  const edgeJobs: { worker: EventTarget; request: EdgePreparationRequest }[] = []
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
      postMessage(request: EdgePreparationRequest) {
        if (request.type === "prepareEdges") edgeJobs.push({ worker: this, request })
      }
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
  if (!(camera instanceof originalThree.OrthographicCamera))
    throw new Error("The viewport must render its orthographic model camera.")
  const scene = renderedScenes.get(camera)
  if (!scene) throw new Error("The viewport must render its model scene.")
  return { viewport: current, canvas, camera, scene, edgeJobs, flush, pointer, click }
}

function raisedMesh(height: number): ViewerMesh {
  return {
    ...model,
    positions: model.positions.map((value, index) => (index % 3 === 2 ? height : value)),
  }
}

function raisedSketch(height: number): ViewerSketch {
  return {
    sketchId: "raised-sketch",
    curvePositions: new Float32Array([0, 0, height, 10, 10, height]),
    constructionCurvePositions: new Float32Array(),
    pointPositions: new Float32Array(),
    constructionPointPositions: new Float32Array(),
  }
}

function expectDepthContains(camera: import("three").OrthographicCamera, point: ViewerVector3) {
  const depth = -new originalThree.Vector3(...point).applyMatrix4(camera.matrixWorldInverse).z
  expect(depth).toBeGreaterThanOrEqual(camera.near - 1e-6)
  expect(depth).toBeLessThanOrEqual(camera.far + 1e-6)
}

describe("viewport navigation activity", () => {
  it("keeps a stationary orbit held until release and then reports a quiet interval", () => {
    vi.useFakeTimers()
    const change = mock((_active: boolean) => {})
    const f = fixture({ onNavigationActivityChange: change })
    vi.advanceTimersByTime(200)
    change.mockClear()
    f.pointer("pointerdown")
    vi.advanceTimersByTime(1000)
    expect(change.mock.calls).toEqual([[true]])
    f.pointer("pointerup")
    vi.advanceTimersByTime(199)
    expect(change.mock.calls).toEqual([[true]])
    vi.advanceTimersByTime(1)
    expect(change.mock.calls).toEqual([[true], [false]])
  })

  for (const end of ["pointercancel", "blur", "cancelInteractions"] as const) {
    it(`releases navigation activity after ${end}`, () => {
      vi.useFakeTimers()
      const change = mock((_active: boolean) => {})
      const f = fixture({ onNavigationActivityChange: change })
      vi.advanceTimersByTime(200)
      change.mockClear()
      f.pointer("pointerdown")
      if (end === "blur") window.dispatchEvent(new Event("blur"))
      else if (end === "cancelInteractions") f.viewport.cancelInteractions()
      else f.pointer("pointercancel")
      vi.advanceTimersByTime(200)
      expect(change.mock.calls).toEqual([[true], [false]])
    })
  }

  it("reports wheel and pointer-orbit changes and cancels delayed callbacks on disposal", () => {
    vi.useFakeTimers()
    const change = mock((_active: boolean) => {})
    const f = fixture({ onNavigationActivityChange: change })
    vi.advanceTimersByTime(200)
    change.mockClear()
    f.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }))
    vi.advanceTimersByTime(200)
    expect(change.mock.calls).toEqual([[true], [false]])
    f.viewport.setPointerOrbit(true)
    f.pointer("pointermove", 180, 180)
    f.pointer("pointermove", 190, 195)
    expect(change.mock.calls.at(-1)).toEqual([true])
    const count = change.mock.calls.length
    f.viewport.dispose()
    vi.advanceTimersByTime(1000)
    expect(change).toHaveBeenCalledTimes(count)
  })

  it("holds inset activity independently of disabled orbit controls", () => {
    vi.useFakeTimers()
    const change = mock((_active: boolean) => {})
    const f = fixture({ onNavigationActivityChange: change })
    vi.advanceTimersByTime(200)
    change.mockClear()
    f.pointer("pointerdown", 40, 350)
    vi.advanceTimersByTime(1000)
    expect(change.mock.calls).toEqual([[true]])
    f.pointer("pointercancel", 40, 350)
    vi.advanceTimersByTime(200)
    expect(change.mock.calls).toEqual([[true], [false]])
  })
})

describe("camera scene preparation", () => {
  it("reuses scene preparation across standard views, wheel zoom, and pointer orbit", () => {
    const f = fixture()
    f.viewport.setPointerOrbit(true)
    f.flush()
    const bounds = vi.spyOn(originalThree.Box3.prototype, "expandByObject")
    const clipping = vi.spyOn(originalThree.Object3D.prototype, "traverse")
    for (const view of ["front", "isometric", "left", "top"] as const) {
      f.viewport.setStandardView(view)
      f.flush()
      expectDepthContains(f.camera, [10, 10, 0])
    }
    const zoom = f.camera.zoom
    f.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }))
    f.flush()
    expect(f.camera.zoom).not.toBe(zoom)
    const orientation = f.camera.quaternion.toArray()
    f.pointer("pointermove", 180, 180)
    f.pointer("pointermove", 190, 195)
    f.flush()
    expect(f.camera.quaternion.toArray()).not.toEqual(orientation)
    expect(bounds).not.toHaveBeenCalled()
    expect(clipping).not.toHaveBeenCalled()
  })

  it("refreshes replaced source bounds, releases old buffers, and restores empty-scene depth", () => {
    const f = fixture()
    f.viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
    f.flush()
    const surface = f.scene.getObjectByName("box\u0000result")
    if (!(surface instanceof originalThree.Mesh)) throw new Error("The body is missing.")
    const disposed = vi.fn()
    surface.geometry.addEventListener("dispose", disposed)
    f.viewport.setMeshes([raisedMesh(1_000)])
    f.flush()
    expect(disposed).toHaveBeenCalledTimes(1)
    expectDepthContains(f.camera, [10, 10, 1_000])
    f.viewport.setMeshes([])
    f.flush()
    expect(f.camera.near).toBe(0.01)
    expect(f.camera.far).toBe(10_000)
  })

  it("refreshes bounds when overlays, references, sketches, planes, and the print bed change", () => {
    const f = fixture()
    f.viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
    f.flush()
    const baselineSpan = f.camera.far - f.camera.near
    const mutations: { show: () => void; clear: () => void; point: ViewerVector3 }[] = [
      {
        show: () => f.viewport.setSketches([raisedSketch(1_000)]),
        clear: () => f.viewport.setSketches([]),
        point: [0, 0, 1_000],
      },
      {
        show: () => f.viewport.setFeaturePreselection(raisedMesh(1_100)),
        clear: () => f.viewport.setFeaturePreselection(null),
        point: [0, 0, 1_100],
      },
      {
        show: () => f.viewport.setFeatureSelection(raisedMesh(1_200)),
        clear: () => f.viewport.setFeatureSelection(null),
        point: [0, 0, 1_200],
      },
      {
        show: () =>
          f.viewport.setAnalysisOverlays([
            { kind: "face", mesh: raisedMesh(1_300), faceIds: [17], role: "support" },
          ]),
        clear: () => f.viewport.setAnalysisOverlays(null),
        point: [0, 0, 1_300],
      },
      {
        show: () =>
          f.viewport.setSketchReferenceCandidates([
            {
              kind: "point",
              label: "Reference",
              position: [0, 0, 1_400],
              sourcePointId: "p",
              sourceSketchId: "s",
            },
          ]),
        clear: () => f.viewport.setSketchReferenceCandidates([]),
        point: [0, 0, 1_400],
      },
      {
        show: () =>
          f.viewport.setSketchReferencePreselection({
            kind: "point",
            label: "Reference",
            position: [0, 0, 1_450],
            sourcePointId: "p",
            sourceSketchId: "s",
          }),
        clear: () => f.viewport.setStandardView("top"),
        point: [0, 0, 1_450],
      },
      {
        show: () => f.viewport.setToolPlane({ origin: [0, 0, 1_500], normal: [0, 0, 1], size: 20 }),
        clear: () => f.viewport.setToolPlane(null),
        point: [0, 0, 1_500],
      },
      {
        show: () => f.viewport.setPrintBed({ width: 200, depth: 100, height: 1_600, margin: 0 }),
        clear: () => f.viewport.setPrintBed(null),
        point: [0, 0, 1_600],
      },
      {
        show: () => f.viewport.setOriginPlaneVisibility({ xy: true, xz: true, yz: true }),
        clear: () => f.viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false }),
        point: [0, 0, 32],
      },
    ]
    for (const mutation of mutations) {
      mutation.show()
      f.flush()
      expectDepthContains(f.camera, mutation.point)
      mutation.clear()
      f.flush()
      expect(f.camera.far - f.camera.near).toBeCloseTo(baselineSpan, 6)
    }
  })

  it("applies clipping to replacement materials and newly created selection and sketch overlays", () => {
    const f = fixture()
    const checkPlane = (name: string, constant: number | null) => {
      const object = f.scene.getObjectByName(name)
      if (!(object instanceof originalThree.Mesh || object instanceof originalThree.LineSegments))
        throw new Error(`Missing clipped object: ${name}`)
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (constant === null) expect(material.clippingPlanes).toBeNull()
        else {
          expect(material.clippingPlanes?.[0]?.normal.toArray()).toEqual([-1, 0, 0])
          expect(material.clippingPlanes?.[0]?.constant).toBe(constant)
        }
      }
    }
    f.viewport.setSection({ axis: "x", offset: 4, flipped: false })
    f.flush()
    f.viewport.setMeshes([raisedMesh(20)])
    f.viewport.setSketches([raisedSketch(30)])
    f.viewport.setFeatureSelection(raisedMesh(40))
    f.viewport.setFaceSelections([
      { featureId: "box", outputRole: "result", faceId: 17, faceOrdinal: 1 },
    ])
    f.flush()
    checkPlane("box\u0000result", 4)
    checkPlane("box\u0000result:feature-highlight", 4)
    checkPlane("sketch:raised-sketch:curves", 4)
    const faces: import("three").Mesh[] = []
    f.scene.traverse((object) => {
      if (object instanceof originalThree.Mesh && !object.name && object.renderOrder === 4)
        faces.push(object)
    })
    expect(faces).toHaveLength(1)
    for (const face of faces) {
      const materials = Array.isArray(face.material) ? face.material : [face.material]
      expect(materials.every((material) => material.clippingPlanes?.[0]?.constant === 4)).toBe(true)
    }
    f.viewport.setSection({ axis: "x", offset: 6, flipped: false })
    f.flush()
    checkPlane("box\u0000result", 6)
    f.viewport.setSection(null)
    f.flush()
    checkPlane("box\u0000result", null)
    checkPlane("box\u0000result:feature-highlight", null)
    checkPlane("sketch:raised-sketch:curves", null)
  })

  it("invalidates preparation when asynchronous edges arrive, then reuses it for the camera", async () => {
    const f = fixture()
    const job = f.edgeJobs[0]
    if (!job) throw new Error("The body must request edge preparation.")
    const bounds = vi.spyOn(originalThree.Box3.prototype, "expandByObject")
    job.worker.dispatchEvent(
      new MessageEvent("message", {
        data: {
          version: 1,
          type: "edgesPrepared",
          jobId: job.request.jobId,
          positions: new Float32Array([-10, -10, 0, 10, -10, 0]),
          picking: null,
        },
      }),
    )
    await Promise.resolve()
    f.flush()
    expect(bounds).toHaveBeenCalled()
    const edges = f.scene.getObjectByName("box\u0000result:edges")
    expect(
      edges instanceof originalThree.LineSegments && edges.geometry.getAttribute("position").count,
    ).toBe(2)
    bounds.mockClear()
    f.viewport.setStandardView("front")
    f.flush()
    expect(bounds).not.toHaveBeenCalled()
  })

  it("updates finite translation and section handles on zoom and angular bounds on mutation", () => {
    const f = fixture()
    f.viewport.showTranslationGizmo([0, 0, 1_000])
    f.flush()
    f.camera.zoom = 0.05
    f.viewport.setStandardView("top")
    f.flush()
    const handleRadius = (f.camera.top - f.camera.bottom) / f.camera.zoom / 8
    expectDepthContains(f.camera, [0, 0, 1_000 + handleRadius])
    expectDepthContains(f.camera, [0, 0, 1_000 - handleRadius])
    f.viewport.hideTranslationGizmo()
    f.viewport.showAngularGizmo({
      angle: Math.PI,
      axisOrigin: [0, 0, 2_000],
      axisDirection: [0, 1, 0],
      rotationOrigin: [100, 0, 2_000],
    })
    f.flush()
    expectDepthContains(f.camera, [0, 0, 1_900])
    f.viewport.hideAngularGizmo()
    f.viewport.setSection({ axis: "z", offset: 0, flipped: false })
    f.flush()
    f.camera.zoom = 0.01
    f.viewport.setStandardView("front")
    f.flush()
    const handle = f.canvas.dataset.sectionGizmoHandle?.split(",").map(Number)
    expect(handle?.every(Number.isFinite)).toBe(true)
    expect(f.camera.far - f.camera.near).toBeGreaterThan(100)
  })
})

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

it("does not clear absent edges before repeated explicit face picks, but still delivers face callbacks", () => {
  const onFace = vi.fn()
  const onEdge = vi.fn()
  const f = fixture({ onSelectionChange: onFace, onEdgeSelectionChange: onEdge })
  const face = { featureId: "box", outputRole: "result", faceId: 17, faceOrdinal: 1 }
  f.viewport.selectFace?.(face)
  f.viewport.selectFace?.({ ...face })
  expect(onFace).toHaveBeenCalledTimes(2)
  expect(onFace).toHaveBeenLastCalledWith(face)
  expect(onEdge).not.toHaveBeenCalled()
  f.click()
  expect(onEdge).toHaveBeenLastCalledWith(edge)
  onEdge.mockClear()
  f.viewport.selectFace?.(face)
  expect(onEdge).toHaveBeenCalledTimes(1)
  expect(onEdge).toHaveBeenLastCalledWith(null)
  expect(onFace).toHaveBeenLastCalledWith(face)
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
