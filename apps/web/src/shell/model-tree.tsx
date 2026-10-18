import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react"
import { isSortable, isSortableOperation, useSortable } from "@dnd-kit/react/sortable"
import {
  type FeatureRecord,
  type HistoryItemRef,
  readDatumPlaneFeatureParameters,
  readExtrusionProfileSet,
  readRevolveProfileSet,
  type SketchId,
  type SketchProfileSelector,
  type SketchRecord,
} from "@vibeshape/domain"
import type { PartId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  ChevronDown,
  CircleAlert,
  Cuboid,
  Eye,
  EyeOff,
  Grid2X2,
  Layers3,
  ListFilter,
  PenLine,
} from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import {
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { SemanticRenameResult } from "../components/semantic-rename-dialog"
import type {
  DocumentControllerState,
  DocumentMutationResult,
  FeatureMutationResult,
} from "../document/document-controller"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { SketchDeleteAction } from "../features/sketch/sketch-delete-action"
import { SurfaceTextureTreeGroup } from "../features/surface-texture/surface-texture-tree-group"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import { AuthoredPartsGroup } from "./authored-parts-group"
import {
  authoredBodyKey,
  authoredBodyKeys,
  authoredHistoryTreeState,
  currentAuthoredParts,
  currentAuthoredSnapshot,
  selectedAuthoredBody,
} from "./authored-tree-state"
import { HistoryFeatureActions } from "./history-feature-actions"
import { HistoryFeatureIcon } from "./history-feature-icon"
import { HistoryFolderGroup } from "./history-folder-group"
import {
  HistoryFolderSelectableRow,
  HistoryFolderSelection,
  HistoryFolderSelectionControls,
  useHistoryFolderSelectionDescription,
} from "./history-folder-selection"
import { effectiveHistoryBoundaryIndex, historyInsertionContext } from "./history-insertion-context"
import { HistoryNavigationControls, HistoryNavigationProvider } from "./history-navigation"
import { HistoryProfileSources } from "./history-profile-sources"
import { HistoryTimelineCursor } from "./history-timeline-cursor"
import { ModelBrowserOrigin } from "./model-browser-origin"
import { type HistoryViewRow, historyRefKey, selectModelTreeHistory } from "./model-tree-history"
import { proposeHistoryMoveToIndex } from "./model-tree-history-dnd"
import { ModelTreeRenameDialog } from "./model-tree-rename-dialog"
import type { EditorWorkspaceName } from "./workspace"

const HistoryPresentation = createContext({ timeline: false, detailed: true })

const HISTORY_POINTER_SENSOR = PointerSensor.configure({
  preventActivation: (event, source) =>
    event.target instanceof Element && event.target.closest('[role="treeitem"]')
      ? false
      : (PointerSensor.defaults.preventActivation?.(event, source) ?? true),
  activationConstraints: (event) =>
    event.pointerType === "touch"
      ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 6 })]
      : [new PointerActivationConstraints.Distance({ value: 5 })],
})

type FeatureRenameHandler = (
  baseRevision: number,
  feature: FeatureRecord,
) => Promise<SemanticRenameResult>

type FeatureSuppressionHandler = (
  baseRevision: number,
  featureId: FeatureRecord["id"],
  suppressed: boolean,
) => Promise<DocumentMutationResult>

type HistoryMoveHandler = (
  baseRevision: number,
  item: HistoryItemRef,
  historyAfter: HistoryItemRef | null,
) => Promise<DocumentMutationResult>

type HistoryDragBoundary = Readonly<{
  documentId: string
  revision: number
  rollbackIndex: number
}>

function historyDragContextIsCurrent(
  boundary: HistoryDragBoundary | null,
  report: DocumentControllerState["report"],
  rollbackIndex: number,
) {
  return Boolean(
    boundary &&
      report &&
      boundary.documentId === report.snapshot.id &&
      boundary.revision === report.snapshot.revision &&
      boundary.rollbackIndex === rollbackIndex,
  )
}

function historyMoveIsAvailable(
  controller: DocumentControllerState,
  activeSketchId: SketchId | null,
  activeFeatureId: FeatureRecord["id"] | null,
  completeGraph: boolean,
) {
  return (
    completeGraph &&
    controller.status === "ready" &&
    controller.report?.mode === "read-write" &&
    activeSketchId === null &&
    activeFeatureId === null
  )
}

function resolveHistoryDrop(
  event: DragEndEvent,
  boundary: HistoryDragBoundary | null,
  report: DocumentControllerState["report"],
  rollbackIndex: number,
  destinationIndex: number | null,
  moveAvailable: boolean,
) {
  if (event.canceled || !isSortableOperation(event.operation)) return null
  const { source, target } = event.operation
  if (
    !source ||
    !target ||
    destinationIndex === null ||
    !historyDragContextIsCurrent(boundary, report, rollbackIndex) ||
    !moveAvailable
  ) {
    return null
  }
  if (!boundary) return null
  return { boundary, destinationIndex, source }
}

type SketchRenameHandler = (
  baseRevision: number,
  sketch: SketchRecord,
) => Promise<SemanticRenameResult>

type SketchRemoveHandler = (
  baseRevision: number,
  sketchId: SketchId,
) => Promise<DocumentMutationResult>

function FeatureVisibilityAction({
  feature,
  label,
  onChange,
  visible,
}: {
  feature: FeatureRecord
  label: string
  onChange: () => void
  visible: boolean
}) {
  const t = useTranslations("app.shell.modelTree")
  const { timeline, detailed } = useContext(HistoryPresentation)
  if (timeline && !detailed) return null
  const visibilityLabel = t(visible ? "hideFeature" : "showFeature", { feature: label })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={visibilityLabel}
          aria-pressed={visible}
          disabled={feature.suppressed}
          onClick={onChange}
        >
          {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{visibilityLabel}</TooltipContent>
    </Tooltip>
  )
}

function useHistoryRowLabel(item: HistoryItemRef) {
  const { timeline, detailed } = useContext(HistoryPresentation)
  const selection = useHistoryFolderSelectionDescription(item)
  return {
    timeline,
    compact: timeline && !detailed,
    describedBy:
      [timeline ? "history-drag-instructions" : undefined, selection?.id]
        .filter(Boolean)
        .join(" ") || undefined,
    selectionDescription: selection ? (
      <span id={selection.id} className="sr-only">
        {selection.text}
      </span>
    ) : null,
  }
}

function FeatureTreeLabel({
  active,
  feature,
  label,
  onActivate,
  onPreselectionChange,
  onRenameOpen,
  renameDisabled,
}: {
  active: boolean
  feature: FeatureRecord
  onActivate: (featureId: FeatureRecord["id"]) => void
  label: string
  onPreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onRenameOpen: () => void
  renameDisabled: boolean
}) {
  const { compact, describedBy, selectionDescription } = useHistoryRowLabel({
    kind: "feature",
    id: feature.id,
  })
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "min-w-0 flex-1 font-normal",
          compact ? "size-8 justify-center p-0" : "justify-start pl-2",
          active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
          feature.suppressed && "text-muted-foreground line-through decoration-dotted",
        )}
        role="treeitem"
        tabIndex={-1}
        aria-selected={active}
        aria-describedby={describedBy}
        title={label}
        onClick={(event) => {
          if (!event.defaultPrevented) onActivate(feature.id)
        }}
        onFocus={() => onPreselectionChange(feature.id)}
        onBlur={() => onPreselectionChange(null)}
        onKeyDown={(event) => {
          if (event.key !== "F2" || renameDisabled) return
          event.preventDefault()
          onRenameOpen()
        }}
      >
        {readDatumPlaneFeatureParameters(feature) ? (
          <Layers3 aria-hidden="true" className="mr-1 size-4 shrink-0" />
        ) : (
          <HistoryFeatureIcon feature={feature} />
        )}
        <span className={compact ? "sr-only" : "truncate"}>{label}</span>
      </Button>
      {selectionDescription}
    </>
  )
}

function HistoryItemActions({ children }: { children: ReactNode }) {
  const { timeline, detailed } = useContext(HistoryPresentation)
  return (
    <div
      className={
        timeline && !detailed
          ? "absolute -right-2 -top-2 opacity-0 focus-within:opacity-100 group-hover/history-item:opacity-100"
          : "contents"
      }
    >
      {children}
    </div>
  )
}

