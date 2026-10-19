import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerSection,
  ViewerToolPlane,
} from "@vibeshape/viewer/three-viewport"
import { type RefObject, useCallback, useEffect, useRef } from "react"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewport | Promise<GeometryViewport>

export function useSectionViewportFactory(
  factory: ViewportFactory,
  section: ViewerSection | null,
  onChange?: (section: ViewerSection) => void,
  toolPlane?: ViewerToolPlane | null,
) {
  const current = useRef(section)
  current.current = section
  const change = useRef(onChange)
  change.current = onChange
  const plane = useRef(toolPlane)
  plane.current = toolPlane
  return useCallback(
    async (canvas: HTMLCanvasElement, options: GeometryViewportOptions) => {
      const viewport = await factory(canvas, {
        ...options,
        onSectionChange: (next) => {
          options.onSectionChange?.(next)
          change.current?.(next)
        },
      })
      viewport.setSection(current.current)
      viewport.setToolPlane(plane.current ?? null)
      return viewport
    },
    [factory],
  )
}

export function useSectionViewportSynchronization(
  viewport: RefObject<GeometryViewport | null>,
  section: ViewerSection | null,
) {
  useEffect(() => {
    viewport.current?.setSection(section)
  }, [section, viewport])
}
