import type { FeatureRecord, SketchId, SketchRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { cn } from "@vibeshape/ui/lib/cn"
import type { DocumentControllerState } from "../document/document-controller"
import type { EditorWorkspaceName } from "./workspace"

function FeatureTreeItems({
  activeFeatureId,
  features,
  groupLabel,
  onActivate,
  unnamedFeature,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  features: readonly FeatureRecord[]
  groupLabel: string
  onActivate: (featureId: FeatureRecord["id"]) => void
  unnamedFeature: string
}) {
  if (features.length === 0) return null
  return (
    <fieldset className="contents">
      <legend className="sr-only">{groupLabel}</legend>
      {features.map((feature) => (
        <Button
          key={feature.id}
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            "w-full justify-start pl-6 font-normal",
            feature.id === activeFeatureId &&
              "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
          )}
          role="treeitem"
          aria-selected={feature.id === activeFeatureId}
          onClick={() => onActivate(feature.id)}
        >
          {feature.label ?? unnamedFeature}
        </Button>
      ))}
    </fieldset>
  )
}

function SketchTreeItems({
  activeSketchId,
  groupLabel,
  onActivate,
  sketches,
  unnamedSketch,
}: {
  activeSketchId: SketchId | null
  groupLabel: string
  onActivate: (sketchId: SketchId) => void
  sketches: readonly SketchRecord[]
  unnamedSketch: string
}) {
  if (sketches.length === 0) return null
  return (
    <fieldset className="contents">
      <legend className="sr-only">{groupLabel}</legend>
      {sketches.map((sketch) => (
        <Button
          key={sketch.id}
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            "w-full justify-start pl-6 font-normal",
            sketch.id === activeSketchId &&
              "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
          )}
          role="treeitem"
          aria-selected={sketch.id === activeSketchId}
          onClick={() => onActivate(sketch.id)}
        >
          {sketch.label || unnamedSketch}
        </Button>
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
  onSketchActivate,
  onWorkspaceChange,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  activeSketchId: SketchId | null
  activeWorkspace: EditorWorkspaceName
  controller: DocumentControllerState
  onFeatureActivate: (featureId: FeatureRecord["id"]) => void
  onSketchActivate: (sketchId: SketchId) => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
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
          sketches={sketches}
          groupLabel={t("items.sketches")}
          unnamedSketch={t("unnamedSketch")}
          onActivate={onSketchActivate}
        />
        <ModelTreeRootItem
          targetWorkspace="model"
          expanded={features.length > 0}
          title={t("items.features")}
          onWorkspaceChange={onWorkspaceChange}
        />
        <FeatureTreeItems
          activeFeatureId={activeFeatureId}
          features={features}
          groupLabel={t("items.features")}
          unnamedFeature={t("unnamedFeature")}
          onActivate={onFeatureActivate}
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
