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
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null)
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null)
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
              'circle[data-sketch-entity-type="point"], [data-sketch-coordinate-point-id]',
            )
          : null
      const pointId =
        target?.getAttribute("data-sketch-coordinate-point-id") ??
        target?.getAttribute("data-sketch-entity-id")
      if (pointId) {
        cancelClear()
        setHoveredPointId(pointId)
      } else if (clearTimer.current === null) {
        // Allow the pointer to cross the small gap from a point to its editable labels.
        clearTimer.current = setTimeout(() => {
          clearTimer.current = null
          setHoveredPointId(null)
        }, 150)
      }
    },
    [cancelClear],
  )
  const onPointerLeave = useCallback(() => {
    cancelClear()
    setHoveredPointId(null)
  }, [cancelClear])
  const onFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    setFocusedPointId(
      event.target
        .closest("[data-sketch-coordinate-point-id]")
        ?.getAttribute("data-sketch-coordinate-point-id") ?? null,
    )
  }, [])
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target =
      event.relatedTarget instanceof Element
        ? event.relatedTarget.closest("[data-sketch-coordinate-point-id]")
        : null
    setFocusedPointId(target?.getAttribute("data-sketch-coordinate-point-id") ?? null)
  }, [])
  const activePointIds = useMemo(
    () => [hoveredPointId, focusedPointId].filter((id): id is string => id !== null),
    [hoveredPointId, focusedPointId],
  )
  return {
    showAll,
    setShowAll,
    activePointIds,
    onPointerOver,
    onPointerLeave,
    onFocus,
    onBlur,
  }
}
