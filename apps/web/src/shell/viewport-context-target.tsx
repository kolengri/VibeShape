import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ContextMenuTrigger } from "@vibeshape/ui/components/context-menu"
import { Ruler } from "@vibeshape/ui/components/icons"
import type { GeometryViewport, ViewerSelection } from "@vibeshape/viewer/three-viewport"
import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useContext,
  useRef,
} from "react"

export type ViewportContextTarget = Readonly<{
  face: ViewerSelection | null
  candidates: readonly ViewerSelection[]
  focus: HTMLElement
  select: (face: ViewerSelection | null) => void
  preview: (face: ViewerSelection | null) => void
}>

export const ViewportContextTargetContext = createContext<{
  enabled: boolean
  request: (target: ViewportContextTarget) => void
  inspect: (focus: HTMLElement) => void
  hasSelection: boolean
} | null>(null)

export function ViewportSelectionProperties() {
  const context = useContext(ViewportContextTargetContext)
  const t = useTranslations("app.viewportContext")
  if (!context) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={t("properties")}
      title={t("properties")}
      disabled={!context.enabled || !context.hasSelection}
      onClick={(event) => context.inspect(event.currentTarget)}
    >
      <Ruler aria-hidden="true" />
    </Button>
  )
}

type ContextMenuGesture = {
  x: number
  y: number
  moved: boolean
  released: boolean
  deferred: boolean
  delivered: boolean
}

function contextGestureDisposition(gesture: ContextMenuGesture | null, replaying: boolean) {
  if (!gesture || replaying) return "deliver"
  if (gesture.moved || gesture.delivered) return "ignore"
  return gesture.released ? "deliver" : "defer"
}

function replayDeferredContextMenu(target: HTMLElement, gesture: ContextMenuGesture) {
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: gesture.x,
      clientY: gesture.y,
    }),
  )
}

/** Defer early native context menus until a stationary right-button gesture is released. */
function useViewportContextGesture() {
  const gesture = useRef<ContextMenuGesture | null>(null)
  const replaying = useRef(false)
  const onPointerDownCapture = (event: PointerEvent<HTMLElement>) => {
    gesture.current =
      event.button === 2
        ? {
            x: event.clientX,
            y: event.clientY,
            moved: false,
            released: false,
            deferred: false,
            delivered: false,
          }
        : null
  }
  const onPointerMoveCapture = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (
      current &&
      !current.released &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5
    )
      current.moved = true
  }
  const onPointerCancel = () => {
    gesture.current = null
  }
  const onPointerUpCapture = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || event.button !== 2) return
    current.released = true
    if (!current.deferred || current.moved) return
    const target = event.currentTarget
    queueMicrotask(() => {
      if (gesture.current !== current) return
      replaying.current = true
      try {
        replayDeferredContextMenu(target, current)
      } finally {
        replaying.current = false
      }
    })
  }
  const onKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
      gesture.current = null
  }
  const acceptContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const current = gesture.current
    const disposition = contextGestureDisposition(current, replaying.current)
    if (disposition !== "deliver") {
      if (current && disposition === "defer") current.deferred = true
      event.preventDefault()
      return false
    }
    if (current) current.delivered = true
    return true
  }
  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerCancel,
    onPointerUpCapture,
    onKeyDownCapture,
    acceptContextMenu,
  }
}

function pickViewportContextTarget(
  event: ReactMouseEvent<HTMLElement>,
  viewport: GeometryViewport | null,
  selection: ViewerSelection | null,
  onSelect: (face: ViewerSelection | null) => void,
): ViewportContextTarget {
  const candidates =
    event.clientX || event.clientY ? (viewport?.selectionCandidatesAt?.(event) ?? []) : []
  const select = (next: ViewerSelection | null) => {
    if (viewport?.selectFace) viewport.selectFace(next)
    else onSelect(next)
  }
  if (candidates[0]) select(candidates[0])
  return {
    face: candidates[0] ?? selection,
    candidates,
    focus: event.currentTarget,
    select,
    preview: (next) => viewport?.setSelectionPreselection(next),
  }
}

/** The canvas supplies picking; the editor owns command eligibility and document authority. */
export function ViewportContextTrigger({
  children,
  viewportRef,
  selection,
  onSelect,
}: {
  children: ReactElement
  viewportRef: RefObject<GeometryViewport | null>
  selection: ViewerSelection | null
  onSelect: (face: ViewerSelection | null) => void
}) {
  const context = useContext(ViewportContextTargetContext)
  const { acceptContextMenu, ...gestureHandlers } = useViewportContextGesture()
  if (!context) return children
  return (
    <ContextMenuTrigger
      asChild
      disabled={!context.enabled}
      {...gestureHandlers}
      onContextMenuCapture={(event) => {
        if (!context.enabled || !acceptContextMenu(event)) return
        context.request(pickViewportContextTarget(event, viewportRef.current, selection, onSelect))
      }}
    >
      {children}
    </ContextMenuTrigger>
  )
}