function FeatureTreeItem({
  active,
  controller,
  historyActions,
  feature,
  onActivate,
  onFeatureRename,
  onFindInBrowser,
  onPreselectionChange,
  onSuppressionChange,
  onVisibilityChange,
  onSketchRename,
  unnamedFeature,
  visible,
}: {
  active: boolean
  controller: DocumentControllerState
  historyActions: {
    disabled: boolean
    onDeleted: () => void
    onRemove: ModelTreeProps["onFeatureRemove"]
  }
  feature: FeatureRecord
  onActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onFindInBrowser?: (() => void) | undefined
  onPreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onSuppressionChange: FeatureSuppressionHandler
  onVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
  visible: boolean
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)
  const label = feature.label ?? unnamedFeature
  const renameDisabled = controller.status !== "ready" || controller.report?.mode !== "read-write"
  return (
    <div
      className={cn(
        "group/history-item relative flex min-w-0 items-center gap-0.5",
        feature.suppressed && "opacity-60",
      )}
      data-feature-suppressed={feature.suppressed ? "true" : undefined}
      onPointerEnter={() => onPreselectionChange(feature.id)}
      onPointerLeave={() => onPreselectionChange(null)}
    >
      <FeatureVisibilityAction
        feature={feature}
        label={label}
        visible={visible}
        onChange={() => onVisibilityChange(feature.id, !visible)}
      />
      <FeatureTreeLabel
        active={active}
        feature={feature}
        label={label}
        onActivate={onActivate}
        onPreselectionChange={onPreselectionChange}
        onRenameOpen={() => setRenameOpen(true)}
        renameDisabled={renameDisabled}
      />
      <HistoryItemActions>
        <HistoryFeatureActions
          onFindInBrowser={onFindInBrowser}
          controller={controller}
          deleteDisabled={historyActions.disabled}
          feature={feature}
          label={label}
          onDeleted={historyActions.onDeleted}
          onRemove={historyActions.onRemove}
          onRename={() => setRenameOpen(true)}
          onSuppressionChange={onSuppressionChange}
          renameDisabled={renameDisabled}
          renameOpen={renameOpen}
          triggerRef={actionsTriggerRef}
        />
      </HistoryItemActions>
      <ModelTreeRenameDialog
        showTrigger={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          actionsTriggerRef.current?.focus()
        }}
        controller={controller}
        fallbackName={unnamedFeature}
        onFeatureRename={onFeatureRename}
        onOpenChange={setRenameOpen}
        onSketchRename={onSketchRename}
        open={renameOpen}
        target={{ kind: "feature", record: feature }}
      />
    </div>
  )
}

function SketchTreeActions({
  controller,
  deletionBlocked,
  onRenameOpenChange,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchRename,
  renameBlocked,
  renameOpen,
  sketch,
  unnamedSketch,
}: {
  controller: DocumentControllerState
  deletionBlocked: boolean
  onRenameOpenChange: (open: boolean) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onSketchRename: SketchRenameHandler
  renameBlocked: boolean
  renameOpen: boolean
  sketch: SketchRecord
  unnamedSketch: string
}) {
  const label = sketch.label || unnamedSketch
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <ModelTreeRenameDialog
        showTrigger={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          actionsTriggerRef.current?.focus()
        }}
        blocked={renameBlocked}
        controller={controller}
        fallbackName={unnamedSketch}
        onFeatureRename={onFeatureRename}
        onOpenChange={onRenameOpenChange}
        onSketchRename={onSketchRename}
        open={renameOpen}
        target={{ kind: "sketch", record: sketch }}
      />
      <SketchDeleteAction
        renameAction={{
          triggerRef: actionsTriggerRef,
          onSelect: () => onRenameOpenChange(true),
          disabled:
            renameBlocked ||
            controller.status !== "ready" ||
            controller.report?.mode !== "read-write",
          open: renameOpen,
        }}
        baseRevision={controller.report?.snapshot.revision ?? 0}
        blocked={renameBlocked || deletionBlocked}
        disabled={controller.status !== "ready" || controller.report?.mode !== "read-write"}
        sketch={sketch}
        sketchName={label}
        onDeleted={onSketchDeleted}
        onRemove={onSketchRemove}
      />
    </>
  )
}

function SketchVisibilityAction({
  label,
  onChange,
  t,
  visible,
}: {
  label: string
  onChange: () => void
  t: ReturnType<typeof useTranslations>
  visible: boolean
}) {
  const { timeline, detailed } = useContext(HistoryPresentation)
  if (timeline && !detailed) return null
  const visibilityLabel = t(visible ? "hideSketch" : "showSketch", { sketch: label })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={visibilityLabel}
          aria-pressed={visible}
          onClick={onChange}
        >
          {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{visibilityLabel}</TooltipContent>
    </Tooltip>
  )
}

function SketchTreeLabelButton({
  active,
  sketchId,
  label,
  onActivate,
  onRenameOpen,
  renameDisabled,
}: {
  active: boolean
  sketchId: SketchId
  label: string
  onActivate: () => void
  onRenameOpen: () => void
  renameDisabled: boolean
}) {
  const { timeline, compact, describedBy, selectionDescription } = useHistoryRowLabel({
    kind: "sketch",
    id: sketchId,
  })
  const t = useTranslations("app.shell.modelTree")
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "min-w-0 flex-1 font-normal",
          compact ? "size-8 justify-center p-0" : "justify-start pl-2",
          active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
        )}
        role="treeitem"
        tabIndex={-1}
        aria-selected={active}
        aria-label={timeline ? t("editSketch", { sketch: label }) : undefined}
        aria-describedby={describedBy}
        title={label}
        onClick={(event) => {
          if (!event.defaultPrevented) onActivate()
        }}
        onKeyDown={(event) => {
          if (event.key !== "F2" || renameDisabled) return
          event.preventDefault()
          onRenameOpen()
        }}
      >
        <PenLine aria-hidden="true" className="mr-1 size-4 shrink-0" />
        <span className={compact ? "sr-only" : "truncate"}>{label}</span>
      </Button>
      {selectionDescription}
    </>
  )
}

function SketchTreeItem({
  active,
  controller,
  deletionBlocked,
  onActivate,
  onSketchSupportRepair,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchRename,
  onVisibilityChange,
  renameBlocked,
  row,
  unnamedSketch,
  visible,
}: {
  active: boolean
  controller: DocumentControllerState
  deletionBlocked: boolean
  onActivate: (sketchId: SketchId) => void
  onSketchSupportRepair: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onSketchRename: SketchRenameHandler
  onVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  renameBlocked: boolean
  row: HistoryViewRow
  unnamedSketch: string
  visible: boolean
}) {
  const t = useTranslations("app.shell.modelTree")
  const [renameOpen, setRenameOpen] = useState(false)
  const sketch = row.record as SketchRecord
  const label = sketch.label || unnamedSketch
  const renameDisabled =
    renameBlocked || controller.status !== "ready" || controller.report?.mode !== "read-write"
  const activateSketch = () => onActivate(sketch.id)

  return (
    <div className="group/history-item relative flex min-w-0 items-center gap-0.5">
      <SketchVisibilityAction
        label={label}
        onChange={() => onVisibilityChange(sketch.id, !visible)}
        t={t}
        visible={visible}
      />
      <SketchTreeLabelButton
        active={active}
        sketchId={sketch.id}
        label={label}
        onActivate={activateSketch}
        onRenameOpen={() => setRenameOpen(true)}
        renameDisabled={renameDisabled}
      />
      <BrokenSketchReferenceAction
        referenceHealth={row.referenceHealth}
        supportHealth={row.supportHealth}
        label={label}
        onActivate={activateSketch}
        onSupportRepair={() => onSketchSupportRepair(sketch.id)}
        t={t}
      />
      <HistoryItemActions>
        <SketchTreeActions
          controller={controller}
          deletionBlocked={deletionBlocked}
          onRenameOpenChange={setRenameOpen}
          onFeatureRename={onFeatureRename}
          onSketchDeleted={onSketchDeleted}
          onSketchRemove={onSketchRemove}
          onSketchRename={onSketchRename}
          renameBlocked={renameBlocked}
          renameOpen={renameOpen}
          sketch={sketch}
          unnamedSketch={unnamedSketch}
        />
      </HistoryItemActions>
    </div>
  )
}

