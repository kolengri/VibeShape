import type {
  GeometryViewport,
  GeometryViewportOptions,
  ViewerSection,
} from "@vibeshape/viewer/three-viewport"
import { type RefObject, useCallback, useEffect, useRef } from "react"

type ViewportFactory = (
  canvas: HTMLCanvasElement,
  options: GeometryViewportOptions,
) => GeometryViewport | Promise<GeometryViewport>

export function useSectionViewportFactory(factory: ViewportFactory, section: ViewerSection | null) {
  const current = useRef(section)
  current.current = section
  return useCallback(
    async (canvas: HTMLCanvasElement, options: GeometryViewportOptions) => {
      const viewport = await factory(canvas, options)
      viewport.setSection(current.current)
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
