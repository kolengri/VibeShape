import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { Camera, Object3D, Scene } from "three"

const originalThree = { ...(await import("three")) }
const state = {
  instances: [] as FakeRenderer[],
  canvases: [] as FakeCanvas[],
  draws: [] as number[][],
  holdEncoding: false,
  holdCompilation: false,
  compilationStarted: null as (() => void) | null,
  compilationPolls: 0,
  duringRender: null as (() => void) | null,
}
class FakeRenderer {
  domElement: HTMLCanvasElement
  shadowMap = { enabled: false, type: 0 }
  outputColorSpace = ""
  toneMapping = 0
  disposed = false
  contextReleased = false
  constructor({ canvas }: { canvas: HTMLCanvasElement }) {
    this.domElement = canvas
    state.instances.push(this)
  }
  setPixelRatio() {}
  setSize(width: number, height: number) {
    this.domElement.width = width
    this.domElement.height = height
  }
  render(scene: Scene) {
    state.draws.push(
      scene.children
        .filter((child) => child instanceof originalThree.Mesh)
        .flatMap((child) =>
          Array.from((child as import("three").Mesh).geometry.getAttribute("position").array),
        ),
    )
    state.duringRender?.()
  }
  compile() {
    return new Set([new originalThree.Material()])
  }
  compileAsync(scene: Object3D, _camera: Camera) {
    const materials = this.compile()
    state.compilationStarted?.()
    return new Promise<Object3D>((resolve) => {
      const poll = () => {
        state.compilationPolls++
        // Reproduces Three's invalid currentProgram access after early renderer disposal.
        if (materials.size && this.disposed) throw new Error("Compiler polled disposed programs")
        if (!state.holdCompilation) materials.clear()
        if (!materials.size) resolve(scene)
        else setTimeout(poll, 10)
      }
      setTimeout(poll, 10)
    })
  }
  dispose() {
    this.disposed = true
  }
  forceContextLoss() {
    this.contextReleased = true
  }
  getContext() {
    return {
      SYNC_GPU_COMMANDS_COMPLETE: 1,
      TIMEOUT_EXPIRED: 2,
      WAIT_FAILED: 3,
      fenceSync: () => ({}),
      flush() {},
      clientWaitSync: () => 4,
      deleteSync() {},
    }
  }
}
class FakeCanvas extends EventTarget {
  width = 0
  height = 0
  complete: (() => void) | null = null
  toBlob(callback: BlobCallback) {
    const complete = () => callback(new Blob(["png"], { type: "image/png" }))
    if (state.holdEncoding) this.complete = complete
    else complete()
  }
}
mock.module("three", () => ({ ...originalThree, WebGLRenderer: FakeRenderer }))
mock.module("three-gpu-pathtracer", () => ({
  WebGLPathTracer: class {
    samples = 0
    isCompiling = false
    compiled = false
    constructor(private renderer: FakeRenderer) {}
    tiles = { set() {} }
    textureSize = { set() {} }
    setScene() {}
    renderSample() {
      if (!this.compiled) {
        this.compiled = true
        this.isCompiling = true
        this.renderer
          .compileAsync(new originalThree.Scene(), new originalThree.Camera())
          .then(() => {
            this.isCompiling = false
          })
      }
      if (this.isCompiling) return
      this.samples += 12
      state.duringRender?.()
    }
    dispose() {}
  },
}))
const { renderPicture } = await import("./picture-render")
const mesh = () => ({
  featureId: "body",
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 12, 8]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
})
function browser() {
  const previous = globalThis.document
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        const canvas = new FakeCanvas()
        state.canvases.push(canvas)
        return canvas
      },
    },
  })
  return () =>
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous })
}
let restore: (() => void) | undefined
function setup() {
  restore = browser()
}
afterEach(() => {
  restore?.()
  state.instances = []
  state.canvases = []
  state.draws = []
  state.holdEncoding = false
  state.holdCompilation = false
  state.compilationStarted = null
  state.compilationPolls = 0
  state.duringRender = null
})