function brokenReferenceCount(health: HistoryViewRow["referenceHealth"]) {
  return (
    (health?.directBrokenReferenceIds.length ?? 0) +
    (health?.transitiveBrokenReferenceIds.length ?? 0)
  )
}

function BrokenSketchReferenceAction({
  referenceHealth,
  supportHealth,
  label,
  onActivate,
  onSupportRepair,
  t,
}: {
  referenceHealth: HistoryViewRow["referenceHealth"]
  supportHealth: HistoryViewRow["supportHealth"]
  label: string
  onActivate: () => void
  onSupportRepair: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const supportBroken = supportHealth?.status === "missing" || supportHealth?.status === "ambiguous"
  const count = brokenReferenceCount(referenceHealth) + (supportBroken ? 1 : 0)
  if (count === 0) return null
  const repairLabel = supportBroken
    ? t(
        supportHealth.status === "ambiguous"
          ? "repairAmbiguousSketchSupport"
          : "repairMissingSketchSupport",
        { sketch: label },
      )
    : t("repairBrokenSketchReferences", { sketch: label, count })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive"
          aria-label={repairLabel}
          onClick={supportBroken ? onSupportRepair : onActivate}
        >
          <CircleAlert aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{repairLabel}</TooltipContent>
    </Tooltip>
  )
}

function SketchReferenceHealthSummary({
  health,
  t,
}: {
  health: HistoryViewRow["referenceHealth"]
  t: ReturnType<typeof useTranslations>
}) {
  if (health?.status !== "broken") return null
  return (
    <p className="ml-8 truncate px-2 text-[10px] text-destructive" role="status">
      {t("brokenReferenceSummary", {
        direct: health.directBrokenReferenceIds.length,
        chained: health.transitiveBrokenReferenceIds.length,
      })}
    </p>
  )
}

function SketchSupportHealthSummary({
  health,
  t,
}: {
  health: HistoryViewRow["supportHealth"]
  t: ReturnType<typeof useTranslations>
}) {
  if (!health || health.status === "resolved") return null
  const message =
    health.status === "missing"
      ? "missingSketchSupportSummary"
      : health.status === "ambiguous"
        ? "ambiguousSketchSupportSummary"
        : "unknownSketchSupportSummary"
  return (
    <p
      className={cn(
        "ml-8 truncate px-2 text-[10px]",
        health.status === "unknown" ? "text-muted-foreground" : "text-destructive",
      )}
      role="status"
    >
      {t(message)}
    </p>
  )
}

function ModelTreeRootItem({
  current,
  disabled = false,
  onWorkspaceChange,
  targetWorkspace,
  tabIndex = -1,
  title,
}: {
  current?: "page" | undefined
  disabled?: boolean
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  targetWorkspace: EditorWorkspaceName
  tabIndex?: number
  title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start font-normal"
      role="treeitem"
      tabIndex={tabIndex}
      aria-current={current}
      disabled={disabled}
      onClick={() => onWorkspaceChange(targetWorkspace)}
    >
      {targetWorkspace === "variables" ? (
        <Grid2X2 aria-hidden="true" className="size-4 text-muted-foreground" />
      ) : (
        <Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />
      )}
      {title}
    </Button>
  )
}

