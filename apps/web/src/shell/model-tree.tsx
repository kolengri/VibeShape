import {
  type FeatureRecord,
  type HistoryItemRef,
  isSketchExternalModelReference,
  readDatumPlaneFeatureParameters,
  readExtrusionFeatureParameters,
  readRevolveFeatureParameters,
  type SketchId,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  CirclePause,
  CirclePlay,
  Cuboid,
  Eye,
  EyeOff,
  Layers3,
  PenLine,
} from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { type FocusEvent, type KeyboardEvent, type ReactNode, useMemo, useState } from "react"
import type { SemanticRenameResult } from "../components/semantic-rename-dialog"
import type {
  DocumentControllerState,
  DocumentMutationResult,
} from "../document/document-controller"
import type { ModelBodySelection } from "../features/part-design/model-bodies"
import { SketchDeleteAction } from "../features/sketch/sketch-delete-action"
import { type HistoryViewRow, historyRefKey, selectModelTreeHistory } from "./model-tree-history"
import { ModelTreeRenameDialog } from "./model-tree-rename-dialog"
import type { EditorWorkspaceName } from "./workspace"

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

type SketchRenameHandler = (
  baseRevision: number,
  sketch: SketchRecord,
) => Promise<SemanticRenameResult>

type SketchRemoveHandler = (
  baseRevision: number,
  sketchId: SketchId,
) => Promise<DocumentMutationResult>

function sketchHasDependents(
  sketch: SketchRecord,
  features: readonly FeatureRecord[],
  sketches: readonly SketchRecord[],
) {
  return (
    features.some(
      (feature) => readExtrusionFeatureParameters(feature)?.profile.sketchId === sketch.id,
    ) ||
    sketches.some((candidate) =>
      (candidate.externalReferences ?? []).some(
        (reference) =>
          !isSketchExternalModelReference(reference) && reference.sourceSketchId === sketch.id,
      ),
    )
  )
}

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

function FeatureSuppressionAction({
  controller,
  feature,
  label,
  onChange,
}: {
  controller: DocumentControllerState
  feature: FeatureRecord
  label: string
  onChange: FeatureSuppressionHandler
}) {
  const t = useTranslations("app.shell.modelTree")
  const actionLabel = t(feature.suppressed ? "unsuppressFeature" : "suppressFeature", {
    feature: label,
  })
  const disabled = controller.status !== "ready" || controller.report?.mode !== "read-write"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={actionLabel}
          aria-pressed={feature.suppressed}
          disabled={disabled}
          onClick={() =>
            onChange(controller.report?.snapshot.revision ?? 0, feature.id, !feature.suppressed)
          }
        >
          {feature.suppressed ? (
            <CirclePlay aria-hidden="true" />
          ) : (
            <CirclePause aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  )
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
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn(
        "min-w-0 flex-1 justify-start pl-6 font-normal",
        active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
        feature.suppressed && "text-muted-foreground line-through decoration-dotted",
      )}
      role="treeitem"
      tabIndex={-1}
      aria-selected={active}
      onClick={() => onActivate(feature.id)}
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
        <Cuboid aria-hidden="true" className="mr-1 size-4 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </Button>
  )
}

function FeatureTreeItem({
  active,
  controller,
  feature,
  onActivate,
  onFeatureRename,
  onPreselectionChange,
  onSuppressionChange,
  onVisibilityChange,
  onSketchRename,
  unnamedFeature,
  visible,
}: {
  active: boolean
  controller: DocumentControllerState
  feature: FeatureRecord
  onActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onPreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onSuppressionChange: FeatureSuppressionHandler
  onVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
  visible: boolean
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const label = feature.label ?? unnamedFeature
  const renameDisabled = controller.status !== "ready" || controller.report?.mode !== "read-write"
  return (
    <div
      className={cn("flex min-w-0 items-center gap-0.5", feature.suppressed && "opacity-60")}
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
      <FeatureSuppressionAction
        controller={controller}
        feature={feature}
        label={label}
        onChange={onSuppressionChange}
      />
      <ModelTreeRenameDialog
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
  const dependents = sketchHasDependents(
    sketch,
    controller.report?.snapshot.features ?? [],
    controller.report?.snapshot.sketches ?? [],
  )

  return (
    <>
      <ModelTreeRenameDialog
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
        baseRevision={controller.report?.snapshot.revision ?? 0}
        blocked={renameBlocked || dependents}
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
  label,
  onActivate,
  onRenameOpen,
  renameDisabled,
}: {
  active: boolean
  label: string
  onActivate: () => void
  onRenameOpen: () => void
  renameDisabled: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn(
        "min-w-0 flex-1 justify-start pl-6 font-normal",
        active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
      )}
      role="treeitem"
      tabIndex={-1}
      aria-selected={active}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key !== "F2" || renameDisabled) return
        event.preventDefault()
        onRenameOpen()
      }}
    >
      <PenLine aria-hidden="true" className="mr-1 size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Button>
  )
}

