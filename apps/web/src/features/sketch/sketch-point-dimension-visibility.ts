import {
  type FocusEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

export function useSketchPointDimensionVisibility() {
  const [showAll, setShowAll] = useState(false)
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClear = useCallback(() => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current)
    clearTimer.current = null
  }, [])
  useEffect(() => cancelClear, [cancelClear])
  const onPointerOver = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(
              "[data-sketch-entity-id], [data-sketch-coordinate-point-id], [data-sketch-constraint-id]",
            )
          : null
      const pointId =
        target?.getAttribute("data-sketch-coordinate-point-id") ??
        target?.getAttribute("data-sketch-entity-id")
      if (pointId) {
        cancelClear()
        setHoveredEntityId(pointId)
      } else if (target?.hasAttribute("data-sketch-constraint-id")) {
        cancelClear()
      } else if (clearTimer.current === null) {
        // Keep annotations reachable while the pointer crosses the gap from their geometry.
        clearTimer.current = setTimeout(() => {
          clearTimer.current = null
          setHoveredEntityId(null)
        }, 150)
      }
    },
    [cancelClear],
  )
  const onPointerLeave = useCallback(() => {
    cancelClear()
    setHoveredEntityId(null)
  }, [cancelClear])
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    setFocusedEntityId(
      event.target
        .closest("[data-sketch-coordinate-point-id], [data-sketch-entity-id]")
        ?.getAttribute("data-sketch-coordinate-point-id") ??
        event.target.closest("[data-sketch-entity-id]")?.getAttribute("data-sketch-entity-id") ??
        null,
    )
  }, [])
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target =
      event.relatedTarget instanceof Element
        ? event.relatedTarget.closest("[data-sketch-coordinate-point-id], [data-sketch-entity-id]")
        : null
    setFocusedEntityId(
      target?.getAttribute("data-sketch-coordinate-point-id") ??
        target?.getAttribute("data-sketch-entity-id") ??
        null,
    )
  }, [])
  const activeEntityIds = useMemo(
    () => [hoveredEntityId, focusedEntityId].filter((id): id is string => id !== null),
    [hoveredEntityId, focusedEntityId],
  )
  return {
    showAll,
    setShowAll,
    activeEntityIds,
    activePointIds: activeEntityIds,
    onPointerOver,
    onPointerLeave,
    onFocus,
    onBlur,
  }
}
