import {
  ACESFilmicToneMapping,
  type Camera,
  PCFShadowMap,
  type Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three"
import type { ModelPreviewCamera } from "./model-preview"
import { trackPictureCompilation } from "./picture-render-compilation"
import {
  copyPictureRenderInput,
  createPictureCamera,
  PictureRenderError,
  type PictureRenderSettings,
  pictureRenderLimits,
  pictureRenderSettingsSchema,
} from "./picture-render-input"
import { createPictureScene } from "./picture-render-scene"
import type { ViewerMesh } from "./three-viewport"

export type { PictureRenderErrorCode, PictureRenderSettings } from "./picture-render-input"
export {
  PictureRenderError,
  pictureFinishes,
  pictureRenderLimits,
  pictureRenderSettingsSchema,
  pictureScenes,
  pictureSizes,
} from "./picture-render-input"
export type PictureRenderProgress = Readonly<{
  stage: "preparing" | "compiling" | "rendering" | "encoding"
  samples?: number
  targetSamples?: number
}>
export type PictureRenderResult = Readonly<{
  blob: Blob
  width: number
  height: number
  mimeType: "image/png"
}>
export type PictureRenderRequest = Readonly<{
  meshes: readonly ViewerMesh[]
  settings: unknown
  camera?: ModelPreviewCamera
}>
export type PictureRenderControl = Readonly<{
  signal?: AbortSignal
  /** The host owns project/revision/visibility authority; false invalidates all output. */
  isCurrent?: () => boolean
  onProgress?: (progress: PictureRenderProgress) => void
}>
let active = false

function yieldToBrowser(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, 16)
    signal.addEventListener("abort", abort, { once: true })
  })
}
function encode(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    canvas.toBlob((blob) => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) reject(signal.reason)
      else if (blob?.type !== "image/png")
        reject(new PictureRenderError("encoding", "PNG encoding failed."))
      else resolve(blob)
    }, "image/png")
  })
}

function pictureJobControl(control: PictureRenderControl) {
  const abort = new AbortController()
  const cancel = () => abort.abort(control.signal?.reason)
  control.signal?.addEventListener("abort", cancel, { once: true })
  const timeout = setTimeout(
    () =>
      abort.abort(
        new PictureRenderError(
          "timeout",
          "Picture rendering exceeded two minutes. Try Draft or a smaller size.",
        ),
      ),
    pictureRenderLimits.maxDurationMs,
  )
  const check = () => {
    abort.signal.throwIfAborted()
    if (control.isCurrent && !control.isCurrent())
      throw new PictureRenderError(
        "stale",
        "The project, revision or visible bodies changed. Render again.",
      )
  }
  return {
    signal: abort.signal,
    check,
    contextLost: (event: Event) => {
      event.preventDefault()
      abort.abort(
        new PictureRenderError(
          "context-lost",
          "The picture GPU context was lost. Try Draft or a smaller size.",
        ),
      )
    },
    dispose: () => {
      clearTimeout(timeout)
      control.signal?.removeEventListener("abort", cancel)
    },
  }
}

async function waitForPictureGpu(
  gl: WebGL2RenderingContext,
  job: ReturnType<typeof pictureJobControl>,
) {
  // Fence every tile; do not queue unbounded GPU work while compilation or a slow tile runs.
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!fence)
    throw new PictureRenderError("unavailable", "The GPU could not synchronize picture rendering.")
  gl.flush()
  try {
    let status = gl.clientWaitSync(fence, 0, 0)
    while (status === gl.TIMEOUT_EXPIRED) {
      await yieldToBrowser(job.signal)
      job.check()
      status = gl.clientWaitSync(fence, 0, 0)
    }
    if (status === gl.WAIT_FAILED)
      throw new PictureRenderError("context-lost", "The GPU stopped picture rendering.")
  } finally {
    gl.deleteSync(fence)
  }
}