function SketchTreeItem({
  active,
  controller,
  onActivate,
  onSketchSupportRepair,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchRename,
  onVisibilityChange,
  renameBlocked,
  referenceHealth,
  supportHealth,
  sketch,
  unnamedSketch,
  visible,
}: {
  active: boolean
  controller: DocumentControllerState
  onActivate: (sketchId: SketchId) => void
  onSketchSupportRepair: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onSketchRename: SketchRenameHandler
  onVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  renameBlocked: boolean
  referenceHealth: HistoryViewRow["referenceHealth"]
  supportHealth: HistoryViewRow["supportHealth"]
  sketch: SketchRecord
  unnamedSketch: string
  visible: boolean
}) {
  const t = useTranslations("app.shell.modelTree")
  const [renameOpen, setRenameOpen] = useState(false)
  const label = sketch.label || unnamedSketch
  const renameDisabled =
    renameBlocked || controller.status !== "ready" || controller.report?.mode !== "read-write"

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <SketchVisibilityAction
        label={label}
        onChange={() => onVisibilityChange(sketch.id, !visible)}
        t={t}
        visible={visible}
      />
      <SketchTreeLabelButton
        active={active}
        label={label}
        onActivate={() => onActivate(sketch.id)}
        onRenameOpen={() => setRenameOpen(true)}
        renameDisabled={renameDisabled}
      />
      <BrokenSketchReferenceAction
        referenceHealth={referenceHealth}
        supportHealth={supportHealth}
        label={label}
        onActivate={() => onActivate(sketch.id)}
        onSupportRepair={() => onSketchSupportRepair(sketch.id)}
        t={t}
      />
      <SketchTreeActions
        controller={controller}
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
      {title}
    </Button>
  )
}

function ModelTreeGroupItem({
  expanded,
  onExpandedChange,
  title,
}: {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start font-normal"
      role="treeitem"
      tabIndex={-1}
      aria-expanded={expanded}
      onClick={() => onExpandedChange(!expanded)}
    >
      <ChevronDown
        aria-hidden="true"
        className={cn("mr-1 size-4 shrink-0 transition-transform", !expanded && "-rotate-90")}
      />
      {title}
    </Button>
  )
}

