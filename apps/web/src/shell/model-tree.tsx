import {
  type FeatureRecord,
  isSketchExternalModelReference,
  readExtrusionFeatureParameters,
  type SketchId,
  type SketchRecord,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Eye, EyeOff } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { useState } from "react"
import type { SemanticRenameResult } from "../components/semantic-rename-dialog"
import type {
  DocumentControllerState,
  DocumentMutationResult,
} from "../document/document-controller"
import { SketchDeleteAction } from "../features/sketch/sketch-delete-action"
import { ModelTreeRenameDialog } from "./model-tree-rename-dialog"
import type { EditorWorkspaceName } from "./workspace"

type FeatureRenameHandler = (
  baseRevision: number,
  feature: FeatureRecord,
) => Promise<SemanticRenameResult>

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

function FeatureTreeItem({
  active,
  controller,
  feature,
  onActivate,
  onFeatureRename,
  onPreselectionChange,
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
  onVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
  visible: boolean
}) {
  const t = useTranslations("app.shell.modelTree")
  const [renameOpen, setRenameOpen] = useState(false)
  const label = feature.label ?? unnamedFeature
  const renameDisabled = controller.status !== "ready" || controller.report?.mode !== "read-write"
  const visibilityLabel = t(visible ? "hideFeature" : "showFeature", { feature: label })

  return (
    <div
      className="flex min-w-0 items-center gap-0.5"
      onPointerEnter={() => onPreselectionChange(feature.id)}
      onPointerLeave={() => onPreselectionChange(null)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={visibilityLabel}
            aria-pressed={visible}
            onClick={() => onVisibilityChange(feature.id, !visible)}
          >
            {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{visibilityLabel}</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "min-w-0 flex-1 justify-start pl-6 font-normal",
          active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
        )}
        role="treeitem"
        aria-selected={active}
        onClick={() => onActivate(feature.id)}
        onFocus={() => onPreselectionChange(feature.id)}
        onBlur={() => onPreselectionChange(null)}
        onKeyDown={(event) => {
          if (event.key !== "F2" || renameDisabled) return
          event.preventDefault()
          setRenameOpen(true)
        }}
      >
        <span className="truncate">{label}</span>
      </Button>
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

function FeatureTreeItems({
  activeFeatureId,
  controller,
  features,
  groupLabel,
  onActivate,
  onFeatureRename,
  onPreselectionChange,
  onVisibilityChange,
  onSketchRename,
  unnamedFeature,
  hiddenFeatureIds,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  controller: DocumentControllerState
  features: readonly FeatureRecord[]
  groupLabel: string
  onActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onPreselectionChange: (featureId: FeatureRecord["id"] | null) => void
  onVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
  hiddenFeatureIds: readonly FeatureRecord["id"][]
}) {
  if (features.length === 0) return null
  return (
    <fieldset className="contents">
      <legend className="sr-only">{groupLabel}</legend>
      {features.map((feature) => (
        <FeatureTreeItem
          key={feature.id}
          active={feature.id === activeFeatureId}
          controller={controller}
          feature={feature}
          onActivate={onActivate}
          onFeatureRename={onFeatureRename}
          onPreselectionChange={onPreselectionChange}
          onVisibilityChange={onVisibilityChange}
          onSketchRename={onSketchRename}
          unnamedFeature={unnamedFeature}
          visible={!hiddenFeatureIds.includes(feature.id)}
        />
      ))}
    </fieldset>
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

function SketchTreeItem({
  active,
  controller,
  onActivate,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchRename,
  onVisibilityChange,
  renameBlocked,
  sketch,
  unnamedSketch,
  visible,
}: {
  active: boolean
  controller: DocumentControllerState
  onActivate: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onSketchRename: SketchRenameHandler
  onVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  renameBlocked: boolean
  sketch: SketchRecord
  unnamedSketch: string
  visible: boolean
}) {
  const t = useTranslations("app.shell.modelTree")
  const [renameOpen, setRenameOpen] = useState(false)
  const label = sketch.label || unnamedSketch
  const renameDisabled =
    renameBlocked || controller.status !== "ready" || controller.report?.mode !== "read-write"
  const visibilityLabel = t(visible ? "hideSketch" : "showSketch", { sketch: label })

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={visibilityLabel}
            aria-pressed={visible}
            onClick={() => onVisibilityChange(sketch.id, !visible)}
          >
            {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{visibilityLabel}</TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "min-w-0 flex-1 justify-start pl-6 font-normal",
          active && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
        )}
        role="treeitem"
        aria-selected={active}
        onClick={() => onActivate(sketch.id)}
        onKeyDown={(event) => {
          if (event.key !== "F2" || renameDisabled) return
          event.preventDefault()
          setRenameOpen(true)
        }}
      >
        <span className="truncate">{label}</span>
      </Button>
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

function SketchTreeItems({
  activeSketchId,
  controller,
  groupLabel,
  onActivate,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchRename,
  onVisibilityChange,
  renameBlockedId,
  sketches,
  unnamedSketch,
  hiddenSketchIds,
}: {
  activeSketchId: SketchId | null
  controller: DocumentControllerState
  groupLabel: string
  onActivate: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchDeleted: () => void
  onSketchRemove: SketchRemoveHandler
  onSketchRename: SketchRenameHandler
  onVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  renameBlockedId: SketchId | null
  sketches: readonly SketchRecord[]
  unnamedSketch: string
  hiddenSketchIds: readonly SketchId[]
}) {
  if (sketches.length === 0) return null
  return (
    <fieldset className="contents">
      <legend className="sr-only">{groupLabel}</legend>
      {sketches.map((sketch) => (
        <SketchTreeItem
          key={sketch.id}
          active={sketch.id === activeSketchId}
          controller={controller}
          onActivate={onActivate}
          onFeatureRename={onFeatureRename}
          onSketchDeleted={onSketchDeleted}
          onSketchRemove={onSketchRemove}
          onSketchRename={onSketchRename}
          onVisibilityChange={onVisibilityChange}
          renameBlocked={sketch.id === renameBlockedId}
          sketch={sketch}
          unnamedSketch={unnamedSketch}
          visible={!hiddenSketchIds.includes(sketch.id)}
        />
      ))}
    </fieldset>
  )
}

function ModelTreeRootItem({
  current,
  expanded,
  onWorkspaceChange,
  targetWorkspace,
  title,
}: {
  current?: "page" | undefined
  expanded?: boolean
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  targetWorkspace: EditorWorkspaceName
  title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start font-normal"
      role="treeitem"
      aria-current={current}
      aria-expanded={expanded}
      onClick={() => onWorkspaceChange(targetWorkspace)}
    >
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
  onFeatureVisibilityChange: (featureId: FeatureRecord["id"], visible: boolean) => void
  onSketchActivate: (sketchId: SketchId) => void
  onSketchRename: SketchRenameHandler
  onSketchVisibilityChange: (sketchId: SketchId, visible: boolean) => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  sketchRenameBlockedId: SketchId | null
  hiddenFeatureIds: readonly FeatureRecord["id"][]
  hiddenSketchIds: readonly SketchId[]
}

function ModelTreeWorkspaceItems({
  activeWorkspace,
  onWorkspaceChange,
  sketches,
  t,
}: Pick<ModelTreeProps, "activeWorkspace" | "onWorkspaceChange"> & {
  sketches: readonly SketchRecord[]
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <>
      <ModelTreeRootItem
        current={activeWorkspace === "variables" ? "page" : undefined}
        targetWorkspace="variables"
        title={t("items.variables")}
        onWorkspaceChange={onWorkspaceChange}
      />
      <ModelTreeRootItem
        targetWorkspace="model"
        title={t("items.origin")}
        onWorkspaceChange={onWorkspaceChange}
      />
      <ModelTreeRootItem
        current={activeWorkspace === "sketch" ? "page" : undefined}
        expanded={sketches.length > 0}
        targetWorkspace="sketch"
        title={t("items.sketches")}
        onWorkspaceChange={onWorkspaceChange}
      />
    </>
  )
}

function ModelTreeSketchBranch({
  activeSketchId,
  controller,
  hiddenSketchIds,
  onFeatureRename,
  onSketchDeleted,
  onSketchRemove,
  onSketchActivate,
  onSketchRename,
  onSketchVisibilityChange,
  sketchRenameBlockedId,
  sketches,
  t,
}: Pick<
  ModelTreeProps,
  | "activeSketchId"
  | "controller"
  | "hiddenSketchIds"
  | "onFeatureRename"
  | "onSketchDeleted"
  | "onSketchRemove"
  | "onSketchActivate"
  | "onSketchRename"
  | "onSketchVisibilityChange"
  | "sketchRenameBlockedId"
> & {
  sketches: readonly SketchRecord[]
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <SketchTreeItems
      activeSketchId={activeSketchId}
      controller={controller}
      sketches={sketches}
      groupLabel={t("items.sketches")}
      onActivate={onSketchActivate}
      onFeatureRename={onFeatureRename}
      onSketchDeleted={onSketchDeleted}
      onSketchRemove={onSketchRemove}
      onSketchRename={onSketchRename}
      onVisibilityChange={onSketchVisibilityChange}
      renameBlockedId={sketchRenameBlockedId}
      unnamedSketch={t("unnamedSketch")}
      hiddenSketchIds={hiddenSketchIds}
    />
  )
}

function ModelTreeFeatureBranch({
  activeFeatureId,
  controller,
  features,
  hiddenFeatureIds,
  onFeatureActivate,
  onFeaturePreselectionChange,
  onFeatureRename,
  onFeatureVisibilityChange,
  onSketchRename,
  onWorkspaceChange,
  t,
}: Pick<
  ModelTreeProps,
  | "activeFeatureId"
  | "controller"
  | "hiddenFeatureIds"
  | "onFeatureActivate"
  | "onFeaturePreselectionChange"
  | "onFeatureRename"
  | "onFeatureVisibilityChange"
  | "onSketchRename"
  | "onWorkspaceChange"
> & {
  features: readonly FeatureRecord[]
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <>
      <ModelTreeRootItem
        targetWorkspace="model"
        expanded={features.length > 0}
        title={t("items.features")}
        onWorkspaceChange={onWorkspaceChange}
      />
      <FeatureTreeItems
        activeFeatureId={activeFeatureId}
        controller={controller}
        features={features}
        groupLabel={t("items.features")}
        onActivate={onFeatureActivate}
        onFeatureRename={onFeatureRename}
        onPreselectionChange={onFeaturePreselectionChange}
        onVisibilityChange={onFeatureVisibilityChange}
        onSketchRename={onSketchRename}
        unnamedFeature={t("unnamedFeature")}
        hiddenFeatureIds={hiddenFeatureIds}
      />
      <ModelTreeRootItem
        targetWorkspace="model"
        title={t("items.bodies")}
        onWorkspaceChange={onWorkspaceChange}
      />
    </>
  )
}

export function ModelTree(props: ModelTreeProps) {
  const t = useTranslations("app.shell.modelTree")
  const features = props.controller.report?.snapshot.features ?? []
  const sketches = props.controller.report?.snapshot.sketches ?? []

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-r bg-panel p-2">
      <h2 className="px-2 py-1 text-sm font-medium">{t("title")}</h2>
      <div className="mt-1 grid gap-0.5" role="tree" aria-label={t("projectFeatures")}>
        <ModelTreeWorkspaceItems {...props} sketches={sketches} t={t} />
        <ModelTreeSketchBranch {...props} sketches={sketches} t={t} />
        <ModelTreeFeatureBranch {...props} features={features} t={t} />
      </div>
    </aside>
  )
}
