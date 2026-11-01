import "../../../../../tests/unit/support/dom"
import { afterEach, expect, it, mock } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import type {
  PictureRenderControl,
  PictureRenderRequest,
  PictureRenderResult,
} from "@vibeshape/viewer/picture-render"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { useViewportCapture, ViewportCaptureProvider } from "../../shell/viewport-capture"

const actual = { ...(await import("@vibeshape/viewer/picture-render")) }
const render =
  vi.fn<
    (request: PictureRenderRequest, control: PictureRenderControl) => Promise<PictureRenderResult>
  >()
mock.module("@vibeshape/viewer/picture-render", () => ({ ...actual, renderPicture: render }))
const { usePictureRender } = await import("./use-picture-render")
const mesh = {
  featureId: "body",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]),
  normals: new Float32Array(9),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}
const settings = actual.pictureRenderSettingsSchema.parse({})
afterEach(() => {
  cleanup()
  render.mockReset()
  vi.unstubAllGlobals()
})
function setup() {
  const urls = { createObjectURL: vi.fn(() => "blob:picture"), revokeObjectURL: vi.fn() }
  vi.stubGlobal("URL", urls)
  const hook = renderHook(() => ({ port: useViewportCapture(), view: usePictureRender() }), {
    wrapper: ViewportCaptureProvider,
  })
  const source = { documentId: "one", revision: 4, meshes: [mesh] }
  let remove: (() => void) | undefined
  act(() => {
    remove = hook.result.current.port?.registerPicture(() => source)
  })
  return { ...hook, urls, source, remove: () => remove?.() }
}
it.each(["relief", "assembly"] as const)(
  "rejects unsupported %s before invoking the renderer",
  async (unsupported) => {
    const f = setup()
    act(() => {
      f.remove()
      f.result.current.port?.registerPicture(() => ({ ...f.source, unsupported }))
    })
    expect(f.result.current.view.error).toBe(`unsupported-${unsupported}`)
    await act(async () => {
      await f.result.current.view.start(settings)
    })
    expect(render).not.toHaveBeenCalled()
    expect(f.result.current.view.progress).toBeNull()
    expect(f.result.current.view.output).toBeNull()
    expect(f.urls.createObjectURL).not.toHaveBeenCalled()
  },
)
it("revokes a completed picture and exposes stale state when its source project is replaced", async () => {
  render.mockResolvedValue({
    blob: new Blob(["png"], { type: "image/png" }),
    mimeType: "image/png",
    width: 1080,
    height: 1080,
  })
  const f = setup()
  await act(async () => {
    await f.result.current.view.start(settings)
  })
  expect(f.result.current.view.output?.url).toBe("blob:picture")
  act(() => {
    f.remove()
    f.result.current.port?.registerPicture(() => ({ ...f.source, documentId: "two" }))
  })
  expect(f.result.current.view.output).toBeNull()
  expect(f.result.current.view.error).toBe("stale")
  expect(f.urls.revokeObjectURL).toHaveBeenCalledWith("blob:picture")
})
it("prevents duplicate jobs, forwards source authority and cancellation, then releases pending state", async () => {
  render.mockImplementation(
    (_request, control) =>
      new Promise((_resolve, reject) => {
        control.signal?.addEventListener("abort", () => reject(control.signal?.reason), {
          once: true,
        })
      }),
  )
  const f = setup()
  let pending: Promise<void> | undefined
  act(() => {
    pending = f.result.current.view.start(settings)
  })
  expect(f.result.current.view.progress?.stage).toBe("preparing")
  await act(async () => {
    await f.result.current.view.start(settings)
  })
  expect(render).toHaveBeenCalledTimes(1)
  const control = render.mock.calls[0]?.[1]
  expect(control?.isCurrent?.()).toBe(true)
  act(() => f.result.current.view.cancel())
  await act(async () => {
    await pending
  })
  expect(f.result.current.view.progress).toBeNull()
  expect(f.result.current.view.error).toBeNull()
  expect(control?.signal?.aborted).toBe(true)
})
it("aborts a pending job on unmount without accepting or retaining an output URL", async () => {
  render.mockImplementation(
    (_request, control) =>
      new Promise((_resolve, reject) => {
        control.signal?.addEventListener("abort", () => reject(control.signal?.reason), {
          once: true,
        })
      }),
  )
  const f = setup()
  let pending: Promise<void> | undefined
  act(() => {
    pending = f.result.current.view.start(settings)
  })
  f.unmount()
  await pending
  expect(render.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  expect(f.urls.createObjectURL).not.toHaveBeenCalled()
})
