import {
  PictureRenderError,
  type PictureRenderErrorCode,
  type PictureRenderProgress,
  type PictureRenderSettings,
  renderPicture,
} from "@vibeshape/viewer/picture-render"
import { useEffect, useRef, useState } from "react"
import { type PictureSource, useViewportCapture } from "../../shell/viewport-capture"

function sameSource(a: PictureSource | null, b: PictureSource | null) {
  return Boolean(
    a &&
      b &&
      a.documentId === b.documentId &&
      a.revision === b.revision &&
      a.meshes === b.meshes &&
      a.unsupported === b.unsupported,
  )
}

export function usePictureRender() {
  const port = useViewportCapture()
  const [source, setSource] = useState(() => port?.pictureSource() ?? null)
  const [progress, setProgress] = useState<PictureRenderProgress | null>(null)
  const [error, setError] = useState<PictureRenderErrorCode | "empty" | "failed" | null>(null)
  const [output, setOutput] = useState<{ url: string; width: number; height: number } | null>(null)
  const run = useRef<AbortController | null>(null)
  const accepted = useRef<PictureSource | null>(null)
  const url = useRef<string | null>(null)
  const clearOutput = () => {
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setOutput(null)
  }
  useEffect(() => {
    const update = () => {
      const current = port?.pictureSource() ?? null
      setSource(current)
      if (accepted.current && !sameSource(current, accepted.current)) {
        run.current?.abort(new PictureRenderError("stale", "The render source changed."))
        if (url.current) URL.revokeObjectURL(url.current)
        url.current = null
        setOutput(null)
        setError("stale")
        accepted.current = null
      }
    }
    update()
    const unsubscribe = port?.subscribePicture(update)
    return () => {
      unsubscribe?.()
      run.current?.abort()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [port])
  const renderSource = async (
    frozenSource: PictureSource,
    settings: PictureRenderSettings,
    abort: AbortController,
  ) => {
    try {
      const result = await renderPicture(
        {
          meshes: frozenSource.meshes,
          settings,
          ...(frozenSource.camera ? { camera: frozenSource.camera } : {}),
        },
        {
          signal: abort.signal,
          isCurrent: () => sameSource(frozenSource, port?.pictureSource() ?? null),
          onProgress: setProgress,
        },
      )
      if (abort.signal.aborted) return
      url.current = URL.createObjectURL(result.blob)
      setOutput({ url: url.current, width: result.width, height: result.height })
    } catch (failure) {
      if (failure instanceof PictureRenderError) setError(failure.code)
      else if (!abort.signal.aborted) setError("failed")
    }
  }
  const start = async (settings: PictureRenderSettings) => {
    if (run.current) return
    const frozenSource = port?.pictureSource() ?? null
    if (frozenSource?.unsupported) return
    if (!frozenSource?.meshes.length) {
      setError("empty")
      return
    }
    clearOutput()
    setError(null)
    const abort = new AbortController()
    run.current = abort
    accepted.current = frozenSource
    setProgress({ stage: "preparing" })
    try {
      await renderSource(frozenSource, settings, abort)
    } finally {
      if (run.current === abort) {
        run.current = null
        setProgress(null)
      }
    }
  }
  const sourceError = source?.unsupported ? (`unsupported-${source.unsupported}` as const) : error
  const canRender = Boolean(source?.meshes.length && !source.unsupported)
  return {
    source,
    progress,
    error: sourceError,
    canRender,
    output,
    start,
    clearOutput,
    cancel: () => run.current?.abort(),
  }
}