function ModelTreeGroupItem({
  className,
  count,
  icon,
  expanded,
  onExpandedChange,
  title,
}: {
  className?: string
  count?: number
  icon?: ReactNode
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("w-full justify-start font-normal", className)}
      role="treeitem"
      tabIndex={-1}
      aria-expanded={expanded}
      onClick={() => onExpandedChange(!expanded)}
    >
      <ChevronDown
        aria-hidden="true"
        className={cn("mr-1 size-4 shrink-0 transition-transform", !expanded && "-rotate-90")}
      />
      {icon}
      {title}
      {count !== undefined && (
        <span aria-hidden="true" className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </Button>
  )
}

type ModelTreeProps = {
  onCreateSketch?: (() => void) | undefined
  origin?:
    | Readonly<{
        selected: ViewerOriginPlane | null
        visibility: ViewerOriginPlaneVisibility
        onSelect: (plane: ViewerOriginPlane) => void
        onVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
        disabled: boolean
      }>
    | undefined
  highlightedFeatureId?: FeatureRecord["id"] | null | undefined
  selectedResultFeatureId?: string | null | undefined
  revealRequest?: Readonly<{ featureId: FeatureRecord["id"]; sequence: number }> | null
  onRevealFeature?: ((featureId: FeatureRecord["id"]) => void) | undefined
  surface?: "browser" | "timeline"
  onHistoryReturnToEnd?: (() => Promise<boolean>) | undefined
  onHistoryInsert?:
    | ((item: HistoryItemRef, side: "above" | "below") => Promise<boolean>)
    | undefined
  onSurfaceTexture?: ((featureId: FeatureRecord["id"], outputRole: string) => void) | undefined
  authoredMetadataBlocked?: boolean | undefined
  selectedPartId?: PartId | null | undefined
  onPartSelect?: ((partId: PartId) => void) | undefined
  onAuthoredMetadata?: AuthoredMetadataCommit | undefined

  onSourceProfilePreview?: ((profile: SketchProfileSelector | null) => void) | undefined
  sourcePreviewSketchId?: SketchId | null | undefined
  activeFeatureId: FeatureRecord["id"] | null
  activeSketchId: SketchId | null
  activeWorkspace: EditorWorkspaceName
  controller: DocumentControllerState
  onFeatureActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onFeatureDeleted: () => void
  onFeatureRemove: (
    baseRevision: number,
    featureId: FeatureRecord["id"],
  ) => Promise<FeatureMutationResult>
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onFeaturePreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onFeatureSuppressionChange: FeatureSuppressionHandler
  onFeatureVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onHistoryMove: HistoryMoveHandler
  onSketchActivate: (sketchId: SketchId) => void | boolean | Promise<boolean>
  onSketchSupportRepair: (sketchId: SketchId) => void
  onAllSketchVisibilityToggle: () => void
  onSketchRename: SketchRenameHandler
  onSketchVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  sketchRenameBlockedId: SketchId | null
  hiddenFeatureIds: readonly FeatureRecord["id"][]
  hiddenSketchIds: readonly SketchId[]
  activeBody?: ModelBodySelection | null | undefined
  onBodyActivate?: ((selection: ModelBodySelection) => void) | undefined
  onBodyPreselectionChange?: ((selection: ModelBodySelection | null) => void) | undefined
}

function authoredTreeWriteBlocked(props: ModelTreeProps) {
  return (
    props.authoredMetadataBlocked ||
    props.controller.status !== "ready" ||
    props.controller.report?.mode !== "read-write" ||
    props.controller.saveStatus === "saving" ||
    props.activeFeatureId !== null ||
    props.sketchRenameBlockedId !== null
  )
}

function ModelTreeWorkspaceItems({
  activeWorkspace,
  controller,
  onWorkspaceChange,
  origin,
  t,
}: Pick<ModelTreeProps, "activeWorkspace" | "controller" | "onWorkspaceChange" | "origin"> & {
  t: ReturnType<typeof useTranslations>
}) {
  const workspaceUnavailable = controller.status !== "ready"
  return (
    <>
      <ModelTreeRootItem
        current={activeWorkspace === "variables" ? "page" : undefined}
        tabIndex={0}
        targetWorkspace="variables"
        title={t("items.variables")}
        disabled={workspaceUnavailable}
        onWorkspaceChange={onWorkspaceChange}
      />
      {origin ? (
        <ModelBrowserOrigin {...origin} disabled={workspaceUnavailable || origin.disabled} />
      ) : (
        <ModelTreeRootItem
          targetWorkspace="model"
          title={t("items.origin")}
          disabled={workspaceUnavailable}
          onWorkspaceChange={onWorkspaceChange}
        />
      )}
    </>
  )
}

function HistorySummary({
  labelsByRef,
  row,
  t,
}: {
  labelsByRef: ReadonlyMap<string, string>
  row: HistoryViewRow
  t: ReturnType<typeof useTranslations>
}) {
  const source = historySourceSummary(row, labelsByRef, t)
  const dependencies = t("dependencySummary", {
    parents: row.dependencies.length,
    children: row.dependents.length,
  })
  if (!source && row.dependencies.length === 0 && row.dependents.length === 0) return null
  return (
    <p className="ml-8 truncate px-2 text-[10px] text-muted-foreground" title={dependencies}>
      {source ?? dependencies}
      {source ? <span className="sr-only">. {dependencies}</span> : null}
    </p>
  )
}

function historyRecordLabel(
  labelsByRef: ReadonlyMap<string, string>,
  ref: HistoryViewRow["ref"],
  fallback: string,
) {
  return labelsByRef.get(historyRefKey(ref)) || fallback
}

function historySourceSummary(
  row: HistoryViewRow,
  labelsByRef: ReadonlyMap<string, string>,
  t: ReturnType<typeof useTranslations>,
) {
  if (row.kind === "sketch") {
    const sketch = row.record as SketchRecord
    const featureId = sketch.support?.reference.featureId
    return featureId
      ? t("supportedByFeature", {
          feature: historyRecordLabel(
            labelsByRef,
            { kind: "feature", id: featureId },
            t("unnamedFeature"),
          ),
        })
      : t("supportedByPlane", { plane: sketch.plane.toUpperCase() })
  }
  const feature = row.record as FeatureRecord
  const datum = readDatumPlaneFeatureParameters(feature)
  if (!datum) return null
  if (datum.support.kind === "origin-plane") {
    return t("supportedByPlane", { plane: datum.support.plane.toUpperCase() })
  }
  return t("supportedByFeature", {
    feature: historyRecordLabel(
      labelsByRef,
      { kind: "feature", id: datum.support.reference.featureId },
      t("unnamedFeature"),
    ),
  })
}

function rollbackHistoryIndex(
  view: ReturnType<typeof selectModelTreeHistory>,
  props: ModelTreeProps,
) {
  return (
    effectiveHistoryBoundaryIndex(
      props.controller,
      view.rows.map(({ ref }) => ref),
      props.activeWorkspace === "sketch" ? props.activeSketchId : null,
      view.graphFailed,
    ) ?? view.rows.length - 1
  )
}

type ModelTreeHistoryBranchProps = ModelTreeProps & {
  view: ReturnType<typeof selectModelTreeHistory>
  t: ReturnType<typeof useTranslations>
}

type ModelTreeHistoryRowProps = ModelTreeHistoryBranchProps & {
  repairRequired?: boolean
  busy: boolean
  dragSourceKey: string | null
  dragDestinationIndex: number | null
  index: number
  marker: boolean
  rolledBack: boolean
  row: HistoryViewRow
}

function historyRowDropPreview(
  isDropTarget: boolean,
  dragSourceKey: string | null,
  dragDestinationIndex: number | null,
  rows: readonly HistoryViewRow[],
  graphComplete: boolean,
) {
  if (!isDropTarget || !dragSourceKey || dragDestinationIndex === null) return null
  return proposeHistoryMoveToIndex(rows, dragSourceKey, dragDestinationIndex, graphComplete)
}

function historyRowInsertionClass(
  dragSourceKey: string | null,
  dragDestinationIndex: number | null,
  rows: readonly HistoryViewRow[],
) {
  const sourceIndex = dragSourceKey
    ? rows.findIndex((candidate) => historyRefKey(candidate.ref) === dragSourceKey)
    : -1
  return sourceIndex >= 0 && dragDestinationIndex !== null && sourceIndex < dragDestinationIndex
    ? "border-r-2"
    : "border-l-2"
}

function historyRowDropFeedback(
  row: HistoryViewRow,
  rolledBack: boolean,
  sortable: ReturnType<typeof useSortable>,
  dragSourceKey: string | null,
  dropMove: ReturnType<typeof proposeHistoryMoveToIndex>,
  insertionClass: string,
) {
  return {
    featureKind: row.kind === "feature" ? (row.datum ? "datum" : "modeling") : undefined,
    invalid: sortable.isDropTarget && dragSourceKey !== null && !dropMove,
    className: cn(
      rolledBack && "opacity-60",
      sortable.isDragSource && "opacity-60",
      sortable.isDropTarget &&
        (dropMove
          ? cn(insertionClass, "border-primary")
          : cn(insertionClass, "border-destructive")),
    ),
  }
}

function useHistoryRowSortable({
  controller,
  dragSourceKey,
  dragDestinationIndex,
  index,
  locked,
  row,
  view,
}: {
  controller: DocumentControllerState
  dragSourceKey: string | null
  dragDestinationIndex: number | null
  index: number
  locked: boolean
  row: HistoryViewRow
  view: ModelTreeHistoryBranchProps["view"]
}) {
  const sortable = useSortable({
    id: historyRefKey(row.ref),
    index,
    disabled: locked || !historyMoveIsAvailable(controller, null, null, true),
    plugins: [],
  })
  const dropMove = historyRowDropPreview(
    sortable.isDropTarget,
    dragSourceKey,
    dragDestinationIndex,
    view.rows,
    !view.graphFailed && !view.reorderUnavailable,
  )
  const insertionClass = historyRowInsertionClass(dragSourceKey, dragDestinationIndex, view.rows)
  return { sortable, dropMove, insertionClass }
}

function historyRowReorderIsLocked(
  rolledBack: boolean,
  busy: boolean,
  activeSketchId: SketchId | null,
  activeFeatureId: FeatureRecord["id"] | null,
  view: ModelTreeHistoryBranchProps["view"],
) {
  return (
    rolledBack ||
    busy ||
    activeSketchId !== null ||
    activeFeatureId !== null ||
    view.reorderUnavailable
  )
}

type HistoryRowFrameProps = Pick<
  ModelTreeHistoryRowProps,
  | "busy"
  | "dragDestinationIndex"
  | "dragSourceKey"
  | "index"
  | "marker"
  | "rolledBack"
  | "row"
  | "t"
  | "view"
> & {
  content: ReactNode
  repairRequired?: boolean | undefined
  details?: ReactNode
  sourcePresentation: { summary: ReactNode; highlighted: boolean }
  controller: DocumentControllerState
  activeSketchId: SketchId | null
  activeFeatureId: FeatureRecord["id"] | null
}

function historyRowStateData(
  feedback: ReturnType<typeof historyRowDropFeedback>,
  rolledBack: boolean,
  reorderLocked: boolean,
  sourceHighlighted: boolean,
) {
  return {
    "data-history-feature-kind": feedback.featureKind,
    "data-history-rolled-back": rolledBack ? "true" : undefined,
    "data-history-drop-invalid": feedback.invalid ? "true" : undefined,
    "data-history-reorder-disabled": reorderLocked ? "true" : undefined,
    "data-history-source-highlighted": sourceHighlighted ? "true" : undefined,
  }
}

function HistoryRowDetails({
  compact,
  details,
  marker,
  repairRequired,
  summary,
  t,
}: Pick<HistoryRowFrameProps, "details" | "marker" | "repairRequired" | "t"> & {
  compact: boolean
  summary: ReactNode
}) {
  return (
    <>
      <div hidden={compact}>
        {summary}
        {details}
      </div>
      {compact && repairRequired && (
        <span
          role="img"
          aria-label={t("repairRequired")}
          className="absolute bottom-0 right-0 text-destructive"
        >
          <CircleAlert aria-hidden="true" className="size-3" />
        </span>
      )}
      {marker && (
        <div
          role="status"
          className={compact ? "sr-only" : "px-2 text-[11px] text-muted-foreground"}
        >
          <span className={compact ? "sr-only" : undefined}>{t("rollbackMarker")}</span>
        </div>
      )}
    </>
  )
}

function historyRowLayout(timeline: boolean, compact: boolean) {
  if (!timeline) return undefined
  return compact ? "relative w-12 shrink-0 px-2 py-1" : "relative w-64 shrink-0 border-r px-2 py-2"
}

function HistoryRowPresentation({
  content,
  details,
  feedback,
  index,
  marker,
  repairRequired,
  reorderLocked,
  rolledBack,
  row,
  sortableRef,
  summaryLabels,
  sourcePresentation,
  t,
}: Pick<
  HistoryRowFrameProps,
  | "content"
  | "details"
  | "index"
  | "sourcePresentation"
  | "marker"
  | "repairRequired"
  | "rolledBack"
  | "row"
  | "t"
> & {
  feedback: ReturnType<typeof historyRowDropFeedback>
  reorderLocked: boolean
  sortableRef: (element: Element | null) => void
  summaryLabels: ReturnType<typeof selectModelTreeHistory>["labelsByRef"]
}) {
  const { timeline, detailed } = useContext(HistoryPresentation)
  const compact = timeline && !detailed
  return (
    <div
      ref={sortableRef}
      role="none"
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          event.currentTarget.querySelector<HTMLElement>('[role="treeitem"]')?.focus()
      }}
      data-history-kind={row.kind}
      data-history-id={row.ref.id}
      data-history-index={index}
      {...historyRowStateData(feedback, rolledBack, reorderLocked, sourcePresentation.highlighted)}
      className={cn(
        historyRowLayout(timeline, compact),
        feedback.className,
        sourcePresentation.highlighted && "bg-accent ring-1 ring-primary ring-inset",
        !reorderLocked &&
          "cursor-grab active:cursor-grabbing [&_[role=treeitem]]:cursor-grab [&_[role=treeitem]]:active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">{content}</div>
      </div>
      <HistoryRowDetails
        compact={compact}
        details={details}
        marker={marker}
        repairRequired={repairRequired}
        summary={
          sourcePresentation.summary ?? (
            <HistorySummary labelsByRef={summaryLabels} row={row} t={t} />
          )
        }
        t={t}
      />
    </div>
  )
}

function HistoryRowFrame(props: HistoryRowFrameProps) {
  const { busy, rolledBack, view, controller, activeSketchId, activeFeatureId } = props
  const reorderLocked =
    historyRowReorderIsLocked(rolledBack, busy, activeSketchId, activeFeatureId, view) ||
    !historyMoveIsAvailable(controller, activeSketchId, activeFeatureId, true)
  const { sortable, dropMove, insertionClass } = useHistoryRowSortable({
    controller,
    dragDestinationIndex: props.dragDestinationIndex,
    dragSourceKey: props.dragSourceKey,
    index: props.index,
    locked: reorderLocked,
    row: props.row,
    view,
  })
  const feedback = historyRowDropFeedback(
    props.row,
    rolledBack,
    sortable,
    props.dragSourceKey,
    dropMove,
    insertionClass,
  )
  return (
    <HistoryRowPresentation
      {...props}
      feedback={feedback}
      reorderLocked={reorderLocked}
      sortableRef={sortable.ref}
      summaryLabels={view.labelsByRef}
    />
  )
}

function SketchHistoryRow({
  busy,
  dragDestinationIndex,
  dragSourceKey,
  index,
  marker,
  rolledBack,
  row,
  t,
  view,
  ...props
}: ModelTreeHistoryRowProps) {
  const sketch = row.record as SketchRecord
  return (
    <HistoryRowFrame
      repairRequired={
        props.repairRequired ||
        brokenReferenceCount(row.referenceHealth) > 0 ||
        row.supportHealth?.status === "missing" ||
        row.supportHealth?.status === "ambiguous"
      }
      sourcePresentation={{
        highlighted: props.sourcePreviewSketchId === sketch.id,
        summary: undefined,
      }}
      activeFeatureId={props.activeFeatureId}
      activeSketchId={props.activeSketchId}
      busy={busy}
      controller={props.controller}
      dragDestinationIndex={dragDestinationIndex}
      dragSourceKey={dragSourceKey}
      index={index}
      marker={marker}
      rolledBack={rolledBack}
      row={row}
      t={t}
      view={view}
      details={
        <>
          {props.repairRequired && (
            <p role="status" className="px-2 text-xs text-destructive">
              {t("repairRequired")}
            </p>
          )}
          <SketchReferenceHealthSummary health={row.referenceHealth} t={t} />
          <SketchSupportHealthSummary health={row.supportHealth} t={t} />
        </>
      }
      content={
        <SketchTreeItem
          active={row.ref.id === props.activeSketchId}
          controller={props.controller}
          deletionBlocked={view.graphFailed || view.reorderUnavailable}
          onActivate={props.onSketchActivate}
          onSketchSupportRepair={props.onSketchSupportRepair}
          onFeatureRename={props.onFeatureRename}
          onSketchDeleted={props.onSketchDeleted}
          onSketchRemove={props.onSketchRemove}
          onSketchRename={props.onSketchRename}
          onVisibilityChange={props.onSketchVisibilityChange}
          renameBlocked={row.ref.id === props.sketchRenameBlockedId}
          row={row}
          unnamedSketch={t("unnamedSketch")}
          visible={!props.hiddenSketchIds.includes(row.ref.id as SketchId)}
        />
      }
    />
  )
}

function historyFeatureDeleteIsUnavailable(
  props: ModelTreeProps,
  busy: boolean,
  rolledBack: boolean,
  view: ReturnType<typeof selectModelTreeHistory>,
) {
  return (
    busy ||
    rolledBack ||
    authoredTreeWriteBlocked(props) ||
    props.activeSketchId !== null ||
    view.graphFailed ||
    view.reorderUnavailable
  )
}

function FeatureHistoryRow({
  busy,
  dragDestinationIndex,
  dragSourceKey,
  index,
  rolledBack,
  row,
  t,
  view,
  ...props
}: ModelTreeHistoryRowProps) {
  const feature = row.record as FeatureRecord
  const profiles = readExtrusionProfileSet(feature) ?? readRevolveProfileSet(feature)
  const result = view.modelBodies.find((body) => body.geometry.featureId === feature.id)
  const revealResult =
    result && props.onRevealFeature && !rolledBack
      ? () => {
          const part = currentAuthoredParts(props.controller).find(
            ({ body }) =>
              body?.featureId === result.geometry.featureId &&
              body.outputRole === result.geometry.outputRole,
          )
          if (part && props.onPartSelect) props.onPartSelect(part.part.id)
          else
            props.onBodyActivate?.({
              featureId: result.geometry.featureId,
              ...(result.geometry.outputRole === undefined
                ? {}
                : { outputRole: result.geometry.outputRole }),
            })
          props.onRevealFeature?.(feature.id)
        }
      : undefined
  return (
    <HistoryRowFrame
      repairRequired={props.repairRequired}
      activeFeatureId={props.activeFeatureId}
      activeSketchId={props.activeSketchId}
      busy={busy}
      controller={props.controller}
      dragDestinationIndex={dragDestinationIndex}
      dragSourceKey={dragSourceKey}
      index={index}
      marker={props.marker}
      sourcePresentation={{
        highlighted: row.ref.id === props.highlightedFeatureId,
        summary: profiles ? (
          <HistoryProfileSources
            profiles={profiles.profiles}
            labelsByRef={view.labelsByRef}
            onPreview={props.onSourceProfilePreview}
            onOpen={props.onSketchActivate}
            dependencyDescription={t("dependencySummary", {
              parents: row.dependencies.length,
              children: row.dependents.length,
            })}
          />
        ) : undefined,
      }}
      details={
        props.repairRequired ? (
          <p role="status" className="px-2 text-xs text-destructive">
            {t("repairRequired")}
          </p>
        ) : undefined
      }
      rolledBack={rolledBack}
      row={row}
      t={t}
      view={view}
      content={
        <FeatureTreeItem
          onFindInBrowser={revealResult}
          active={
            row.ref.id === props.activeFeatureId || row.ref.id === props.selectedResultFeatureId
          }
          controller={props.controller}
          historyActions={{
            disabled: historyFeatureDeleteIsUnavailable(props, busy, rolledBack, view),
            onDeleted: props.onFeatureDeleted,
            onRemove: props.onFeatureRemove,
          }}
          feature={feature}
          onActivate={props.onFeatureActivate}
          onFeatureRename={props.onFeatureRename}
          onPreselectionChange={props.onFeaturePreselectionChange}
          onSuppressionChange={props.onFeatureSuppressionChange}
          onVisibilityChange={props.onFeatureVisibilityChange}
          onSketchRename={props.onSketchRename}
          unnamedFeature={t("unnamedFeature")}
          visible={!props.hiddenFeatureIds.includes(row.ref.id as FeatureRecord["id"])}
        />
      }
    />
  )
}

function HistoryGroup({
  expanded,
  onDetailedChange,
  onExpandedChange,
  rollbackIndex,
  ...props
}: ModelTreeHistoryBranchProps & {
  expanded: boolean
  onDetailedChange: () => void
  onExpandedChange: (expanded: boolean) => void
  rollbackIndex: number
}) {
  const { t, view } = props
  const { detailed } = useContext(HistoryPresentation)
  const { authority, repairIds, insertionDisabled, folderGroups } = useMemo(
    () => authoredHistoryTreeState(props.controller, view.rows),
    [props.controller, view.rows],
  )
  const metadataDisabled = authoredTreeWriteBlocked(props)
  const [busy, setBusy] = useState(false)
  const [dragSourceKey, setDragSourceKey] = useState<string | null>(null)
  const [dragDestinationIndex, setDragDestinationIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const busyRef = useRef(false)
  const dragDestinationIndexRef = useRef<number | null>(null)
  const dragBoundaryRef = useRef<HistoryDragBoundary | null>(null)
  const completeGraph = !view.graphFailed && !view.reorderUnavailable
  const itemLabel = (key: string) => {
    const row = view.rows.find((candidate) => historyRefKey(candidate.ref) === key)
    if (!row) return ""
    return row.record.label || t(row.kind === "sketch" ? "unnamedSketch" : "unnamedFeature")
  }
  const performMove = (move: ReturnType<typeof proposeHistoryMoveToIndex>, revision: number) => {
    if (!move || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    void props
      .onHistoryMove(revision, move.item, move.historyAfter)
      .then((result) => {
        setAnnouncement(
          result.ok
            ? t("historyMoved", {
                item: itemLabel(historyRefKey(move.item)),
                position:
                  move.rows.findIndex(
                    (row) => historyRefKey(row.ref) === historyRefKey(move.item),
                  ) + 1,
              })
            : t("historyMoveCancelled"),
        )
      })
      .catch(() => setAnnouncement(t("historyMoveCancelled")))
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const destinationIndex = dragDestinationIndexRef.current
    dragDestinationIndexRef.current = null
    const boundary = dragBoundaryRef.current
    dragBoundaryRef.current = null
    setDragSourceKey(null)
    setDragDestinationIndex(null)
    const drop = resolveHistoryDrop(
      event,
      boundary,
      props.controller.report,
      rollbackIndex,
      destinationIndex,
      historyMoveIsAvailable(
        props.controller,
        props.activeSketchId,
        props.activeFeatureId,
        completeGraph,
      ),
    )
    if (!drop) {
      setAnnouncement(t("historyMoveCancelled"))
      return
    }
    const { source } = drop
    const move = proposeHistoryMoveToIndex(
      view.rows,
      String(source.id),
      drop.destinationIndex,
      completeGraph,
    )
    if (!move) {
      setAnnouncement(
        source.initialIndex === drop.destinationIndex
          ? t("historyMoveCancelled")
          : t("historyDragInvalid", { item: itemLabel(String(source.id)) }),
      )
      return
    }
    performMove(move, drop.boundary.revision)
    setAnnouncement(
      t("historyDragDropped", {
        item: itemLabel(String(source.id)),
        position: move.rows.findIndex((row) => historyRefKey(row.ref) === String(source.id)) + 1,
        count: move.rows.length,
      }),
    )
  }
  return (
    <div role="none">
      <HistoryFolderSelection
        authority={authority}
        rows={view.rows}
        disabled={metadataDisabled || !completeGraph || busy}
        onCommit={props.onAuthoredMetadata}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1 border-b px-2">
          <ModelTreeGroupItem
            className="w-auto shrink-0"
            expanded={expanded}
            onExpandedChange={onExpandedChange}
            title={t("items.history")}
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {view.rows.length}
          </span>
          <HistoryNavigationControls />
          <div className="min-w-0 flex-1" />
          {expanded && <HistoryFolderSelectionControls compact />}
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={detailed}
            disabled={!expanded}
            onClick={onDetailedChange}
          >
            <ListFilter aria-hidden="true" className="size-3.5" />
            {t("timelineDetails")}
          </Button>
        </div>
        {expanded && (
          <fieldset className="contents">
            <legend className="sr-only">{t("items.history")}</legend>
            <p id="history-drag-instructions" className="sr-only">
              {t("historyDragInstructions", { item: t("items.history") })}
            </p>
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {announcement}
            </div>
            {view.graphFailed && (
              <p role="status" className="px-2 text-xs text-muted-foreground">
                {t("historyUnavailable")}
              </p>
            )}
            <DragDropProvider
              // The tree owns localized announcements and selection semantics, even when reorder is locked.
              plugins={(defaults) => defaults.filter((plugin) => plugin !== Accessibility)}
              sensors={[HISTORY_POINTER_SENSOR]}
              onDragStart={(event) => {
                if (!isSortable(event.operation.source)) return
                const source = event.operation.source
                const report = props.controller.report
                if (!report || !source) return
                dragBoundaryRef.current = {
                  documentId: report.snapshot.id,
                  revision: report.snapshot.revision,
                  rollbackIndex,
                }
                dragDestinationIndexRef.current = source.initialIndex
                setDragDestinationIndex(source.initialIndex)
                setDragSourceKey(String(source.id))
                setAnnouncement(
                  t("historyDragStarted", {
                    item: itemLabel(String(source.id)),
                    position: source.initialIndex + 1,
                    count: view.rows.length,
                  }),
                )
              }}
              onDragOver={(event) => {
                if (!isSortableOperation(event.operation)) return
                const { source, target } = event.operation
                if (!source || !target) return
                dragDestinationIndexRef.current = target.index
                setDragDestinationIndex(target.index)
                if (String(source.id) === String(target.id)) {
                  setAnnouncement(
                    t("historyDragOver", {
                      item: itemLabel(String(source.id)),
                      position: source.initialIndex + 1,
                      count: view.rows.length,
                    }),
                  )
                  return
                }
                const move = proposeHistoryMoveToIndex(
                  view.rows,
                  String(source.id),
                  target.index,
                  completeGraph,
                )
                setAnnouncement(
                  move
                    ? t("historyDragOver", {
                        item: itemLabel(String(source.id)),
                        position:
                          move.rows.findIndex(
                            (row) => historyRefKey(row.ref) === String(source.id),
                          ) + 1,
                        count: move.rows.length,
                      })
                    : t("historyDragInvalid", { item: itemLabel(String(source.id)) }),
                )
              }}
              onDragEnd={handleDragEnd}
            >
              <div
                className="relative flex min-w-0 items-start overflow-auto pl-2 pr-8"
                data-history-track
              >
                {folderGroups.map((group) => {
                  const rows = group.rows.map(({ row, index }) => {
                    const insert = props.onHistoryInsert
                    const rowProps = {
                      ...props,
                      busy,
                      dragDestinationIndex,
                      dragSourceKey,
                      index,
                      row,
                      repairRequired: repairIds.has(historyRefKey(row.ref)),
                      rolledBack:
                        (Boolean(props.controller.historyInsertion) || rollbackIndex >= 0) &&
                        index > rollbackIndex,
                      marker: rollbackIndex === index && index < view.rows.length - 1,
                    }
                    return (
                      <HistoryFolderSelectableRow
                        key={historyRefKey(row.ref)}
                        row={row}
                        insertionDisabled={insertionDisabled}
                        onInsert={insert ? (side) => insert(row.ref, side) : undefined}
                      >
                        {row.kind === "sketch" ? (
                          <SketchHistoryRow {...rowProps} />
                        ) : (
                          <FeatureHistoryRow {...rowProps} />
                        )}
                      </HistoryFolderSelectableRow>
                    )
                  })
                  return group.folder && authority && props.onAuthoredMetadata ? (
                    <HistoryFolderGroup
                      key={group.folder.id}
                      folder={group.folder}
                      horizontal
                      authority={authority}
                      rows={view.rows}
                      disabled={metadataDisabled || !completeGraph || busy}
                      onCommit={props.onAuthoredMetadata}
                    >
                      {rows}
                    </HistoryFolderGroup>
                  ) : (
                    rows
                  )
                })}
                {view.rows.length === 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">{t("emptyHistory")}</p>
                )}
                <HistoryTimelineCursor />
              </div>
            </DragDropProvider>
          </fieldset>
        )}
      </HistoryFolderSelection>
    </div>
  )
}

function BodiesGroup({
  expanded,
  onExpandedChange,
  ...props
}: ModelTreeHistoryBranchProps & {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const { t, view } = props
  const authoredT = useTranslations("app.authoredTree")
  const authority = currentAuthoredSnapshot(props.controller)
  const owned = authority ? authoredBodyKeys(authority) : new Set<string>()
  const bodies = view.modelBodies.filter(({ geometry }) => !owned.has(authoredBodyKey(geometry)))
  if (authority && bodies.length === 0) return null
  return (
    <div role="none">
      <ModelTreeGroupItem
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        title={authority ? authoredT("otherBodies") : t("items.bodies")}
        count={bodies.length}
        icon={<Cuboid aria-hidden="true" className="size-4 text-muted-foreground" />}
      />
      {expanded && (
        <fieldset className="contents">
          <legend className="sr-only">{t("items.bodies")}</legend>
          {bodies.map((body, index) => {
            const { feature, geometry } = body
            const label = t("bodyLabel", { number: index + 1 })
            const source = t("bodySource", {
              feature: feature.label || t("unnamedFeature"),
            })
            const bodyKey = `${feature.id}\u0000${geometry.outputRole ?? ""}`
            const bodyId =
              geometry.outputRole === undefined ? feature.id : encodeURIComponent(bodyKey)
            const sourceId = `body-source-${bodyId}`
            const selection: ModelBodySelection = {
              featureId: feature.id,
              ...(geometry.outputRole === undefined ? {} : { outputRole: geometry.outputRole }),
            }
            const namedBody = geometry.outputRole !== undefined
            const active = props.activeBody
              ? props.activeBody.featureId === selection.featureId &&
                props.activeBody.outputRole === selection.outputRole
              : !namedBody && feature.id === props.activeFeatureId
            return (
              <div
                key={`body:${bodyKey}`}
                role="none"
                data-body-id={bodyId}
                data-feature-id={feature.id}
                onPointerEnter={() =>
                  namedBody
                    ? props.onBodyPreselectionChange?.(selection)
                    : props.onFeaturePreselectionChange(feature.id)
                }
                onPointerLeave={() =>
                  namedBody
                    ? props.onBodyPreselectionChange?.(null)
                    : props.onFeaturePreselectionChange(null)
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={cn(
                    "w-full justify-start pl-6 font-normal text-muted-foreground",
                    active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
                  )}
                  role="treeitem"
                  tabIndex={-1}
                  aria-selected={active}
                  aria-label={label}
                  aria-describedby={sourceId}
                  onClick={() =>
                    props.onBodyActivate
                      ? props.onBodyActivate?.(selection)
                      : props.onFeatureActivate(feature.id)
                  }
                  onFocus={() =>
                    namedBody
                      ? props.onBodyPreselectionChange?.(selection)
                      : props.onFeaturePreselectionChange(feature.id)
                  }
                  onBlur={() =>
                    namedBody
                      ? props.onBodyPreselectionChange?.(null)
                      : props.onFeaturePreselectionChange(null)
                  }
                >
                  <Cuboid aria-hidden="true" className="mr-1 size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </Button>
                <p id={sourceId} className="ml-8 truncate px-2 text-[10px] text-muted-foreground">
                  {source}
                </p>
              </div>
            )
          })}
        </fieldset>
      )}
    </div>
  )
}

function SketchesGroup(props: ModelTreeHistoryBranchProps) {
  const [sketchesExpanded, setSketchesExpanded] = useState(true)
  const sketches = props.view.rows.filter((row) => row.kind === "sketch")
  return (
    <div role="none">
      <div className="flex min-w-0 items-center">
        <ModelTreeGroupItem
          className="min-w-0 flex-1"
          count={sketches.length}
          icon={<PenLine aria-hidden="true" className="size-4 text-muted-foreground" />}
          expanded={sketchesExpanded}
          onExpandedChange={setSketchesExpanded}
          title={props.t("items.sketches")}
        />
        <AllSketchVisibilityAction {...props} />
      </div>
      {sketchesExpanded && (
        <fieldset className="contents">
          <legend className="sr-only">{props.t("items.sketches")}</legend>
          {sketches.map((row) => (
            <SketchTreeItem
              key={historyRefKey(row.ref)}
              active={row.ref.id === props.activeSketchId}
              controller={props.controller}
              deletionBlocked={props.view.graphFailed || props.view.reorderUnavailable}
              onActivate={props.onSketchActivate}
              onSketchSupportRepair={props.onSketchSupportRepair}
              onFeatureRename={props.onFeatureRename}
              onSketchDeleted={props.onSketchDeleted}
              onSketchRemove={props.onSketchRemove}
              onSketchRename={props.onSketchRename}
              onVisibilityChange={props.onSketchVisibilityChange}
              renameBlocked={row.ref.id === props.sketchRenameBlockedId}
              row={row}
              unnamedSketch={props.t("unnamedSketch")}
              visible={!props.hiddenSketchIds.includes(row.ref.id as SketchId)}
            />
          ))}
          {sketches.length === 0 && (
            <div className="grid gap-2 px-6 py-2">
              <p className="text-xs text-muted-foreground">{props.t("noSketches")}</p>
              {props.onCreateSketch && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={
                    props.controller.status !== "ready" ||
                    props.controller.report?.mode !== "read-write" ||
                    Boolean(props.authoredMetadataBlocked)
                  }
                  onClick={props.onCreateSketch}
                >
                  <PenLine aria-hidden="true" className="size-3.5" />
                  {props.t("createSketch")}
                </Button>
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}

function ModelTreeHistoryBranch(props: ModelTreeHistoryBranchProps) {
  const [bodiesExpanded, setBodiesExpanded] = useState(true)
  useEffect(() => {
    if (props.revealRequest) setBodiesExpanded(true)
  }, [props.revealRequest])
  const bodyController = useMemo(
    () => historyInsertionContext(props.controller),
    [props.controller],
  )
  const parts = useMemo(() => currentAuthoredParts(bodyController), [bodyController])
  const bodyView = useMemo(() => {
    if (bodyController === props.controller) return props.view
    const report = bodyController.report
    if (!report) return props.view
    return selectModelTreeHistory(
      report.snapshot,
      report.rebuild.ok ? report.rebuild.response.modelReferenceEvidence : undefined,
      report.rebuild.ok ? report.rebuild.response : undefined,
      report.historyItems,
    )
  }, [bodyController, props.controller, props.view])
  return (
    <>
      {currentAuthoredSnapshot(props.controller) &&
        props.onAuthoredMetadata &&
        props.onPartSelect && (
          <AuthoredPartsGroup
            revealRequest={props.revealRequest ?? null}
            parts={parts}
            revision={props.controller.report?.snapshot.revision ?? 0}
            selectedPartId={props.selectedPartId ?? null}
            disabled={authoredTreeWriteBlocked(props)}
            selectionRequiresBody={bodyController !== props.controller}
            onSelect={(partId) => {
              if (bodyController !== props.controller && !selectedAuthoredBody(parts, partId))
                return
              props.onPartSelect?.(partId)
            }}
            onPreselect={props.onBodyPreselectionChange}
            onSurfaceTexture={props.onSurfaceTexture}
            onCommit={props.onAuthoredMetadata}
          />
        )}
      <BodiesGroup
        {...props}
        controller={bodyController}
        view={bodyView}
        expanded={bodiesExpanded}
        onExpandedChange={setBodiesExpanded}
      />
      <SketchesGroup {...props} />
      {props.onSurfaceTexture && (
        <SurfaceTextureTreeGroup
          controller={props.controller}
          disabled={Boolean(props.authoredMetadataBlocked)}
          onEdit={props.onSurfaceTexture}
        />
      )}
    </>
  )
}

function visibleTreeItems(tree: HTMLElement) {
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]:not([disabled])')]
}

const treeNavigationKeys = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowRight",
  "ArrowLeft",
  "Home",
  "End",
])

function linearTreeTarget(key: string, items: readonly HTMLElement[], index: number) {
  if (key === "ArrowDown") return items[index + 1] ?? items[0]
  if (key === "ArrowUp") return items[index - 1] ?? items.at(-1)
  if (key === "Home") return items[0]
  if (key === "End") return items.at(-1)
  return undefined
}

function firstTreeChild(current: HTMLElement) {
  const selector = ':scope > fieldset [role="treeitem"]'
  return (
    current.parentElement?.querySelector<HTMLElement>(selector) ??
    current.parentElement?.parentElement?.querySelector<HTMLElement>(selector) ??
    undefined
  )
}

function parentTreeItem(current: HTMLElement) {
  const parent = current.closest<HTMLElement>("fieldset")?.previousElementSibling
  return parent?.matches('[role="treeitem"]')
    ? (parent as HTMLElement)
    : (parent?.querySelector<HTMLElement>('[role="treeitem"]') ?? undefined)
}

function hierarchicalTreeTarget(key: string, current: HTMLElement) {
  if (key === "ArrowRight") {
    if (current.getAttribute("aria-expanded") === "false") current.click()
    return current.getAttribute("aria-expanded") === "true" ? firstTreeChild(current) : undefined
  }
  if (key === "ArrowLeft") {
    if (current.getAttribute("aria-expanded") === "true") current.click()
    return current.getAttribute("aria-expanded") === null ? parentTreeItem(current) : undefined
  }
  return undefined
}

function moveTreeFocus(event: KeyboardEvent<HTMLElement>, horizontal = false) {
  if (event.defaultPrevented || !treeNavigationKeys.has(event.key)) return
  const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
  if (!current) return
  const items = visibleTreeItems(event.currentTarget)
  const key = horizontal
    ? ({
        ArrowLeft: "ArrowUp",
        ArrowRight: "ArrowDown",
        ArrowUp: "ArrowLeft",
        ArrowDown: "ArrowRight",
      }[event.key] ?? event.key)
    : event.key
  const next =
    linearTreeTarget(key, items, items.indexOf(current)) ?? hierarchicalTreeTarget(key, current)
  event.preventDefault()
  next?.focus()
}

function findModelTreeRow(
  root: HTMLElement | null,
  attribute: "data-feature-id" | "data-history-id",
  id: string,
) {
  if (!root) return undefined
  return [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
    (item) => item.getAttribute(attribute) === id,
  )
}

function ensureTreeTabStop(root: HTMLElement | null) {
  if (!root) return
  const items = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]
  const first = items[0]
  if (first && !items.some((item) => item.tabIndex === 0)) first.tabIndex = 0
}

function ModelTimeline(props: ModelTreeHistoryBranchProps) {
  const [expanded, setExpanded] = useState(true)
  const [detailed, setDetailed] = useState(false)
  const orderedRefs = useMemo(() => props.view.rows.map((row) => row.ref), [props.view.rows])
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    ensureTreeTabStop(root.current)
    const activeId = props.activeSketchId ?? props.activeFeatureId ?? props.selectedResultFeatureId
    if (!activeId) return
    const row = findModelTreeRow(root.current, "data-history-id", activeId)
    row?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [
    expanded,
    props.activeFeatureId,
    props.activeSketchId,
    props.selectedResultFeatureId,
    props.view.rows,
  ])
  return (
    <HistoryNavigationProvider
      key={props.controller.report?.snapshot.id}
      controller={props.controller}
      activeWorkspace={props.activeWorkspace}
      activeSketchId={props.activeSketchId}
      orderedRefs={orderedRefs}
      graphFailed={props.view.graphFailed}
      onInsert={props.onHistoryInsert}
      onReturnToEnd={props.onHistoryReturnToEnd}
    >
      <HistoryPresentation value={{ timeline: true, detailed }}>
        <section
          ref={root}
          aria-label={props.t("timelineLabel")}
          className="max-h-56 min-w-0 shrink-0 overflow-y-auto border-t bg-panel"
          data-feature-timeline
        >
          <div
            role="tree"
            aria-label={props.t("timelineLabel")}
            aria-orientation="horizontal"
            onFocusCapture={updateTreeTabStop}
            onKeyDown={(event) => moveTreeFocus(event, true)}
          >
            <HistoryGroup
              {...props}
              expanded={expanded}
              onExpandedChange={setExpanded}
              onDetailedChange={() => setDetailed((value) => !value)}
              rollbackIndex={rollbackHistoryIndex(props.view, props)}
            />
          </div>
        </section>
      </HistoryPresentation>
    </HistoryNavigationProvider>
  )
}

function updateTreeTabStop(event: FocusEvent<HTMLElement>) {
  const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
  if (!current) return
  for (const item of visibleTreeItems(event.currentTarget))
    item.tabIndex = item === current ? 0 : -1
}

function AllSketchVisibilityAction(props: ModelTreeHistoryBranchProps) {
  const { t, view } = props
  const sketchIds = view.rows
    .filter((row) => row.kind === "sketch")
    .map((row) => row.ref.id as SketchId)
  const allSketchesHidden =
    sketchIds.length > 0 && sketchIds.every((id) => props.hiddenSketchIds.includes(id))
  const visibleSketchCount = sketchIds.filter((id) => !props.hiddenSketchIds.includes(id)).length
  const sketchVisibilityPressed =
    visibleSketchCount === 0
      ? false
      : visibleSketchCount === sketchIds.length
        ? true
        : ("mixed" as const)
  const sketchVisibilityLabel = t(allSketchesHidden ? "showAllSketches" : "hideAllSketches")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={sketchVisibilityLabel}
          aria-pressed={sketchVisibilityPressed}
          disabled={sketchIds.length === 0}
          onClick={props.onAllSketchVisibilityToggle}
        >
          {allSketchesHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t("sketchVisibilityShortcut", { action: sketchVisibilityLabel })}
      </TooltipContent>
    </Tooltip>
  )
}

export function ModelTree(props: ModelTreeProps) {
  const t = useTranslations("app.shell.modelTree")
  const browser = useRef<HTMLElement>(null)
  useEffect(() => {
    const request = props.revealRequest
    if (!request || props.surface === "timeline") return
    const frame = requestAnimationFrame(() => {
      const target = findModelTreeRow(browser.current, "data-feature-id", request.featureId)
      target?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
      target?.querySelector<HTMLElement>('[role="treeitem"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [props.revealRequest, props.surface])
  const report = props.controller.report
  const snapshot = report?.snapshot
  const rebuild = report?.rebuild
  const modelReferenceEvidence = rebuild?.ok ? rebuild.response.modelReferenceEvidence : undefined
  const rebuiltResponse = rebuild?.ok ? rebuild.response : undefined
  const historyView = useMemo(
    () =>
      selectModelTreeHistory(
        {
          sketches: snapshot?.sketches ?? [],
          features: snapshot?.features ?? [],
        },
        modelReferenceEvidence,
        rebuiltResponse,
        report?.historyItems,
      ),
    [modelReferenceEvidence, rebuiltResponse, report?.historyItems, snapshot],
  )
  if (props.surface === "timeline") return <ModelTimeline {...props} t={t} view={historyView} />

  return (
    <aside
      ref={browser}
      aria-label={t("ariaLabel")}
      className="min-h-0 overflow-auto border-r bg-panel p-2"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Cuboid aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("title")}
          </h2>
          {snapshot?.name && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={snapshot.name}>
              {snapshot.name}
            </p>
          )}
        </div>
      </div>
      <div
        className="mt-1 grid grid-cols-1 gap-0.5"
        role="tree"
        aria-label={t("projectFeatures")}
        onFocusCapture={updateTreeTabStop}
        onKeyDown={moveTreeFocus}
      >
        <ModelTreeWorkspaceItems {...props} t={t} />
        <ModelTreeHistoryBranch {...props} t={t} view={historyView} />
      </div>
    </aside>
  )
}
