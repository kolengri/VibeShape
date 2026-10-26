import type { Virtualizer } from "@tanstack/react-virtual"
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { FolderHistoryGroup } from "./authored-tree-state"
import type { HistoryTrackGroup, HistoryTrackUnit } from "./history-virtual-layout"
import { historyRefKey } from "./model-tree-history"

type TrackFocusOptions = {
  track: RefObject<HTMLDivElement | null>
  units: readonly HistoryTrackUnit[]
  groups: readonly FolderHistoryGroup[]
  layout: readonly HistoryTrackGroup[]
  virtualized: boolean
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  revealRequest: Readonly<{ featureId: string; sequence: number }> | null | undefined
  selectedId: string | null | undefined
  focused: string | null
  setFocused: (key: string) => void
  onExpand: (folderId: string, expanded: boolean) => void
}
function findUnit(track: HTMLElement | null, key: string) {
  return [...(track?.querySelectorAll<HTMLElement>("[data-history-unit]") ?? [])].find(
    (element) => element.dataset.historyUnit === key,
  )
}
function linearDestination(key: string, index: number, count: number) {
  const destinations: Record<string, number> = {
    Home: 0,
    End: count - 1,
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index + count - 1) % count,
  }
  return destinations[key]
}
function hierarchyDestination(
  key: string,
  index: number,
  unit: HistoryTrackUnit,
  group: HistoryTrackGroup | undefined,
  onExpand: TrackFocusOptions["onExpand"],
) {
  if (!group?.folder) return undefined
  if (key === "ArrowDown" && !unit.row) {
    onExpand(group.folder.id, true)
    return Math.min(group.end, index + 1)
  }
  if (key !== "ArrowUp") return undefined
  if (!unit.row) onExpand(group.folder.id, false)
  return group.start
}
function usePendingHistoryFocus(options: TrackFocusOptions) {
  const [pending, setPending] = useState<Readonly<{ key: string; focus: boolean }> | null>(null)
  useLayoutEffect(() => {
    if (!pending) return
    const index = options.units.findIndex((unit) => unit.key === pending.key)
    if (index < 0) return
    if (options.virtualized) options.virtualizer.scrollToIndex(index, { align: "auto" })
    const frame = requestAnimationFrame(() => {
      const wrapper = findUnit(options.track.current, pending.key)
      const target = wrapper?.querySelector<HTMLElement>('[role="treeitem"]')
      if (!target) return
      if (!options.virtualized) target.scrollIntoView?.({ block: "nearest", inline: "nearest" })
      if (pending.focus) target.focus({ preventScroll: true })
      setPending(null)
    })
    return () => cancelAnimationFrame(frame)
  })
  return setPending
}
function useHistoryTrackReveal(
  options: TrackFocusOptions,
  request: ReturnType<typeof usePendingHistoryFocus>,
) {
  const revealedSelection = useRef<string | null>(null)
  const revealedRequest = useRef<number | null>(null)
  const { groups, track, virtualized, onExpand } = options
  const reveal = useCallback(
    (id: string, focus: boolean) => {
      const group = groups.find((group) => group.rows.some(({ row }) => row.ref.id === id))
      const row = group?.rows.find(({ row }) => row.ref.id === id)
      if (!row) return
      if (group?.folder) onExpand(group.folder.id, true)
      const key = historyRefKey(row.row.ref)
      const element = findUnit(track.current, key)
      if (!virtualized && element) {
        element
          .querySelector<HTMLElement>("[data-history-id]")
          ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
        if (focus) element.querySelector<HTMLElement>('[role="treeitem"]')?.focus()
      } else request({ key, focus })
    },
    [groups, onExpand, request, track, virtualized],
  )
  useEffect(() => {
    const revealRequest = options.revealRequest
    if (!revealRequest || revealedRequest.current === revealRequest.sequence) return
    revealedRequest.current = revealRequest.sequence
    reveal(revealRequest.featureId, true)
  }, [options.revealRequest, reveal])
  useEffect(() => {
    const selectedId = options.selectedId
    if (revealedSelection.current === selectedId) return
    revealedSelection.current = selectedId ?? null
    if (selectedId) reveal(selectedId, false)
  }, [options.selectedId, reveal])
}
export function useHistoryTrackFocus(options: TrackFocusOptions) {
  const { focused, setFocused } = options
  const request = usePendingHistoryFocus(options)
  useHistoryTrackReveal(options, request)
  useLayoutEffect(() => {
    const items = options.track.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
    const effectiveFocused = options.units.some((unit) => unit.key === focused) ? focused : null
    let assigned = false
    for (const item of items) {
      const key = item.closest<HTMLElement>("[data-history-unit]")?.dataset.historyUnit
      const active: boolean = effectiveFocused ? key === effectiveFocused : !assigned
      item.tabIndex = active ? 0 : -1
      assigned ||= active
    }
  })
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!options.virtualized || event.defaultPrevented) return
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
    const key = current?.closest<HTMLElement>("[data-history-unit]")?.dataset.historyUnit
    const index = options.units.findIndex((unit) => unit.key === key)
    const unit = options.units[index]
    if (!unit) return
    const destination =
      linearDestination(event.key, index, options.units.length) ??
      hierarchyDestination(event.key, index, unit, options.layout[unit.group], options.onExpand)
    if (destination === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const next = options.units[destination]
    if (!next) return
    setFocused(next.key)
    request({ key: next.key, focus: true })
  }
  return { focused, setFocused, moveFocus }
}