async function renderProgressivePicture(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  settings: PictureRenderSettings,
  job: ReturnType<typeof pictureJobControl>,
  control: PictureRenderControl,
) {
  const { WebGLPathTracer } = await import("three-gpu-pathtracer")
  job.check()
  const tracer = new WebGLPathTracer(renderer)
  tracer.renderDelay = 0
  tracer.minSamples = 1
  tracer.fadeDuration = 0
  tracer.rasterizeScene = false
  tracer.bounces = 5
  tracer.tiles.set(4, 4)
  tracer.textureSize.set(256, 256)

  const drain = trackPictureCompilation(renderer)
  try {
    tracer.setScene(scene, camera)
    const target = settings.quality === "high" ? 64 : 24
    const gl = renderer.getContext() as WebGL2RenderingContext
    while (tracer.samples < target) {
      job.check()
      tracer.renderSample()
      control.onProgress?.(
        "isCompiling" in tracer && tracer.isCompiling
          ? { stage: "compiling" }
          : { stage: "rendering", samples: tracer.samples, targetSamples: target },
      )
      await waitForPictureGpu(gl, job)
      await yieldToBrowser(job.signal)
    }
  } finally {
    await drain()
    tracer.dispose()
  }
}

function disposePictureResources(
  renderer: WebGLRenderer | undefined,
  ownedScene: ReturnType<typeof createPictureScene> | undefined,
  canvas: HTMLCanvasElement | undefined,
) {
  try {
    ownedScene?.dispose()
  } finally {
    try {
      try {
        renderer?.dispose()
      } finally {
        renderer?.forceContextLoss()
      }
    } finally {
      if (canvas) {
        canvas.width = 1
        canvas.height = 1
      }
    }
  }
}

/** Read-only browser render. At most one private GPU context, bounded copied input and output. */
export async function renderPicture(
  request: PictureRenderRequest,
  control: PictureRenderControl = {},
): Promise<PictureRenderResult> {
  if (active) throw new PictureRenderError("busy", "Another picture is already rendering.")
  control.signal?.throwIfAborted()
  const parsed = pictureRenderSettingsSchema.safeParse(request.settings)
  if (!parsed.success)
    throw new PictureRenderError(
      "invalid-input",
      "Invalid picture settings or pixel budget exceeded.",
    )
  const settings = parsed.data
  const snapshot = copyPictureRenderInput(request.meshes)
  const camera = createPictureCamera(snapshot.bounds, settings, request.camera)
  active = true
  const job = pictureJobControl(control)
  const { check, contextLost } = job
  let renderer: WebGLRenderer | undefined
  let ownedScene: ReturnType<typeof createPictureScene> | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    check()
    control.onProgress?.({ stage: "preparing" })
    await yieldToBrowser(job.signal)
    check()
    canvas = document.createElement("canvas")
    canvas.addEventListener("webglcontextlost", contextLost)
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: settings.quality === "draft",
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      })
    } catch {
      throw new PictureRenderError(
        "unavailable",
        "WebGL2 is unavailable. Enable browser graphics acceleration and retry.",
      )
    }
    renderer.setPixelRatio(1)
    renderer.setSize(settings.width, settings.height, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.shadowMap.enabled = settings.quality === "draft"
    renderer.shadowMap.type = PCFShadowMap
    ownedScene = createPictureScene(snapshot, settings)
    check()
    if (settings.quality === "draft") {
      control.onProgress?.({ stage: "rendering" })
      renderer.render(ownedScene.scene, camera)
    } else {
      await renderProgressivePicture(renderer, ownedScene.scene, camera, settings, job, control)
    }
    check()
    control.onProgress?.({ stage: "encoding" })
    const blob = await encode(canvas, job.signal)
    check()
    if (blob.size > pictureRenderLimits.maxPngBytes)
      throw new PictureRenderError(
        "limit",
        "The PNG exceeds the 12 MiB output budget. Choose a smaller size.",
      )
    return { blob, width: settings.width, height: settings.height, mimeType: "image/png" }
  } finally {
    job.dispose()
    canvas?.removeEventListener("webglcontextlost", contextLost)
    try {
      disposePictureResources(renderer, ownedScene, canvas)
    } finally {
      active = false
    }
  }
}
