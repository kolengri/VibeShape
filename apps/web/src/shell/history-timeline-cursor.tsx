import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import { useTranslations } from "@vibeshape/i18n"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useHistoryNavigation } from "./history-navigation"

type Segment = { first: number; last: number; left: number; right: number }
type Anchor = { position: number; x: number }
type Layout = { anchors: Anchor[]; segments: Segment[]; settling: boolean }
type Drag = {
  element: HTMLHRElement
  pointerId: number
  contextKey: string
  startX: number
  clientX: number
  target: number
  moved: boolean
}

function historyIndex(raw: string | undefined, total: number) {
  if (raw === undefined || !raw.trim()) return null
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 && index < total ? index : null
}
function refKey(item: HistoryItemRef | undefined) {
  return item ? `${item.kind}:${item.id}` : undefined
}
function rowRange(element: HTMLElement, items: readonly HistoryItemRef[]) {
  const index = historyIndex(element.dataset.historyIndex, items.length)
  if (index === null || element.closest('[data-history-expanded="false"]')) return null
  const item = items[index]
  if (!item) return null
  return item.kind === element.dataset.historyKind && item.id === element.dataset.historyId
    ? { first: index, last: index }
    : null
}
function folderRange(element: HTMLElement, items: readonly HistoryItemRef[]) {
  const first = historyIndex(element.dataset.historyRangeStart, items.length)
  const last = historyIndex(element.dataset.historyRangeEnd, items.length)
  if (first === null || last === null || first > last) return null
  if (
    element.dataset.historyRangeFirst !== refKey(items[first]) ||
    element.dataset.historyRangeLast !== refKey(items[last])
  )
    return null
  return { first, last }
}
function readSegments(track: HTMLElement, items: readonly HistoryItemRef[]) {
  const origin = track.getBoundingClientRect().left + track.clientLeft - track.scrollLeft
  const elements = track.querySelectorAll<HTMLElement>(
    '[data-history-index], [data-history-expanded="false"][data-history-range-start]',
  )
  const segments: Segment[] = []
  for (const element of elements) {
    const range = element.hasAttribute("data-history-index")
      ? rowRange(element, items)
      : folderRange(element, items)
    const rect = element.getBoundingClientRect()
    if (range && rect.width > 0 && rect.height > 0)
      segments.push({ ...range, left: rect.left - origin, right: rect.right - origin })
  }
  return segments.sort((a, b) => a.first - b.first)
}
function completeAnchors(anchors: Anchor[], total: number) {
  if (!anchors.length) return [{ position: 0, x: 8 }]
  const first = anchors[0]
  if (first && first.position !== 0) anchors.unshift({ position: 0, x: first.x })
  const end = anchors.at(-1)
  if (end && end.position !== total) anchors.push({ position: total, x: end.x })
  return anchors
}
function readLayout(track: HTMLElement, items: readonly HistoryItemRef[]): Layout {
  const segments = readSegments(track, items)
  const anchors: Anchor[] = []
  let last = -1
  for (const segment of segments) {
    // Reorder transforms and overlapping metadata cannot become a different History target.
    if (segment.first <= last) return { anchors: [], segments: [], settling: false }
    const previous = anchors.at(-1)
    if (previous?.position === segment.first) previous.x = (previous.x + segment.left) / 2
    else anchors.push({ position: segment.first, x: segment.left })
    anchors.push({ position: segment.last + 1, x: segment.right })
    last = segment.last
  }
  return { anchors: completeAnchors(anchors, items.length), segments, settling: false }
}
function markerPosition(layout: Layout, position: number) {
  const exact = layout.anchors.find((anchor) => anchor.position === position)
  if (exact) return exact.x
  const containing = layout.segments.find(
    (segment) => segment.first < position && segment.last >= position,
  )
  if (containing)
    return position - containing.first <= containing.last + 1 - position
      ? containing.left
      : containing.right
  return (
    layout.anchors.reduce<Anchor | null>(
      (nearest, anchor) =>
        !nearest || Math.abs(anchor.position - position) < Math.abs(nearest.position - position)
          ? anchor
          : nearest,
      null,
    )?.x ?? 8
  )
}
function pointerPosition(track: HTMLElement, layout: Layout, clientX: number) {
  const x = clientX - track.getBoundingClientRect().left - track.clientLeft + track.scrollLeft
  return (
    layout.anchors.reduce<Anchor | null>(
      (nearest, anchor) =>
        !nearest || Math.abs(anchor.x - x) < Math.abs(nearest.x - x) ? anchor : nearest,
      null,
    )?.position ?? null
  )
}

