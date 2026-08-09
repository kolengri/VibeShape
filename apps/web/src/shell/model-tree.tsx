import { Button } from "@vibeshape/ui/components/button"
import { cn } from "@vibeshape/ui/lib/cn"
import { useTranslations } from "@vibeshape/i18n"
import type { FeatureRecord } from "@vibeshape/domain"
import type { DocumentControllerState } from "../document/document-controller"

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

function ModelTreeRootItem({
  current,
  expanded,
  onWorkspaceChange,
  targetWorkspace,
  title,
}: {
  current?: "page" | undefined
  expanded?: boolean
  onWorkspaceChange: (workspace: "model" | "variables") => void
  targetWorkspace: "model" | "variables"
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
  activeWorkspace,
  controller,
  onFeatureActivate,
  onWorkspaceChange,
}: {
  activeFeatureId: FeatureRecord["id"] | null
  activeWorkspace: "model" | "variables"
  controller: DocumentControllerState
  onFeatureActivate: (featureId: FeatureRecord["id"]) => void
  onWorkspaceChange: (workspace: "model" | "variables") => void
}) {
  const t = useTranslations("app.shell.modelTree")
  const features = controller.report?.snapshot.features ?? []

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
          targetWorkspace="model"
          title={t("items.sketches")}
          onWorkspaceChange={onWorkspaceChange}
        />
        <ModelTreeRootItem
          expanded={features.length > 0}
          targetWorkspace="model"
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
