import { useBlockingActivity } from "@vibeshape/ui/components/activity"
import type { GeometryViewport } from "@vibeshape/viewer/three-viewport"
import { type RefObject, useLayoutEffect } from "react"

/** Modal input containment also ends gestures that captured a pointer before the modal opened. */
export function useBlockingViewport(
  viewport: RefObject<Pick<GeometryViewport, "cancelInteractions"> | null>,
) {
  const blocking = useBlockingActivity() !== null
  useLayoutEffect(() => {
    if (blocking) viewport.current?.cancelInteractions()
  }, [blocking, viewport])
}