describe("private picture renderer lifecycle", () => {
  it("renders a copied input and disposes private geometry, materials and context", async () => {
    setup()
    const geometryDispose = spyOn(originalThree.BufferGeometry.prototype, "dispose")
    const materialDispose = spyOn(originalThree.Material.prototype, "dispose")
    const live = mesh()
    const result = renderPicture({ meshes: [live], settings: { width: 1280, height: 720 } })
    live.positions.fill(99)
    expect((await result).width).toBe(1280)
    expect(state.draws[0]?.some((value) => value === 99)).toBe(false)
    expect(state.instances[0]?.disposed).toBe(true)
    expect(state.instances[0]?.contextReleased).toBe(true)
    expect(state.canvases[0]?.width).toBe(1)
    expect(geometryDispose.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(live.positions[0]).toBe(99)
    geometryDispose.mockRestore()
    materialDispose.mockRestore()
  })
  it("cancels pending PNG encoding and releases the single-render lock", async () => {
    setup()
    state.holdEncoding = true
    const abort = new AbortController()
    let encoding: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      encoding = resolve
    })
    const pending = renderPicture(
      { meshes: [mesh()], settings: {} },
      {
        signal: abort.signal,
        onProgress: ({ stage }) => {
          if (stage === "encoding") encoding()
        },
      },
    )
    await started
    abort.abort()
    await expect(pending).rejects.toHaveProperty("name", "AbortError")
    expect(state.instances[0]?.contextReleased).toBe(true)
    state.canvases[0]?.complete?.()
    state.holdEncoding = false
    await expect(renderPicture({ meshes: [mesh()], settings: {} })).resolves.toHaveProperty(
      "mimeType",
      "image/png",
    )
  })
  it("rejects changed revisions after encoding and cleans up after context loss", async () => {
    setup()
    let current = true
    state.duringRender = () => {
      current = false
    }
    await expect(
      renderPicture({ meshes: [mesh()], settings: {} }, { isCurrent: () => current }),
    ).rejects.toHaveProperty("code", "stale")
    expect(state.instances[0]?.contextReleased).toBe(true)
    state.duringRender = () =>
      state.canvases.at(-1)?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
    await expect(renderPicture({ meshes: [mesh()], settings: {} })).rejects.toHaveProperty(
      "code",
      "context-lost",
    )
    expect(state.instances[1]?.disposed).toBe(true)
  })
  it("reports actual sample counts for progressive quality and observes cancellation", async () => {
    setup()
    const samples: number[] = []
    await renderPicture(
      { meshes: [mesh()], settings: { quality: "standard" } },
      {
        onProgress: (value) => {
          if (value.samples !== undefined) samples.push(value.samples)
        },
      },
    )
    expect(samples).toEqual([12, 24])
    expect(state.compilationPolls).toBeGreaterThan(0)
    const abort = new AbortController()
    state.duringRender = () => abort.abort()
    await expect(
      renderPicture({ meshes: [mesh()], settings: { quality: "high" } }, { signal: abort.signal }),
    ).rejects.toHaveProperty("name", "AbortError")
    expect(state.instances.at(-1)?.contextReleased).toBe(true)
  })
  for (const cause of ["cancel", "context-lost", "timeout"] as const) {
    it(`drains pending compiler polling before disposal after ${cause} and allows immediate Draft`, async () => {
      setup()
      state.holdCompilation = true
      const started = new Promise<void>((resolve) => {
        state.compilationStarted = resolve
      })
      const abort = new AbortController()
      const originalTimeout = globalThis.setTimeout
      const shortenedDeadline = ((...args: Parameters<typeof setTimeout>) =>
        originalTimeout(
          args[0],
          args[1] === 120_000 ? 80 : args[1],
          ...args.slice(2),
        )) as typeof setTimeout
      const timeout =
        cause === "timeout"
          ? spyOn(globalThis, "setTimeout").mockImplementation(shortenedDeadline)
          : null
      try {
        const pending = renderPicture(
          { meshes: [mesh()], settings: { quality: "high" } },
          { signal: abort.signal },
        )
        // Attach the rejection observer before a shortened deadline can fire.
        const outcome = pending.then(
          () => null,
          (error: unknown) => error,
        )
        await started
        if (cause === "cancel") {
          abort.abort()
          abort.abort()
        }
        if (cause === "context-lost")
          state.canvases.at(-1)?.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
        expect(await outcome).toHaveProperty(
          cause === "cancel" ? "name" : "code",
          cause === "cancel" ? "AbortError" : cause,
        )
        expect(state.compilationPolls).toBeGreaterThan(0)
        expect(state.instances.at(-1)?.disposed).toBe(true)
        expect(state.instances.at(-1)?.contextReleased).toBe(true)
        state.holdCompilation = false
        await expect(renderPicture({ meshes: [mesh()], settings: {} })).resolves.toHaveProperty(
          "mimeType",
          "image/png",
        )
      } finally {
        timeout?.mockRestore()
      }
    })
  }
  it("rejects duplicate work and stale or pre-cancelled requests before allocating a context", async () => {
    setup()
    const abort = new AbortController()
    abort.abort()
    await expect(
      renderPicture({ meshes: [mesh()], settings: {} }, { signal: abort.signal }),
    ).rejects.toHaveProperty("name", "AbortError")
    await expect(
      renderPicture({ meshes: [mesh()], settings: {} }, { isCurrent: () => false }),
    ).rejects.toHaveProperty("code", "stale")
    expect(state.instances).toHaveLength(0)
    const first = renderPicture({ meshes: [mesh()], settings: {} })
    await expect(renderPicture({ meshes: [mesh()], settings: {} })).rejects.toHaveProperty(
      "code",
      "busy",
    )
    await first
  })
})
