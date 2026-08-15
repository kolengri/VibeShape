import type { FeatureRecord, SketchId, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { cn } from "@vibeshape/ui/lib/cn"
import { useState } from "react"
import type { SemanticRenameResult } from "../components/semantic-rename-dialog"
import type { DocumentControllerState } from "../document/document-controller"
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

function FeatureTreeItem({
  active,
  controller,
  feature,
  onActivate,
  onFeatureRename,
  onSketchRename,
  unnamedFeature,
}: {
  active: boolean
  controller: DocumentControllerState
  feature: FeatureRecord
  onActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const label = feature.label ?? unnamedFeature
  const renameDisabled = controller.status !== "ready" || controller.report?.mode !== "read-write"

  return (
    <div className="flex min-w-0 items-center gap-0.5">
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
  onSketchRename,
  unnamedFeature,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  controller: DocumentControllerState
  features: readonly FeatureRecord[]
  groupLabel: string
  onActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onSketchRename: SketchRenameHandler
  unnamedFeature: string
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
          onSketchRename={onSketchRename}
          unnamedFeature={unnamedFeature}
        />
      ))}
    </fieldset>
  )
}

function SketchTreeItem({
  active,
  controller,
  onActivate,
  onFeatureRename,
  onSketchRename,
  renameBlocked,
  sketch,
  unnamedSketch,
}: {
  active: boolean
  controller: DocumentControllerState
  onActivate: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchRename: SketchRenameHandler
  renameBlocked: boolean
  sketch: SketchRecord
  unnamedSketch: string
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const label = sketch.label || unnamedSketch
  const renameDisabled =
    renameBlocked || controller.status !== "ready" || controller.report?.mode !== "read-write"

  return (
    <div className="flex min-w-0 items-center gap-0.5">
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
      <ModelTreeRenameDialog
        blocked={renameBlocked}
        controller={controller}
        fallbackName={unnamedSketch}
        onFeatureRename={onFeatureRename}
        onOpenChange={setRenameOpen}
        onSketchRename={onSketchRename}
        open={renameOpen}
        target={{ kind: "sketch", record: sketch }}
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
  onSketchRename,
  renameBlockedId,
  sketches,
  unnamedSketch,
}: {
  activeSketchId: SketchId | null
  controller: DocumentControllerState
  groupLabel: string
  onActivate: (sketchId: SketchId) => void
  onFeatureRename: FeatureRenameHandler
  onSketchRename: SketchRenameHandler
  renameBlockedId: SketchId | null
  sketches: readonly SketchRecord[]
  unnamedSketch: string
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
          onSketchRename={onSketchRename}
          renameBlocked={sketch.id === renameBlockedId}
          sketch={sketch}
          unnamedSketch={unnamedSketch}
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

export function ModelTree({
  activeFeatureId,
  activeSketchId,
  activeWorkspace,
  controller,
  onFeatureActivate,
  onFeatureRename,
  onSketchActivate,
  onSketchRename,
  onWorkspaceChange,
  sketchRenameBlockedId,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  activeSketchId: SketchId | null
  activeWorkspace: EditorWorkspaceName
  controller: DocumentControllerState
  onFeatureActivate: (featureId: FeatureRecord["id"]) => void
  onFeatureRename: FeatureRenameHandler
  onSketchActivate: (sketchId: SketchId) => void
  onSketchRename: SketchRenameHandler
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  sketchRenameBlockedId: SketchId | null
}) {
  const t = useTranslations("app.shell.modelTree")
  const features = controller.report?.snapshot.features ?? []
  const sketches = controller.report?.snapshot.sketches ?? []

  return (
    <aside aria-label={t("ariaLabel")} className="min-h-0 overflow-auto border-r bg-panel p-2">
      <h2 className="px-2 py-1 text-sm font-medium">{t("title")}</h2>
      <div className="mt-1 grid gap-0.5" role="tree" aria-label={t("projectFeatures")}>
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
        <SketchTreeItems
          activeSketchId={activeSketchId}
          controller={controller}
          sketches={sketches}
          groupLabel={t("items.sketches")}
          onActivate={onSketchActivate}
          onFeatureRename={onFeatureRename}
          onSketchRename={onSketchRename}
          renameBlockedId={sketchRenameBlockedId}
          unnamedSketch={t("unnamedSketch")}
        />
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
          onSketchRename={onSketchRename}
          unnamedFeature={t("unnamedFeature")}
        />
        <ModelTreeRootItem
          targetWorkspace="model"
          title={t("items.bodies")}
          onWorkspaceChange={onWorkspaceChange}
        />
      </div>
    </aside>
  )
}
