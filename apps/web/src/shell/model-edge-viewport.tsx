import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  GeometryViewport,
  ViewerEdgeCandidate,
  ViewerMesh,
} from "@vibeshape/viewer/three-viewport"
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { SAFE_VIEWPORT_CENTER, SAFE_VIEWPORT_LEFT } from "./viewport-chrome-styles"

export type ModelEdgeViewportSelection = Readonly<{
  candidates: readonly ViewerEdgeCandidate[]
  onSelect: (candidate: ViewerEdgeCandidate | null) => void
}>

const MAX_OVERLAP_CANDIDATES = 8
const NO_EDGES: readonly ViewerEdgeCandidate[] = []

function edgeKey(candidate: ViewerEdgeCandidate) {
  // An absent role identifies a legacy whole producer, never an arbitrary modern output.
  return JSON.stringify([candidate.featureId, candidate.outputRole ?? null, candidate.candidateId])
}

function visibleEdgeCandidates(
  candidates: readonly ViewerEdgeCandidate[] | undefined,
  meshes: readonly ViewerMesh[],
) {
  return (
    candidates?.filter((candidate) =>
      meshes.some(
        (mesh) =>
          mesh.featureId === candidate.featureId && mesh.outputRole === candidate.outputRole,
      ),
    ) ?? NO_EDGES
  )
}

function overlapCandidateKeys(
  stack: readonly ViewerEdgeCandidate[],
  available: ReadonlyMap<string, ViewerEdgeCandidate>,
) {
  return [...new Set(stack.map(edgeKey))]
    .filter((key) => available.has(key))
    .slice(0, MAX_OVERLAP_CANDIDATES)
}

function sameEdgeKeys(current: readonly string[], next: readonly string[]) {
  return current.length === next.length && current.every((key, index) => key === next[index])
}

function useModelEdgePointerState(
  byKey: ReadonlyMap<string, ViewerEdgeCandidate>,
  enabled: boolean,
) {
  const latest = useRef({ byKey, enabled })
  latest.current = { byKey, enabled }
  const [preselectionKey, setPreselectionKey] = useState<string | null>(null)
  const [stackKeys, setStackKeys] = useState<readonly string[]>([])
  const candidateStack = useMemo(
    () => stackKeys.flatMap((key) => byKey.get(key) ?? []),
    [byKey, stackKeys],
  )
  const clear = useCallback(() => {
    setPreselectionKey(null)
    setStackKeys([])
  }, [])
  useEffect(() => {
    if (!enabled) clear()
  }, [clear, enabled])
  const onPreselectionChange = useCallback((candidate: ViewerEdgeCandidate | null) => {
    setPreselectionKey(candidate && latest.current.enabled ? edgeKey(candidate) : null)
  }, [])
  const onCandidateStackChange = useCallback((stack: readonly ViewerEdgeCandidate[]) => {
    const keys = overlapCandidateKeys(stack, latest.current.byKey)
    setStackKeys((current) => (sameEdgeKeys(current, keys) ? current : keys))
  }, [])
  return {
    candidateStack,
    clear,
    onCandidateStackChange,
    onPreselectionChange,
    preselection: preselectionKey ? (byKey.get(preselectionKey) ?? null) : null,
  }
}

