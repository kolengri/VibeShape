import { Box3, Mesh, type OrthographicCamera, type Scene, Vector3 } from "three"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type ModelPreviewCamera, renderModelPreview } from "./model-preview"
import type { ViewerMesh, ViewerStandardView } from "./three-viewport"

const rendererState = vi.hoisted(() => ({
  draws: [] as { camera: unknown; positions: number[][]; indexLengths: number[] }[],
  instances: [] as {
    dispose: ReturnType<typeof vi.fn>
    forceContextLoss: ReturnType<typeof vi.fn>
  }[],
  loseDuringRender: false,
  canvas: null as HTMLCanvasElement | null,
  previousDisposed: [] as boolean[],
}))

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    domElement: HTMLCanvasElement
    dispose = vi.fn()
    forceContextLoss = vi.fn()
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      this.domElement = canvas
      rendererState.canvas = canvas
      rendererState.previousDisposed.push(
        rendererState.instances.at(-1)?.dispose.mock.calls.length !== 0,
      )
      rendererState.instances.push(this)
    }
    setPixelRatio() {}
    setClearColor() {}
    setSize(width: number, height: number) {
      this.domElement.width = width
      this.domElement.height = height
    }
    render(scene: Scene, camera: OrthographicCamera) {
      const surfaces = scene.children.filter((child): child is Mesh => child instanceof Mesh)
      rendererState.draws.push({
        camera,
        positions: surfaces.map((surface) =>
          Array.from(surface.geometry.getAttribute("position").array),
        ),
        indexLengths: surfaces.map((surface) => surface.geometry.index?.count ?? 0),
      })
      if (rendererState.loseDuringRender) {
        rendererState.loseDuringRender = false
        this.domElement.dispatchEvent(new Event("webglcontextlost"))
      }
    }
  },
}))

const triangle: ViewerMesh = {
  featureId: "test-body",
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 12, 8]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}

function browserStub(sizes = [1_000], webglAvailable = true) {
  const labels: string[] = []
  const encodedWidths: number[] = []
  const context = {
    fillRect: vi.fn(),
    fillText: (text: string) => labels.push(text),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  }
  let encodingCount = 0
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = Object.assign(new EventTarget(), {
        width: 0,
        height: 0,
        getContext: (kind: string) =>
          kind === "2d"
            ? context
            : webglAvailable
              ? { isContextLost: () => false, getExtension: () => null }
              : null,
        toBlob: (callback: BlobCallback) => {
          encodedWidths.push(canvas.width)
          const size = sizes[Math.min(encodingCount++, sizes.length - 1)] ?? 1_000
          queueMicrotask(() => callback(new Blob([new Uint8Array(size)], { type: "image/png" })))
        },
      })
      return canvas
    },
  })
  return { labels, encodedWidths }
}

