import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
import type { FeatureRecord } from "@vibeshape/domain"
import type { DocumentControllerState } from "../document/document-controller"

function FeatureTreeItems({
  features,
  groupLabel,
  onActivate,
  unnamedFeature,
}: {
  features: readonly FeatureRecord[]
  groupLabel: string
  onActivate: () => void
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
          className="w-full justify-start pl-6 font-normal"
          role="treeitem"
          onClick={onActivate}
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
  activeWorkspace,
  controller,
  onWorkspaceChange,
}: {
  activeWorkspace: "model" | "variables"
  controller: DocumentControllerState
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
          features={features}
          groupLabel={t("items.features")}
          unnamedFeature={t("unnamedFeature")}
          onActivate={() => onWorkspaceChange("model")}
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
