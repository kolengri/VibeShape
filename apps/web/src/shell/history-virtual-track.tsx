import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import type { FolderHistoryGroup } from "./authored-tree-state"
import { HistoryFolderGroup } from "./history-folder-group"
import type { HistoryRevealRequest } from "./history-reveal-request"
import { HistoryTimelineCursor } from "./history-timeline-cursor"
import {
  type HistoryTrackGroup,
  type HistoryTrackUnit,
  historyTrackLayout,
  historyTrackSegments,
} from "./history-virtual-layout"
import { type HistoryViewRow, historyRefKey } from "./model-tree-history"
import { useHistoryTrackFocus } from "./use-history-track-focus"
import { useVirtualInteractionPin } from "./use-virtual-interaction-pin"

export function HistoryVirtualTrack({
  groups,
  authority,
  onCommit,
  disabled,
  detailed,
  dragSourceKey,
  revealRequest,
  selectedId,
  renderRow,
  empty,
}: {
  groups: readonly FolderHistoryGroup[]
  authority: AuthoredDocumentSnapshot | null
  onCommit: AuthoredMetadataCommit | undefined
  disabled: boolean
  detailed: boolean
  dragSourceKey: string | null
  revealRequest: HistoryRevealRequest | null | undefined
  selectedId: string | null | undefined
  renderRow: (row: HistoryViewRow, index: number) => ReactNode
  empty: ReactNode
}) {
  const track = useRef<HTMLDivElement>(null)
  const { collapsed, setExpanded } = useHistoryFolderExpansion()
  const [focused, setFocused] = useState<string | null>(null)
  const [interacted, setInteracted] = useVirtualInteractionPin()
  const { effectiveGroups, units, layout, allRows } = useHistoryTrackLayout(
    groups,
    Boolean(authority && onCommit),
    collapsed,
  )
  const virtualized = units.length > 80
  const trackClassName = historyTrackClassName(virtualized)
  const pins = [focused, interacted, dragSourceKey]
    .map((key) => units.findIndex((unit) => unit.key === key))
    .filter((index) => index >= 0)
  const { virtualizer, height, totalSize, visible, measurements } = useMeasuredHistoryWindow(
    track,
    units,
    detailed,
    pins,
    virtualized,
  )
  const { moveFocus } = useHistoryTrackFocus({
    track,
    units,
    layout,
    groups: effectiveGroups,
    virtualized,
    virtualizer,
    revealRequest,
    selectedId,
    onExpand: setExpanded,
    focused,
    setFocused,
  })
  const folder = (
    group: HistoryTrackGroup,
    children: ReactNode,
    virtual?: { width: number; controlIndex: number; collapsed: boolean },
  ) => (
    <HistoryTrackFolder
      key={units[group.start]?.key}
      group={group}
      authority={authority}
      rows={allRows}
      onCommit={onCommit}
      disabled={disabled}
      collapsed={collapsed}
      onExpand={setExpanded}
      virtual={virtual}
      height={height}
      measureElement={virtualizer.measureElement}
    >
      {children}
    </HistoryTrackFolder>
  )
  return (
    <div
      ref={track}
      className={trackClassName}
      data-history-track
      data-history-virtualized={virtualized}
      onKeyDownCapture={moveFocus}
      onFocusCapture={(event) => captureHistoryUnit(event.target, setFocused)}
      onPointerDownCapture={(event) => captureHistoryUnit(event.target, setInteracted)}
    >
      <HistoryTrackContents
        virtualized={virtualized}
        units={units}
        layout={layout}
        visible={visible}
        measurements={measurements}
        totalSize={totalSize}
        height={height}
        measureElement={virtualizer.measureElement}
        renderRow={renderRow}
        renderFolder={folder}
        empty={empty}
        collapsed={collapsed}
      />
    </div>
  )
}