export function useModelEdgeViewport(
  selection: ModelEdgeViewportSelection | undefined,
  meshes: readonly ViewerMesh[],
) {
  const candidates = useMemo(
    () => visibleEdgeCandidates(selection?.candidates, meshes),
    [meshes, selection?.candidates],
  )
  const byKey = useMemo(
    () => new Map(candidates.map((candidate) => [edgeKey(candidate), candidate])),
    [candidates],
  )
  const latest = useRef({ byKey, candidates, selection })
  latest.current = { byKey, candidates, selection }
  const viewportRef = useRef<GeometryViewport | null>(null)
  const pointer = useModelEdgePointerState(byKey, selection !== undefined)
  const [selectionVersion, setSelectionVersion] = useState(0)

  const onSelectionChange = useCallback((candidate: ViewerEdgeCandidate | null) => {
    const current = latest.current
    if (!current.selection) return
    const resolved = candidate ? current.byKey.get(edgeKey(candidate)) : null
    if (resolved === undefined) return
    setSelectionVersion((version) => version + 1)
    current.selection.onSelect(resolved)
  }, [])
  const synchronize = useCallback((viewport: GeometryViewport | null) => {
    if (!viewport) return
    viewportRef.current = viewport
    viewport.setEdgeCandidates(latest.current.candidates)
  }, [])
  const disconnect = useCallback(
    (viewport: GeometryViewport | null) => {
      if (viewportRef.current === viewport) viewportRef.current = null
      pointer.clear()
    },
    [pointer.clear],
  )
  const preview = (candidate: ViewerEdgeCandidate | null) => {
    viewportRef.current?.setEdgePreselection(candidate)
    pointer.onPreselectionChange(candidate)
  }
  const choose = (candidate: ViewerEdgeCandidate) => {
    viewportRef.current?.clearSelection()
    onSelectionChange(candidate)
    preview(candidate)
  }
  const clearSelection = () => {
    viewportRef.current?.clearSelection()
    onSelectionChange(null)
    preview(null)
  }
  return {
    active: selection !== undefined && candidates.length > 0,
    hasSelection: candidates.some((candidate) => candidate.selected),
    candidates,
    candidateStack: pointer.candidateStack,
    choose,
    clearSelection,
    disconnect,
    onCandidateStackChange: pointer.onCandidateStackChange,
    onPreselectionChange: pointer.onPreselectionChange,
    onSelectionChange,
    preselection: pointer.preselection,
    preview,
    selectionVersion,
    synchronize,
  }
}

type ModelEdgeViewport = ReturnType<typeof useModelEdgeViewport>

function selectOtherAction(event: KeyboardEvent<HTMLElement>) {
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey)
    return null
  if (event.code === "Backquote") return event.shiftKey ? "previous" : "next"
  if (event.key === "Enter") return "accept"
  if (event.key === "Escape") return "close"
  return null
}

function consumeKey(event: KeyboardEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export function useModelEdgeSelectOther(
  edges: ModelEdgeViewport,
  focusRef: RefObject<HTMLElement | null>,
) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const { candidateStack, selectionVersion } = edges
  const activeIndex = activeKey
    ? candidateStack.findIndex((edge) => edgeKey(edge) === activeKey)
    : -1
  const previewRef = useRef(edges.preview)
  previewRef.current = edges.preview
  useEffect(() => {
    setActiveKey((current) => {
      if (current !== null) focusRef.current?.focus({ preventScroll: true })
      return null
    })
  }, [candidateStack, focusRef, selectionVersion])
  useEffect(() => {
    if (!edges.active) {
      setActiveKey(null)
      previewRef.current(null)
    }
  }, [edges.active])
  const preview = (index: number) => {
    const candidate = candidateStack[index]
    if (!candidate) return
    setActiveKey(edgeKey(candidate))
    edges.preview(candidate)
  }
  const close = (restoreFocus: boolean) => {
    setActiveKey(null)
    edges.preview(restoreFocus ? (candidateStack[0] ?? null) : null)
    if (restoreFocus) focusRef.current?.focus({ preventScroll: true })
  }
  const choose = (candidate: ViewerEdgeCandidate) => {
    setActiveKey(null)
    edges.choose(candidate)
    focusRef.current?.focus({ preventScroll: true })
  }
  const cycle = (reverse: boolean) => {
    const preselectedKey = edges.preselection ? edgeKey(edges.preselection) : null
    const initial = preselectedKey
      ? candidateStack.findIndex((edge) => edgeKey(edge) === preselectedKey)
      : 0
    preview(
      activeIndex < 0
        ? Math.max(0, initial)
        : (activeIndex + (reverse ? -1 : 1) + candidateStack.length) % candidateStack.length,
    )
  }
  const dismiss = () => {
    if (activeIndex >= 0) {
      close(true)
      return true
    }
    if (!edges.hasSelection) return false
    edges.clearSelection()
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!edges.active) return
    const action = selectOtherAction(event)
    switch (action) {
      case "next":
      case "previous":
        if (candidateStack.length < 2) return
        consumeKey(event)
        cycle(action === "previous")
        break
      case "accept": {
        const candidate = candidateStack[activeIndex]
        if (!candidate) return
        consumeKey(event)
        choose(candidate)
        break
      }
      case "close":
        if (!dismiss()) return
        consumeKey(event)
        break
    }
  }
  const focus = (event: PointerEvent<HTMLElement>) => {
    if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "CANVAS")
      event.currentTarget.focus({ preventScroll: true })
  }
  const focusOnEnter = (event: PointerEvent<HTMLElement>) => {
    const active = event.currentTarget.ownerDocument.activeElement
    if (
      active &&
      active !== event.currentTarget.ownerDocument.body &&
      !event.currentTarget.contains(active)
    )
      return
    focus(event)
  }
  return {
    activeIndex,
    candidates: candidateStack,
    choose,
    onKeyDown,
    preview,
    regionInteraction: edges.active
      ? {
          className: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onKeyDown,
          onPointerDown: focus,
          onPointerEnter: focusOnEnter,
          onPointerLeave: () => close(false),
          tabIndex: 0,
        }
      : {},
  }
}

