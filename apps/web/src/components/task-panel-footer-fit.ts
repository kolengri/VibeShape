import { type RefObject, useCallback, useLayoutEffect, useState } from "react"

/** The smallest field scrollport (4rem) a task window keeps beside a pinned footer. */
const minimumFieldScrollport = 64

type TaskPanelFooterFit = Readonly<{
  /** The footer follows the fields inside one scroller instead of staying pinned. */
  flow: boolean
  /** Flow layout with content below the visible area: show the scroll cue. */
  more: boolean
}>

/**
 * Pins the footer whenever the header, the minimum field scrollport and the footer fit the task
 * window. Otherwise the whole window scrolls as one region with the footer after the fields.
 * The decision depends only on the window, header and footer heights, so it is stable across
 * renders and measured before paint.
 */
export function useTaskPanelFooterFit(layout: RefObject<HTMLDivElement | null>) {
  const [fit, setFit] = useState<TaskPanelFooterFit>({ flow: false, more: false })
  const measure = useCallback(() => {
    const element = layout.current
    if (!element) return
    const header = element.querySelector<HTMLElement>(":scope > [data-slot='task-panel-header']")
    const footer = element.querySelector<HTMLElement>(":scope > [data-slot='task-panel-footer']")
    const chrome = (header?.offsetHeight ?? 0) + (footer?.offsetHeight ?? 0)
    const flow =
      footer !== null &&
      element.clientHeight > 0 &&
      chrome + minimumFieldScrollport > element.clientHeight + 0.5
    const more = flow && element.scrollTop + element.clientHeight < element.scrollHeight - 1
    setFit((current) => (current.flow === flow && current.more === more ? current : { flow, more }))
  }, [layout])
  useLayoutEffect(() => {
    measure()
    const element = layout.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [layout, measure])
  return { ...fit, onScroll: measure }
}
