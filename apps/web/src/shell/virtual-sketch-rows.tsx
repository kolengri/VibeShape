import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useModelBrowserTreeVisible } from "./model-browser-search"
import { type HistoryViewRow, historyRefKey } from "./model-tree-history"
import { useVirtualInteractionPin } from "./use-virtual-interaction-pin"

export function VirtualSketchRows({
  rows,
  selectedId,
  renderRow,
}: {
  rows: readonly HistoryViewRow[]
  selectedId: string | null | undefined
  renderRow: (row: HistoryViewRow) => ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  const [margin, setMargin] = useState(0)
  const visible = useModelBrowserTreeVisible()
  const [focused, setFocused] = useState(-1)
  const [interacted, setInteracted] = useVirtualInteractionPin()
  const [pending, setPending] = useState<number | null>(null)
  const previousSelection = useRef<string | null | undefined>(null)
  const virtualized = rows.length > 80
  const virtualizer = useVirtualizer({
    count: rows.length,
    useAnimationFrameWithResizeObserver: true,
    getScrollElement: () =>
      list.current?.closest<HTMLElement>('[data-slot="model-tree-content"]') ?? null,
    getItemKey: (index) => (rows[index] ? historyRefKey(rows[index].ref) : index),
    estimateSize: () => 28,
    overscan: 6,
    scrollMargin: margin,
    enabled: virtualized && visible,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...[focused, rows.findIndex((row) => historyRefKey(row.ref) === interacted)].filter(
            (index) => index >= 0 && index < rows.length,
          ),
        ]),
      ].sort((a, b) => a - b),
  })
  useLayoutEffect(() => {
    const element = list.current
    const parent = virtualizer.scrollElement
    if (!element || !parent || !visible) return
    const measure = () => {
      const offset =
        element.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop -
        parent.clientTop
      setMargin((previous) => (Math.abs(offset - previous) > 0.5 ? offset : previous))
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    const tree = element.closest('[role="tree"]')
    if (tree) for (const child of tree.children) observer.observe(child)
    observer.observe(parent)
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [virtualizer, virtualized, visible])
  useEffect(() => {
    if (!selectedId || !visible) {
      previousSelection.current = null
      return
    }
    if (!virtualized || previousSelection.current === selectedId) return
    const index = rows.findIndex((row) => row.ref.id === selectedId)
    if (index < 0) return
    const frame = requestAnimationFrame(() => {
      if (!list.current?.getClientRects().length) return
      virtualizer.scrollToIndex(index, { align: "auto" })
      previousSelection.current = selectedId
    })
    return () => cancelAnimationFrame(frame)
  }, [rows, selectedId, virtualized, virtualizer, visible, margin])
  useLayoutEffect(() => {
    const element = list.current
    if (!element || !virtualized) return
    const focus = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const index = event.detail === "last" ? rows.length - 1 : 0
      setFocused(index)
      setPending(index)
      virtualizer.scrollToIndex(index, { align: "auto" })
    }
    element.addEventListener("virtual-tree-focus", focus)
    return () => element.removeEventListener("virtual-tree-focus", focus)
  }, [rows.length, virtualized, virtualizer])
  useLayoutEffect(() => {
    if (pending === null) return
    virtualizer.scrollToIndex(pending, { align: "auto" })
    const frame = requestAnimationFrame(() => {
      const item = list.current?.querySelector<HTMLElement>(
        `[data-virtual-tree-index="${pending}"] [role="treeitem"]`,
      )
      if (item) {
        item.focus({ preventScroll: true })
        setPending(null)
      }
    })
    return () => cancelAnimationFrame(frame)
  })
  if (!virtualized) return rows.map(renderRow)
  return (
    <div
      ref={list}
      role="none"
      data-virtual-sketch-list
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
      onPointerDownCapture={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>("[data-virtual-tree-key]")
          ?.dataset.virtualTreeKey
        if (key) setInteracted(key)
      }}
      onFocusCapture={(event) => {
        const raw = (event.target as HTMLElement).closest<HTMLElement>("[data-virtual-tree-index]")
          ?.dataset.virtualTreeIndex
        if (raw !== undefined) setFocused(Number(raw))
      }}
      onKeyDownCapture={(event) => {
        if (event.defaultPrevented || !["ArrowDown", "ArrowUp"].includes(event.key)) return
        if (!(event.target as HTMLElement).closest('[role="treeitem"]')) return
        const raw = (event.target as HTMLElement).closest<HTMLElement>("[data-virtual-tree-index]")
          ?.dataset.virtualTreeIndex
        if (raw === undefined) return
        const index = Number(raw) + (event.key === "ArrowDown" ? 1 : -1)
        if (index < 0 || index >= rows.length) return
        event.preventDefault()
        event.stopPropagation()
        setFocused(index)
        setPending(index)
      }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        return row ? (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            data-virtual-tree-index={item.index}
            data-virtual-tree-key={historyRefKey(row.ref)}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start - margin}px)` }}
          >
            {renderRow(row)}
          </div>
        ) : null
      })}
    </div>
  )
}
