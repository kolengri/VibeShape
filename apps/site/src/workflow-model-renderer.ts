import type { GeometryViewport, ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { type RefObject, useEffect, useRef, useState } from "react"

export type WorkflowModelState = "loading" | "ready" | "unavailable"

type RendererOptions = {
  canvas: HTMLCanvasElement
  host: HTMLDivElement
  viewport: RefObject<GeometryViewport | null>
  onState: (state: WorkflowModelState) => void
}

class WorkflowModelRenderer {
  readonly #options: RendererOptions
  readonly #controller = new AbortController()
  readonly #observer: IntersectionObserver
  #disposed = false
  #started = false

  constructor(options: RendererOptions) {
    this.#options = options
    options.onState("loading")
    this.#observer = new IntersectionObserver(this.#onIntersection)
    this.#observer.observe(options.host)
  }

  #onIntersection = (entries: IntersectionObserverEntry[]) => {
    if (this.#disposed || this.#started || !entries.some((entry) => entry.isIntersecting)) return
    this.#started = true
    this.#observer.disconnect()
    void this.#initialize()
  }

  async #initialize() {
    try {
      const [{ createGeometryViewport }, mesh] = await Promise.all([
        import("@vibeshape/viewer/three-viewport"),
        import("./demo-mesh").then(({ loadDemoMesh }) => loadDemoMesh(this.#controller.signal)),
      ])
      if (this.#disposed) return
      const viewport = createGeometryViewport(this.#options.canvas)
      this.#options.viewport.current = viewport
      this.#configure(viewport, mesh)
      this.#options.onState("ready")
    } catch {
      if (this.#disposed) return
      this.#controller.abort()
      this.#releaseViewport()
      this.#options.onState("unavailable")
    }
  }

  #configure(viewport: GeometryViewport, mesh: ViewerMesh) {
    viewport.setInteractionMode("camera-only")
    viewport.setPointerOrbit(false)
    viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
    viewport.setGroundGrid(true)
    viewport.setMeshes([mesh])
    viewport.setStandardView("isometric")
    viewport.fit()
    const canvas = this.#options.canvas
    canvas.style.touchAction = document.activeElement === canvas ? "none" : "pan-y"
  }

  #releaseViewport() {
    this.#options.viewport.current?.dispose()
    this.#options.viewport.current = null
  }

  dispose() {
    this.#disposed = true
    this.#observer.disconnect()
    this.#controller.abort()
    this.#releaseViewport()
  }
}

export function useWorkflowModelRenderer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<GeometryViewport | null>(null)
  const [state, setState] = useState<WorkflowModelState>("loading")
  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    const renderer = new WorkflowModelRenderer({
      canvas,
      host,
      viewport: viewportRef,
      onState: setState,
    })
    return () => renderer.dispose()
  }, [])
  return { canvasRef, hostRef, viewportRef, state }
}