type ModelTreeProps = {
  activeFeatureId: FeatureRecord["id"] | null
  activeSketchId: SketchId | null
  activeWorkspace: EditorWorkspaceName
  controller: DocumentControllerState
  onFeatureActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onFeaturePreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onFeatureSuppressionChange: FeatureSuppressionHandler
  onFeatureVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onHistoryMove: HistoryMoveHandler
  onSketchActivate: (sketchId: SketchId) => void
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

function ModelTreeWorkspaceItems({
  activeWorkspace,
  controller,
  onWorkspaceChange,
  t,
}: Pick<ModelTreeProps, "activeWorkspace" | "controller" | "onWorkspaceChange"> & {
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
      <ModelTreeRootItem
        targetWorkspace="model"
        title={t("items.origin")}
        disabled={workspaceUnavailable}
        onWorkspaceChange={onWorkspaceChange}
      />
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
  const extrusion = readExtrusionFeatureParameters(feature)
  if (extrusion) {
    return t("profileFromSketch", {
      sketch: historyRecordLabel(
        labelsByRef,
        { kind: "sketch", id: extrusion.profile.sketchId },
        t("unnamedSketch"),
      ),
    })
  }
  const revolve = readRevolveFeatureParameters(feature)
  if (revolve) {
    return t("profileFromSketch", {
      sketch: historyRecordLabel(
        labelsByRef,
        { kind: "sketch", id: revolve.profile.sketchId },
        t("unnamedSketch"),
      ),
    })
  }
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
  if (view.graphFailed || props.activeWorkspace !== "sketch" || !props.activeSketchId) return -1
  return view.rows.findIndex(
    (row) => row.ref.kind === "sketch" && row.ref.id === props.activeSketchId,
  )
}

type ModelTreeHistoryBranchProps = ModelTreeProps & {
  view: ReturnType<typeof selectModelTreeHistory>
  t: ReturnType<typeof useTranslations>
}

type ModelTreeHistoryRowProps = ModelTreeHistoryBranchProps & {
  index: number
  marker: boolean
  rolledBack: boolean
  row: HistoryViewRow
}

function refsEqual(left: HistoryItemRef, right: HistoryItemRef) {
  return left.kind === right.kind && left.id === right.id
}

function adjacentHistoryMove(
  rows: readonly HistoryViewRow[],
  index: number,
  direction: "earlier" | "later",
): Readonly<{ item: HistoryItemRef; historyAfter: HistoryItemRef | null }> | null {
  const row = rows[index]
  if (!row) return null
  if (direction === "earlier") {
    const previous = rows[index - 1]
    if (!previous || row.dependencies.some((dependency) => refsEqual(dependency, previous.ref)))
      return null
    return { item: row.ref, historyAfter: rows[index - 2]?.ref ?? null }
  }
  const next = rows[index + 1]
  if (!next || next.dependencies.some((dependency) => refsEqual(dependency, row.ref))) return null
  return { item: row.ref, historyAfter: next.ref }
}

function HistoryReorderActions({
  controller,
  index,
  label,
  locked,
  onMove,
  rows,
  t,
}: {
  controller: DocumentControllerState
  index: number
  label: string
  locked: boolean
  onMove: HistoryMoveHandler
  rows: readonly HistoryViewRow[]
  t: ReturnType<typeof useTranslations>
}) {
  const earlier = adjacentHistoryMove(rows, index, "earlier")
  const later = adjacentHistoryMove(rows, index, "later")
  const unavailable =
    locked || controller.status !== "ready" || controller.report?.mode !== "read-write"
  const action = (direction: "earlier" | "later", move: typeof earlier, icon: ReactNode) => {
    const actionLabel = t(direction === "earlier" ? "moveHistoryEarlier" : "moveHistoryLater", {
      item: label,
    })
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={actionLabel}
            disabled={unavailable || !move}
            onClick={() =>
              move
                ? onMove(controller.report?.snapshot.revision ?? 0, move.item, move.historyAfter)
                : undefined
            }
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{actionLabel}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <fieldset className="flex shrink-0 items-center">
      <legend className="sr-only">{t("reorderHistory", { item: label })}</legend>
      {action("earlier", earlier, <ArrowUp aria-hidden="true" />)}
      {action("later", later, <ArrowDown aria-hidden="true" />)}
    </fieldset>
  )
}

function SketchHistoryRow({
  index,
  marker,
  rolledBack,
  row,
  t,
  view,
  ...props
}: ModelTreeHistoryRowProps) {
  const label = (row.record as SketchRecord).label || t("unnamedSketch")
  const reorderLocked =
    rolledBack ||
    props.activeSketchId !== null ||
    props.activeFeatureId !== null ||
    view.reorderUnavailable
  return (
    <div
      role="none"
      data-history-kind={row.kind}
      data-history-id={row.ref.id}
      data-history-rolled-back={rolledBack ? "true" : undefined}
      className={rolledBack ? "opacity-60" : undefined}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <SketchTreeItem
            active={row.ref.id === props.activeSketchId}
            controller={props.controller}
            onActivate={props.onSketchActivate}
            onSketchSupportRepair={props.onSketchSupportRepair}
            onFeatureRename={props.onFeatureRename}
            onSketchDeleted={props.onSketchDeleted}
            onSketchRemove={props.onSketchRemove}
            onSketchRename={props.onSketchRename}
            onVisibilityChange={props.onSketchVisibilityChange}
            renameBlocked={row.ref.id === props.sketchRenameBlockedId}
            referenceHealth={row.referenceHealth}
            supportHealth={row.supportHealth}
            sketch={row.record as SketchRecord}
            unnamedSketch={t("unnamedSketch")}
            visible={!props.hiddenSketchIds.includes(row.ref.id as SketchId)}
          />
        </div>
        <HistoryReorderActions
          controller={props.controller}
          index={index}
          label={label}
          locked={reorderLocked}
          onMove={props.onHistoryMove}
          rows={view.rows}
          t={t}
        />
      </div>
      <HistorySummary labelsByRef={view.labelsByRef} row={row} t={t} />
      <SketchReferenceHealthSummary health={row.referenceHealth} t={t} />
      <SketchSupportHealthSummary health={row.supportHealth} t={t} />
      {marker && (
        <div role="status" className="px-2 text-[11px] text-muted-foreground">
          {t("rollbackMarker")}
        </div>
      )}
    </div>
  )
}

function FeatureHistoryRow({
  index,
  rolledBack,
  row,
  t,
  view,
  ...props
}: ModelTreeHistoryRowProps) {
  const label = (row.record as FeatureRecord).label ?? t("unnamedFeature")
  const reorderLocked =
    rolledBack ||
    props.activeSketchId !== null ||
    props.activeFeatureId !== null ||
    view.reorderUnavailable
  return (
    <div
      role="none"
      data-history-kind={row.kind}
      data-history-feature-kind={row.datum ? "datum" : "modeling"}
      data-history-id={row.ref.id}
      className={rolledBack ? "opacity-60" : undefined}
      data-history-rolled-back={rolledBack ? "true" : undefined}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <FeatureTreeItem
            active={row.ref.id === props.activeFeatureId}
            controller={props.controller}
            feature={row.record as FeatureRecord}
            onActivate={props.onFeatureActivate}
            onFeatureRename={props.onFeatureRename}
            onPreselectionChange={props.onFeaturePreselectionChange}
            onSuppressionChange={props.onFeatureSuppressionChange}
            onVisibilityChange={props.onFeatureVisibilityChange}
            onSketchRename={props.onSketchRename}
            unnamedFeature={t("unnamedFeature")}
            visible={!props.hiddenFeatureIds.includes(row.ref.id as FeatureRecord["id"])}
          />
        </div>
        <HistoryReorderActions
          controller={props.controller}
          index={index}
          label={label}
          locked={reorderLocked}
          onMove={props.onHistoryMove}
          rows={view.rows}
          t={t}
        />
      </div>
      <HistorySummary labelsByRef={view.labelsByRef} row={row} t={t} />
    </div>
  )
}

function HistoryGroup({
  expanded,
  onExpandedChange,
  rollbackIndex,
  ...props
}: ModelTreeHistoryBranchProps & {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  rollbackIndex: number
}) {
  const { t, view } = props
  return (
    <div role="none">
      <ModelTreeGroupItem
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        title={t("items.history")}
      />
      {expanded && (
        <fieldset className="contents">
          <legend className="sr-only">{t("items.history")}</legend>
          {view.graphFailed && (
            <p role="status" className="px-2 text-xs text-muted-foreground">
              {t("historyUnavailable")}
            </p>
          )}
          {view.rows.map((row, index) => {
            const rowProps = {
              ...props,
              index,
              row,
              rolledBack: rollbackIndex >= 0 && index > rollbackIndex,
              marker: rollbackIndex === index && index < view.rows.length - 1,
            }
            return row.kind === "sketch" ? (
              <SketchHistoryRow key={historyRefKey(row.ref)} {...rowProps} />
            ) : (
              <FeatureHistoryRow key={historyRefKey(row.ref)} {...rowProps} />
            )
          })}
        </fieldset>
      )}
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
  return (
    <div role="none">
      <ModelTreeGroupItem
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        title={t("items.bodies")}
      />
      {expanded && (
        <fieldset className="contents">
          <legend className="sr-only">{t("items.bodies")}</legend>
          {view.modelBodies.map((body, index) => {
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
                    namedBody
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

function ModelTreeHistoryBranch(props: ModelTreeHistoryBranchProps) {
  const rollbackIndex = rollbackHistoryIndex(props.view, props)
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [bodiesExpanded, setBodiesExpanded] = useState(true)
  return (
    <>
      <HistoryGroup
        {...props}
        expanded={historyExpanded}
        onExpandedChange={setHistoryExpanded}
        rollbackIndex={rollbackIndex}
      />
      <BodiesGroup {...props} expanded={bodiesExpanded} onExpandedChange={setBodiesExpanded} />
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

function hierarchicalTreeTarget(key: string, current: HTMLElement) {
  if (key === "ArrowRight") {
    if (current.getAttribute("aria-expanded") === "false") current.click()
    if (current.getAttribute("aria-expanded") !== "true") return undefined
    return (
      current.parentElement?.querySelector<HTMLElement>(':scope > fieldset [role="treeitem"]') ??
      undefined
    )
  }
  if (key === "ArrowLeft") {
    if (current.getAttribute("aria-expanded") === "true") current.click()
    if (current.getAttribute("aria-expanded") !== null) return undefined
    return current.closest<HTMLElement>("fieldset")?.previousElementSibling as
      | HTMLElement
      | undefined
  }
  return undefined
}

function moveTreeFocus(event: KeyboardEvent<HTMLElement>) {
  if (!treeNavigationKeys.has(event.key)) return
  const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
  if (!current) return
  const items = visibleTreeItems(event.currentTarget)
  const next =
    linearTreeTarget(event.key, items, items.indexOf(current)) ??
    hierarchicalTreeTarget(event.key, current)
  event.preventDefault()
  next?.focus()
}

function updateTreeTabStop(event: FocusEvent<HTMLElement>) {
  const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
  if (!current) return
  for (const item of visibleTreeItems(event.currentTarget))
    item.tabIndex = item === current ? 0 : -1
}

export function ModelTree(props: ModelTreeProps) {
  const t = useTranslations("app.shell.modelTree")
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
  const sketchIds = historyView.rows
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
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-r bg-panel p-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h2 className="text-sm font-medium">{t("title")}</h2>
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
      </div>
      <div
        className="mt-1 grid gap-0.5"
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