beforeEach(() => {
  rendererState.draws.length = 0
  rendererState.instances.length = 0
  rendererState.loseDuringRender = false
  rendererState.previousDisposed.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("model preview", () => {
  it("rejects empty, malformed, non-finite, missing-vertex, and degenerate mesh inputs", async () => {
    await expect(renderModelPreview([])).rejects.toThrow("no meshes")
    await expect(
      renderModelPreview([{ ...triangle, normals: new Float32Array(0) }]),
    ).rejects.toThrow("malformed triangle buffers")
    await expect(
      renderModelPreview([
        { ...triangle, positions: new Float32Array([0, 0, NaN, 20, 0, 0, 0, 12, 8]) },
      ]),
    ).rejects.toThrow("must be finite")
    await expect(
      renderModelPreview([{ ...triangle, indices: new Uint32Array([0, 1, 3]) }]),
    ).rejects.toThrow("missing vertex")
    await expect(
      renderModelPreview([
        { ...triangle, positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]) },
      ]),
    ).rejects.toThrow("non-degenerate surface")
  })

  it("rejects invalid view lists and reports missing browser or WebGL2 support", async () => {
    for (const views of [
      [],
      ["top", "top"],
      ["unknown"],
      ["top", "front", "back", "left", "right"],
    ]) {
      await expect(
        renderModelPreview([triangle], { views: views as ViewerStandardView[] }),
      ).rejects.toThrow("one to four unique standard views")
    }
    await expect(renderModelPreview([triangle])).rejects.toThrow("a browser with WebGL2")
    browserStub([1_000], false)
    await expect(renderModelPreview([triangle])).rejects.toThrow("WebGL2 is unavailable")
  })

  it("renders four labeled views, retains every triangle, and releases owned resources", async () => {
    const { labels } = browserStub()
    const indices = new Uint32Array(3_000)
    for (let index = 0; index < indices.length; index++) indices[index] = index % 3
    const mesh = { ...triangle, indices, triangleFaceIds: new Uint32Array(1_000) }
    const geometryDisposed = vi.fn()
    const materialDisposed = vi.fn()
    const disposeGeometry = vi.spyOn((await import("three")).BufferGeometry.prototype, "dispose")
    const disposeMaterial = vi.spyOn(
      (await import("three")).MeshStandardMaterial.prototype,
      "dispose",
    )
    disposeGeometry.mockImplementation(geometryDisposed)
    disposeMaterial.mockImplementation(materialDisposed)
    const result = await renderModelPreview([mesh])
    expect(result).toMatchObject({
      mimeType: "image/png",
      width: 1_024,
      height: 768,
      views: ["isometric", "front", "right", "top"],
    })
    expect(atob(result.base64).length).toBe(1_000)
    expect(labels).toEqual(
      expect.arrayContaining(["Isometric", "Front", "Right", "Top", "Y⊗", "Z⊙"]),
    )
    expect(rendererState.draws).toHaveLength(4)
    for (const draw of rendererState.draws) expect(draw.indexLengths).toEqual([3_000])
    expect(geometryDisposed).toHaveBeenCalledOnce()
    expect(materialDisposed).toHaveBeenCalledOnce()
    const renderer = rendererState.instances[0]
    expect(renderer?.dispose).toHaveBeenCalledOnce()
    expect(renderer?.forceContextLoss).toHaveBeenCalledOnce()
    expect(mesh.indices).toEqual(indices)
    disposeGeometry.mockRestore()
    disposeMaterial.mockRestore()
  })

  it("copies complete geometry before queuing and fits flat elongated translated models", async () => {
    browserStub()
    const positions = new Float32Array([
      10_000, 20_000, 30_000, 12_000, 20_000, 30_000, 10_000, 20_001, 30_000,
    ])
    const request = renderModelPreview([{ ...triangle, positions }], { views: ["top"] })
    positions.fill(0)
    await request
    expect(rendererState.draws).toHaveLength(1)
    const rendered = rendererState.draws[0]?.positions[0] ?? []
    expect(rendered).toEqual(
      Array.from(new Float32Array([-0.5, -0.00025, 0, 0.5, -0.00025, 0, -0.5, 0.00025, 0])),
    )
    const camera = rendererState.draws[0]?.camera as OrthographicCamera
    const bounds = new Box3(new Vector3(-0.5, -0.00025, 0), new Vector3(0.5, 0.00025, 0))
    for (const point of [bounds.min, bounds.max]) {
      const projected = point.clone().project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(1)
      expect(Math.abs(projected.y)).toBeLessThan(1)
      expect(Math.abs(projected.z)).toBeLessThan(1)
    }
    expect(camera.position.toArray()).toEqual([0, 0, 4])
  })

  it("reduces image resolution deterministically without reducing geometry", async () => {
    const { encodedWidths } = browserStub([100_000, 95_000, 80_000])
    const result = await renderModelPreview([triangle], { views: ["front", "top"] })
    expect(encodedWidths).toEqual([1_024, 768, 576])
    expect(result).toMatchObject({ width: 576, height: 216, views: ["front", "top"] })
    expect(atob(result.base64).length).toBe(80_000)
    expect(rendererState.draws).toHaveLength(6)
  })

  it("fails at the image bound and still releases the context and queue", async () => {
    const { encodedWidths } = browserStub([100_000])
    await expect(renderModelPreview([triangle])).rejects.toThrow("88 KiB image limit")
    expect(encodedWidths).toEqual([1_024, 768, 576, 432, 384])
    expect(rendererState.instances[0]?.dispose).toHaveBeenCalledOnce()
    expect(rendererState.instances[0]?.forceContextLoss).toHaveBeenCalledOnce()
    browserStub()
    await expect(renderModelPreview([triangle])).resolves.toMatchObject({ mimeType: "image/png" })
  })

  it("contains context loss and serializes overlapping calls", async () => {
    browserStub()
    rendererState.loseDuringRender = true
    const first = renderModelPreview([triangle])
    const second = renderModelPreview([triangle], { views: ["bottom"] })
    await expect(first).rejects.toThrow("context was lost")
    await expect(second).resolves.toMatchObject({ views: ["bottom"] })
    expect(rendererState.instances).toHaveLength(2)
    expect(rendererState.previousDisposed).toEqual([true, true])
    for (const renderer of rendererState.instances) {
      expect(renderer.dispose).toHaveBeenCalledOnce()
      expect(renderer.forceContextLoss).toHaveBeenCalledOnce()
    }
  })

  it("rejects ambiguous, malformed, unbounded, and degenerate custom cameras", async () => {
    const camera: ModelPreviewCamera = { position: [0, 0, 50], target: [0, 0, 0] }
    await expect(renderModelPreview([triangle], { views: ["top"], camera })).rejects.toThrow(
      "mutually exclusive",
    )
    const invalid: ModelPreviewCamera[] = [
      { ...camera, position: [0, 0, 0] },
      { ...camera, target: [Infinity, 0, 0] },
      { ...camera, position: [1_000_001, 0, 50] },
      { ...camera, up: [0, 0, 0] },
      { ...camera, up: [0, 0, 1] },
      { ...camera, up: [0.000001, 0, 1] },
      { ...camera, viewHeightMm: 0 },
      { ...camera, viewHeightMm: 1_000_001 },
    ]
    for (const input of invalid) {
      await expect(renderModelPreview([triangle], { camera: input })).rejects.toThrow(
        "Cannot render model preview:",
      )
    }
  })

  it("transforms translated custom targets and explicit zoom into the normalized scene", async () => {
    const { labels } = browserStub()
    const camera: ModelPreviewCamera = {
      position: [18, 10, 50],
      target: [18, 10, 8],
      viewHeightMm: 2,
    }
    const first = await renderModelPreview([triangle], { camera })
    const shiftedPositions = triangle.positions.map(
      (value, index) => value + ([1_000, 2_000, 3_000][index % 3] ?? 0),
    )
    await renderModelPreview([{ ...triangle, positions: shiftedPositions }], {
      camera: { position: [1_018, 2_010, 3_050], target: [1_018, 2_010, 3_008], viewHeightMm: 2 },
    })
    expect(first).toMatchObject({ width: 1_024, height: 768, views: ["custom"] })
    expect(labels).toContain("Custom")
    const original = rendererState.draws[0]?.camera as OrthographicCamera
    const translated = rendererState.draws[1]?.camera as OrthographicCamera
    expect(translated.position.toArray()).toEqual(original.position.toArray())
    expect(translated.projectionMatrix.toArray()).toEqual(original.projectionMatrix.toArray())
    expect(rendererState.draws[1]?.positions).toEqual(rendererState.draws[0]?.positions)
    expect(original.top - original.bottom).toBeCloseTo(0.1)
    expect(original.up.toArray()).toEqual([0, 1, 0])
    const target = new Vector3(0.4, 0.2, 0.2).project(original)
    expect(target.x).toBeCloseTo(0)
    expect(target.y).toBeCloseTo(0)
  })

  it("auto-fits all triangles with positive clipping when the requested camera faces away from the scene", async () => {
    browserStub()
    await renderModelPreview([triangle], {
      camera: { position: [0, 0, -99], target: [0, 0, -100] },
    })
    const draw = rendererState.draws[0]
    const camera = draw?.camera as OrthographicCamera
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.far).toBeGreaterThan(camera.near)
    const positions = draw?.positions[0] ?? []
    for (let index = 0; index < positions.length; index += 3) {
      const vertex = new Vector3().fromArray(positions, index).project(camera)
      expect(Math.abs(vertex.x)).toBeLessThan(1)
      expect(Math.abs(vertex.y)).toBeLessThan(1)
      expect(Math.abs(vertex.z)).toBeLessThan(1)
    }
  })
})