function useCursorLayout(items: readonly HistoryItemRef[]) {
  const handle = useRef<HTMLHRElement>(null)
  const [layout, setLayout] = useState<Layout>({ anchors: [], segments: [], settling: false })
  useLayoutEffect(() => {
    const track = handle.current?.parentElement
    if (!track?.hasAttribute("data-history-track")) return
    let scheduled: number | null = null
    let disposed = false
    const watched = new Set<Animation>()
    const resize = new ResizeObserver(() => schedule())
    const measure = () => {
      scheduled = null
      const active = [
        ...track.querySelectorAll<HTMLElement>("[data-history-index], [data-history-range-start]"),
      ]
        .flatMap((element) => element.getAnimations?.() ?? [])
        .filter(
          (animation) =>
            animation.playState === "running" &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
      if (active.length) {
        setLayout((previous) => (previous.settling ? previous : { ...previous, settling: true }))
        for (const animation of active) {
          if (watched.has(animation)) continue
          watched.add(animation)
          void animation.finished
            .catch(() => {})
            .then(() => {
              watched.delete(animation)
              if (!disposed) schedule()
            })
        }
        return
      }
      setLayout(readLayout(track, items))
    }
    const observe = () => {
      resize.disconnect()
      resize.observe(track)
      for (const element of track.querySelectorAll<HTMLElement>(
        "[data-history-index], [data-history-range-start]",
      ))
        resize.observe(element)
    }
    const schedule = () => {
      if (scheduled === null) scheduled = requestAnimationFrame(measure)
    }
    const mutations = new MutationObserver((records) => {
      if (
        !records.some(
          (record) =>
            record.type === "childList" ||
            record.target === track ||
            (record.target instanceof HTMLElement &&
              record.target.matches("[data-history-index], [data-history-range-start]")),
        )
      )
        return
      observe()
      schedule()
    })
    mutations.observe(track, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-history-index",
        "data-history-range-start",
        "data-history-range-end",
        "data-history-expanded",
        "hidden",
        "style",
        "class",
      ],
    })
    observe()
    measure()
    const events = [
      "transitionrun",
      "transitionend",
      "transitioncancel",
      "animationstart",
      "animationend",
      "animationcancel",
    ]
    for (const event of events) track.addEventListener(event, schedule, true)
    return () => {
      disposed = true
      resize.disconnect()
      mutations.disconnect()
      for (const event of events) track.removeEventListener(event, schedule, true)
      if (scheduled !== null) cancelAnimationFrame(scheduled)
    }
  }, [items])
  return { handle, layout }
}
function edgeScrollDelta(track: HTMLElement, clientX: number) {
  const rect = track.getBoundingClientRect()
  if (clientX < rect.left + 32) return -Math.min(16, Math.ceil((rect.left + 32 - clientX) / 3))
  if (clientX > rect.right - 32) return Math.min(16, Math.ceil((clientX - rect.right + 32) / 3))
  return 0
}
function revealMarker(track: HTMLElement, x: number) {
  if (x < track.scrollLeft + 8) track.scrollLeft = Math.max(0, x - 8)
  else if (x > track.scrollLeft + track.clientWidth - 8)
    track.scrollLeft = Math.max(0, x - track.clientWidth + 8)
}