type ModelEdgeSelectOther = ReturnType<typeof useModelEdgeSelectOther>

export function ModelEdgeViewportChrome({
  edges,
  selectOther,
}: Readonly<{ edges: ModelEdgeViewport; selectOther: ModelEdgeSelectOther }>) {
  const t = useTranslations("app.shell.viewport")
  const listboxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectOther.activeIndex >= 0) listboxRef.current?.focus({ preventScroll: true })
  }, [selectOther.activeIndex])
  if (!edges.active) return null
  const candidateLabel = (candidate: ViewerEdgeCandidate) =>
    t("modelEdgeCandidate", { label: candidate.label })
  const selected = edges.candidates.find((candidate) => candidate.selected)
  return (
    <>
      <div
        className={cn(
          "sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-3 focus-within:left-3 focus-within:z-10 focus-within:grid focus-within:gap-1 focus-within:rounded-md focus-within:border focus-within:bg-background focus-within:p-2 focus-within:shadow-sm",
          SAFE_VIEWPORT_LEFT,
        )}
      >
        <span className="text-xs font-medium">{t("modelEdgeKeyboardSelection")}</span>
        <NativeSelect
          aria-label={t("modelEdgeKeyboardSelection")}
          className="h-8 max-w-72 text-xs"
          onChange={(event) => {
            const candidate = edges.candidates.find(
              (edge) => edgeKey(edge) === event.currentTarget.value,
            )
            if (candidate) selectOther.choose(candidate)
          }}
          value={selected ? edgeKey(selected) : ""}
        >
          <option value="">{t("modelEdgeKeyboardPlaceholder")}</option>
          {edges.candidates.map((candidate) => (
            <option key={edgeKey(candidate)} value={edgeKey(candidate)}>
              {candidateLabel(candidate)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {edges.preselection && selectOther.activeIndex < 0 ? (
        <p
          className={cn(
            "pointer-events-none absolute bottom-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur-sm",
            SAFE_VIEWPORT_LEFT,
          )}
          role="status"
        >
          {candidateLabel(edges.preselection)}
        </p>
      ) : null}
      {selectOther.activeIndex >= 0 && selectOther.candidates.length >= 2 ? (
        <div
          aria-activedescendant={`model-edge-select-other-${selectOther.activeIndex}`}
          aria-label={t("selectOtherReference")}
          className={cn(
            "pointer-events-auto absolute bottom-12 z-10 w-80 -translate-x-1/2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
            SAFE_VIEWPORT_CENTER,
          )}
          onKeyDown={selectOther.onKeyDown}
          ref={listboxRef}
          role="listbox"
          tabIndex={-1}
        >
          <div className="px-2 pb-1 text-xs font-semibold">{t("selectOtherReference")}</div>
          <div className="grid gap-0.5">
            {selectOther.candidates.map((candidate, index) => (
              <Button
                aria-label={t("selectOtherReferenceOption", {
                  count: selectOther.candidates.length,
                  label: candidateLabel(candidate),
                  position: index + 1,
                })}
                aria-selected={selectOther.activeIndex === index}
                className="justify-start text-left"
                id={`model-edge-select-other-${index}`}
                key={edgeKey(candidate)}
                onClick={() => selectOther.choose(candidate)}
                onPointerEnter={() => selectOther.preview(index)}
                role="option"
                size="content"
                tabIndex={-1}
                type="button"
                variant={selectOther.activeIndex === index ? "secondary" : "ghost"}
              >
                <span className="w-10 shrink-0 font-mono text-muted-foreground">
                  {t("selectOtherReferencePosition", {
                    count: selectOther.candidates.length,
                    position: index + 1,
                  })}
                </span>
                <span className="truncate">{candidateLabel(candidate)}</span>
              </Button>
            ))}
          </div>
          <div className="px-2 pt-1 text-[11px] text-muted-foreground">
            {t("selectOtherReferenceHint")}
          </div>
        </div>
      ) : null}
    </>
  )
}