function HistoryTrackFolder({
  group,
  authority,
  onCommit,
  disabled,
  rows,
  collapsed,
  onExpand,
  virtual,
  height,
  measureElement,
  children,
}: {
  group: HistoryTrackGroup
  authority: AuthoredDocumentSnapshot | null
  onCommit: AuthoredMetadataCommit | undefined
  disabled: boolean
  rows: readonly HistoryViewRow[]
  collapsed: ReadonlySet<string>
  onExpand: (folderId: string, expanded: boolean) => void
  virtual: { width: number; controlIndex: number; collapsed: boolean } | undefined
  height: number
  measureElement: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const folder = group.folder
  if (!folder || !authority || !onCommit) return children
  return (
    <HistoryFolderGroup
      folder={folder}
      authority={authority}
      rows={rows}
      disabled={disabled}
      onCommit={onCommit}
      horizontal
      expanded={!collapsed.has(folder.id)}
      onExpandedChange={(expanded) => onExpand(folder.id, expanded)}
      virtualLayout={
        virtual ? { ...virtual, height, measureElement, unitKey: `folder:${folder.id}` } : undefined
      }
    >
      {children}
    </HistoryFolderGroup>
  )
}
function HistoryTrackCanvas({
  units,
  layout,
  visible,
  measurements,
  totalSize,
  height,
  measureElement,
  renderRow,
  renderFolder,
}: {
  units: readonly HistoryTrackUnit[]
  layout: readonly HistoryTrackGroup[]
  visible: readonly import("@tanstack/react-virtual").VirtualItem[]
  measurements: readonly import("@tanstack/react-virtual").VirtualItem[]
  totalSize: number
  height: number
  measureElement: (element: HTMLDivElement | null) => void
  renderRow: (row: HistoryViewRow, index: number) => ReactNode
  renderFolder: (
    group: HistoryTrackGroup,
    children: ReactNode,
    virtual?: { width: number; controlIndex: number; collapsed: boolean },
  ) => ReactNode
}) {
  return (
    <div
      className="relative"
      style={{
        width: totalSize,
        height: height + (layout.some((group) => group.folder) ? 32 : 0),
      }}
    >
      {layout.map((group, groupIndex) => {
        const mounted = visible.filter((item) => units[item.index]?.group === groupIndex)
        if (!mounted.length) return null
        const start = measurements[group.start]?.start ?? 0
        const end = measurements[group.end]?.end ?? start
        const children = mounted.map((item) => {
          const unit = units[item.index]
          if (!unit?.row) return null
          return (
            <div
              key={item.key}
              ref={measureElement}
              data-index={item.index}
              data-history-unit={unit.key}
              className="absolute top-0 left-0 w-max"
              style={{ transform: `translateX(${item.start - start}px)` }}
            >
              {renderRow(unit.row.row, unit.row.index)}
            </div>
          )
        })
        return (
          <div
            key={units[group.start]?.key}
            className="absolute top-0 left-0"
            style={{ transform: `translateX(${start}px)`, width: end - start }}
          >
            {renderFolder(group, children, {
              width: end - start,
              controlIndex: group.start,
              collapsed: Boolean(group.folder && group.start === group.end),
            })}
          </div>
        )
      })}
    </div>
  )
}

function useMeasuredHistoryWindow(
  track: RefObject<HTMLDivElement | null>,
  units: readonly HistoryTrackUnit[],
  detailed: boolean,
  pins: readonly number[],
  virtualized: boolean,
) {
  const [height, setHeight] = useState(32)
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: units.length,
    horizontal: true,
    useAnimationFrameWithResizeObserver: true,
    getScrollElement: () => track.current,
    getItemKey: (index) => units[index]?.key ?? index,
    estimateSize: (index) => (units[index]?.row ? (detailed ? 192 : 32) : 200),
    overscan: 6,
    paddingStart: 8,
    paddingEnd: 32,
    enabled: virtualized,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...pins])].sort((a, b) => a - b),
    measureElement: (element, entry) => {
      const box = entry?.borderBoxSize[0]
      const measuredHeight = box?.blockSize ?? element.getBoundingClientRect().height
      setHeight((previous) => Math.max(previous, measuredHeight))
      return box?.inlineSize ?? element.getBoundingClientRect().width
    },
  })
  const totalSize = virtualized ? virtualizer.getTotalSize() : 0
  const visible = virtualized ? virtualizer.getVirtualItems() : []
  const measurements = virtualizer.measurementsCache
  const previousDetailed = useRef(detailed)
  useLayoutEffect(() => {
    if (previousDetailed.current === detailed) return
    previousDetailed.current = detailed
    const anchor = pins[0] ?? virtualizer.range?.startIndex
    setHeight(32)
    virtualizer.measure()
    if (anchor !== undefined) virtualizer.scrollToIndex(anchor, { align: "start" })
  }, [detailed, virtualizer])
  return { virtualizer, height, totalSize, visible, measurements }
}

function useHistoryFolderExpansion() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const setExpanded = useCallback((folderId: string, expanded: boolean) => {
    setCollapsed((previous) => {
      if (previous.has(folderId) !== expanded) return previous
      const next = new Set(previous)
      if (expanded) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])
  return { collapsed, setExpanded }
}

function captureHistoryUnit(target: EventTarget, setKey: (key: string) => void) {
  const key = (target as HTMLElement).closest<HTMLElement>("[data-history-unit]")?.dataset
    .historyUnit
  if (key) setKey(key)
}

function HistoryStaticTrack({
  layout,
  renderFolder,
  renderRow,
}: {
  layout: readonly HistoryTrackGroup[]
  renderFolder: (group: HistoryTrackGroup, children: ReactNode) => ReactNode
  renderRow: (row: HistoryViewRow, index: number) => ReactNode
}) {
  return layout.map((group) =>
    renderFolder(
      group,
      group.rows.map(({ row, index }) => (
        <div
          key={historyRefKey(row.ref)}
          data-history-unit={historyRefKey(row.ref)}
          className="shrink-0"
        >
          {renderRow(row, index)}
        </div>
      )),
    ),
  )
}

function useHistoryTrackLayout(
  groups: readonly FolderHistoryGroup[],
  metadataAvailable: boolean,
  collapsed: ReadonlySet<string>,
) {
  const effectiveGroups = useMemo(
    () => (metadataAvailable ? groups : groups.map((group) => ({ ...group, folder: null }))),
    [groups, metadataAvailable],
  )
  const { units, layout } = useMemo(
    () => historyTrackLayout(effectiveGroups, collapsed),
    [effectiveGroups, collapsed],
  )
  const allRows = useMemo(
    () => effectiveGroups.flatMap((group) => group.rows.map(({ row }) => row)),
    [effectiveGroups],
  )
  return { effectiveGroups, units, layout, allRows }
}

function HistoryTrackContents(
  props: ComponentProps<typeof HistoryTrackCanvas> & {
    virtualized: boolean
    empty: ReactNode
    collapsed: ReadonlySet<string>
  },
) {
  const segments = props.virtualized
    ? historyTrackSegments(props.layout, props.units, props.measurements, props.collapsed)
    : undefined
  return (
    <>
      {props.virtualized ? <HistoryTrackCanvas {...props} /> : <HistoryStaticTrack {...props} />}
      {!props.units.length && props.empty}
      <HistoryTimelineCursor virtualSegments={segments} />
    </>
  )
}

function historyTrackClassName(virtualized: boolean) {
  return virtualized
    ? "relative min-w-0 overflow-x-auto overflow-y-hidden py-1"
    : "relative flex min-w-0 items-start overflow-x-auto overflow-y-hidden py-1 pl-2 pr-8"
}