function useCursorGestures(
  navigation: ReturnType<typeof useHistoryNavigation>,
  layout: Layout,
  handle: RefObject<HTMLHRElement | null>,
) {
  const disabled = navigation.disabled || layout.settling
  const drag = useRef<Drag | null>(null)
  const edgeFrame = useRef<number | null>(null)
  const stopEdgeScroll = useCallback(() => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current)
    edgeFrame.current = null
  }, [])
  const release = useCallback(() => {
    const current = drag.current
    drag.current = null
    stopEdgeScroll()
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId)
    return current
  }, [handle, stopEdgeScroll])
  const cancel = useCallback(() => {
    if (release()) navigation.setDraft(null)
  }, [release, navigation.setDraft])
  useEffect(() => {
    if (disabled || drag.current?.contextKey !== navigation.contextKey) cancel()
  }, [navigation.contextKey, disabled, cancel])
  useEffect(
    () => () => {
      if (release()) navigation.setDraft(null)
    },
    [release, navigation.setDraft],
  )
  const move = (clientX: number) => {
    const current = drag.current
    const track = handle.current?.parentElement
    if (!current || !track) return
    current.clientX = clientX
    if (Math.abs(clientX - current.startX) > 2) current.moved = true
    if (!current.moved) return
    const position = pointerPosition(track, layout, clientX)
    if (position !== null) {
      current.target = position
      navigation.setDraft(position)
    }
  }
  const edgeScroll = () => {
    edgeFrame.current = null
    const current = drag.current
    const track = handle.current?.parentElement
    if (!current || !track) return
    const before = track.scrollLeft
    track.scrollLeft = Math.max(
      0,
      Math.min(
        track.scrollWidth - track.clientWidth,
        before + edgeScrollDelta(track, current.clientX),
      ),
    )
    move(current.clientX)
    if (track.scrollLeft !== before) edgeFrame.current = requestAnimationFrame(edgeScroll)
  }
  const start = (event: PointerEvent<HTMLHRElement>) => {
    event.stopPropagation()
    if (disabled || event.button !== 0 || event.isPrimary === false || drag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
      contextKey: navigation.contextKey,
      startX: event.clientX,
      clientX: event.clientX,
      target: navigation.position,
      moved: false,
    }
    navigation.setDraft(navigation.position)
  }
  const finish = (event: PointerEvent<HTMLHRElement>) => {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    move(event.clientX)
    const current = release()
    if (!current) return
    if (!current.moved || disabled || current.contextKey !== navigation.contextKey) {
      navigation.setDraft(null)
      return
    }
    void navigation.seek(current.target)
  }
  const pointerMove = (event: PointerEvent<HTMLHRElement>) => {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    move(event.clientX)
    stopEdgeScroll()
    edgeFrame.current = requestAnimationFrame(edgeScroll)
  }
  const keyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
      return
    }
    if (disabled || drag.current) return
    const targets: Record<string, number> = {
      ArrowLeft: Math.max(0, navigation.position - 1),
      ArrowRight: Math.min(navigation.items.length, navigation.position + 1),
      Home: 0,
      End: navigation.items.length,
    }
    const target = targets[event.key]
    if (target !== undefined) {
      event.preventDefault()
      void navigation.seek(target)
    }
  }
  return { disabled, start, finish, pointerMove, keyDown, cancel }
}

export function HistoryTimelineCursor() {
  const t = useTranslations("app.historyNavigation")
  const navigation = useHistoryNavigation()
  const { handle, layout } = useCursorLayout(navigation.items)
  const gestures = useCursorGestures(navigation, layout, handle)
  const disabled = gestures.disabled
  const instructions = useId()
  const x = markerPosition(layout, navigation.value)
  const revealedBoundary = useRef<string | null>(null)
  const item = navigation.items[navigation.position - 1]
  const boundary = navigation.boundaryActive ? (item ? `${item.kind}:${item.id}` : "start") : "end"
  useEffect(() => {
    const track = handle.current?.parentElement
    if (
      !track ||
      navigation.draft !== null ||
      layout.settling ||
      !layout.anchors.length ||
      revealedBoundary.current === boundary
    )
      return
    revealMarker(track, x)
    revealedBoundary.current = boundary
  }, [handle, layout, x, navigation.draft, boundary])
  return (
    <>
      <hr
        ref={handle}
        aria-orientation="vertical"
        aria-label={t("cursorLabel")}
        aria-describedby={instructions}
        aria-valuemin={0}
        aria-valuemax={navigation.items.length}
        aria-valuenow={navigation.value}
        aria-valuetext={t("positionDescription", {
          position: navigation.value,
          total: navigation.items.length,
          item: navigation.description,
        })}
        aria-disabled={disabled}
        aria-busy={navigation.pending || layout.settling}
        tabIndex={disabled ? -1 : 0}
        data-history-cursor
        data-history-cursor-draft={navigation.draft === null ? undefined : "true"}
        className={cn(
          "absolute inset-y-1 z-20 m-0 h-auto w-4 -translate-x-1/2 touch-none border-0 outline-none",
          "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
          disabled ? "cursor-default opacity-60" : "cursor-ew-resize",
        )}
        style={{ left: x }}
        onPointerDown={gestures.start}
        onPointerMove={gestures.pointerMove}
        onPointerUp={gestures.finish}
        onPointerCancel={(event) => {
          event.stopPropagation()
          gestures.cancel()
        }}
        onLostPointerCapture={gestures.cancel}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onKeyDown={gestures.keyDown}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 z-20 w-0.5 -translate-x-1/2 rounded bg-primary"
        style={{ left: x }}
      />
      <span id={instructions} className="sr-only">
        {t("cursorInstructions")}
      </span>
    </>
  )
}
