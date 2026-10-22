import type { SketchId } from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { SkipBack, SkipForward, StepBack, StepForward } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { effectiveHistoryBoundaryIndex } from "./history-insertion-context"
import type { EditorWorkspaceName } from "./workspace"

export type HistoryNavigationProps = {
  controller: DocumentControllerState
  activeWorkspace?: EditorWorkspaceName
  activeSketchId?: SketchId | null
  onInsert: ((item: HistoryItemRef, side: "above" | "below") => Promise<boolean>) | undefined
  onReturnToEnd: (() => Promise<boolean>) | undefined
  orderedRefs?: readonly HistoryItemRef[]
  graphFailed?: boolean
}

function historyNavigationIsReadOnly(controller: DocumentControllerState) {
  return (
    controller.status !== "ready" ||
    controller.report?.mode !== "read-write" ||
    controller.saveStatus === "saving"
  )
}

function navigationPosition(props: HistoryNavigationProps) {
  const items = props.orderedRefs ?? props.controller.report?.historyItems ?? []
  const boundary = effectiveHistoryBoundaryIndex(
    props.controller,
    items,
    props.activeWorkspace === "sketch" ? props.activeSketchId : null,
    props.graphFailed,
  )
  return {
    items,
    boundaryActive: boundary !== null,
    position: boundary === null ? items.length : boundary + 1,
  }
}
function navigationContextKey(
  controller: DocumentControllerState,
  position: number,
  boundaryActive: boolean,
) {
  const report = controller.report
  return `${report?.snapshot.id ?? "unavailable"}:${report?.snapshot.revision ?? -1}:${position}:${boundaryActive}`
}
function navigationUnavailable(props: HistoryNavigationProps, count: number) {
  return (
    count === 0 ||
    props.graphFailed === true ||
    historyNavigationIsReadOnly(props.controller) ||
    !props.onInsert ||
    !props.onReturnToEnd
  )
}
function validHistoryPosition(value: number, count: number) {
  return Number.isInteger(value) && value >= 0 && value <= count
}
function sameHistoryPosition(
  target: number,
  position: number,
  count: number,
  boundaryActive: boolean,
) {
  return target === position && !(target === count && boundaryActive)
}
function useHistorySeek(props: HistoryNavigationProps) {
  const { items, position, boundaryActive } = navigationPosition(props)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [draft, updateDraft] = useState<number | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const contextKey = navigationContextKey(props.controller, position, boundaryActive)
  useEffect(() => {
    generation.current += 1
    updateDraft(null)
    setFailed(false)
    return () => {
      generation.current += 1
    }
  }, [contextKey])
  const disabled = pending || navigationUnavailable(props, items.length)
  const setDraft = useCallback(
    (value: number | null) => {
      if (value === null) {
        updateDraft(null)
        return
      }
      if (!disabled && !inFlight.current && validHistoryPosition(value, items.length))
        updateDraft(value)
    },
    [disabled, items.length],
  )
  async function seek(target: number) {
    if (disabled || inFlight.current) return false
    if (!validHistoryPosition(target, items.length)) {
      updateDraft(null)
      setFailed(true)
      return false
    }
    if (sameHistoryPosition(target, position, items.length, boundaryActive)) {
      updateDraft(null)
      return true
    }
    inFlight.current = true
    setPending(true)
    setFailed(false)
    updateDraft(target)
    const token = generation.current
    try {
      const moved = await moveToPosition(items, target, props.onInsert, props.onReturnToEnd)
      if (generation.current === token) setFailed(!moved)
      return moved
    } catch {
      if (generation.current === token) setFailed(true)
      return false
    } finally {
      inFlight.current = false
      setPending(false)
      updateDraft(null)
    }
  }
  return {
    items,
    position,
    boundaryActive,
    draft,
    value: draft ?? position,
    contextKey,
    setDraft,
    pending,
    failed,
    disabled,
    seek,
  }
}

function moveToPosition(
  items: readonly HistoryItemRef[],
  target: number,
  onInsert: HistoryNavigationProps["onInsert"],
  onReturnToEnd: HistoryNavigationProps["onReturnToEnd"],
) {
  if (!onInsert || !onReturnToEnd) return false
  if (target === items.length) return onReturnToEnd()
  const item = items[Math.max(0, target - 1)]
  return item ? onInsert(item, target === 0 ? "above" : "below") : false
}

const HistoryNavigationContext = createContext<
  (ReturnType<typeof useHistorySeek> & { description: string }) | null
>(null)

export function HistoryNavigationProvider({
  children,
  ...props
}: HistoryNavigationProps & { children: ReactNode }) {
  const t = useTranslations("app.historyNavigation")
  const { controller } = props
  const navigation = useHistorySeek(props)
  const { items, value, boundaryActive, draft } = navigation
  const item = items[value - 1]
  const record =
    item?.kind === "feature"
      ? controller.report?.snapshot.features.find(({ id }) => id === item.id)
      : controller.report?.snapshot.sketches.find(({ id }) => id === item?.id)
  const description =
    value === 0
      ? t("start")
      : value === items.length && (!boundaryActive || draft !== null)
        ? t("end")
        : (record?.label ?? t("positionLabel"))
  return (
    <HistoryNavigationContext value={{ ...navigation, description }}>
      {children}
    </HistoryNavigationContext>
  )
}
export function useHistoryNavigation() {
  const context = useContext(HistoryNavigationContext)
  if (!context) throw new Error("History navigation requires its shared provider.")
  return context
}
export function HistoryNavigationControls() {
  const t = useTranslations("app.historyNavigation")
  const {
    items,
    position,
    value,
    description,
    boundaryActive,
    draft,
    pending,
    failed,
    disabled,
    seek,
  } = useHistoryNavigation()
  useReportActivity(pending)
  const controls = [
    { key: "first", icon: SkipBack, target: 0, disabled: position === 0 },
    {
      key: "previous",
      icon: StepBack,
      target: Math.max(0, position - 1),
      disabled: position === 0,
    },
    {
      key: "next",
      icon: StepForward,
      target: Math.min(items.length, position + 1),
      disabled: position === items.length && !boundaryActive,
    },
    {
      key: "last",
      icon: SkipForward,
      target: items.length,
      disabled: !boundaryActive,
    },
  ] as const
  return (
    <fieldset
      className="flex min-w-0 items-center gap-1"
      aria-label={t("label")}
      aria-busy={pending}
    >
      {controls.map(({ key, icon: Icon, target, disabled: atBoundary }) => (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t(key)}
              disabled={disabled || draft !== null || atBoundary}
              onClick={() => seek(target)}
            >
              <Icon aria-hidden="true" className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(key)}</TooltipContent>
        </Tooltip>
      ))}
      <span
        role="status"
        aria-label={t("positionLabel")}
        className="truncate text-xs tabular-nums text-muted-foreground"
      >
        {t("positionDescription", { position: value, total: items.length, item: description })}
      </span>
      {failed ? (
        <Alert>{t("failed")}</Alert>
      ) : (
        <span className="sr-only" role="status">
          {pending ? t("pending") : ""}
        </span>
      )}
    </fieldset>
  )
}
