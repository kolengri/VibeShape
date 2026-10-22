import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { FieldHelp } from "@vibeshape/ui/components/field-help"
import { useNarrowWorkspace } from "./compact-model-tree"
import { useCompactTaskPanel } from "./responsive-task-panel"
import { useWorkspaceLayoutPreferences } from "./workspace-layout-preferences"

const panelSettings = {
  tree: { min: 200, max: 420, resize: "treeResize" },
  task: { min: 280, max: 480, resize: "taskResize" },
} as const

function PanelSettings({ compact, panel }: Readonly<{ compact: boolean; panel: "tree" | "task" }>) {
  const t = useTranslations("app.shell.workspaceLayout")
  const width = useWorkspaceLayoutPreferences((state) => state[`${panel}Width`])
  const opacity = useWorkspaceLayoutPreferences((state) => state[`${panel}Opacity`])
  const collapsed = useWorkspaceLayoutPreferences((state) => state[`${panel}Collapsed`])
  const setWidth = useWorkspaceLayoutPreferences((state) => state.actions.setWidth)
  const setOpacity = useWorkspaceLayoutPreferences((state) => state.actions.setOpacity)
  const setCollapsed = useWorkspaceLayoutPreferences((state) => state.actions.setCollapsed)
  const { min, max, resize } = panelSettings[panel]
  const title = t(panel)
  const narrow = useNarrowWorkspace()
  const sheet = (panel === "task" && compact) || (panel === "tree" && narrow)

  return (
    <section className="grid min-w-0 gap-3 border-b py-3 last:border-b-0">
      <h3 className="text-sm font-medium">{title}</h3>
      <label className={fieldVariants({ orientation: "horizontal" })}>
        <span className="flex items-center justify-between gap-3">
          <span>{t("width")}</span>
          <span className="tabular-nums">{t("widthValue", { value: width })}</span>
        </span>
        <input
          aria-label={t(resize)}
          type="range"
          min={min}
          max={max}
          step={1}
          value={width}
          disabled={sheet}
          onChange={(event) => setWidth(panel, Number(event.currentTarget.value))}
          className="w-full accent-primary"
        />
      </label>
      <label className={fieldVariants({ orientation: "horizontal" })}>
        <span className="flex items-center justify-between gap-3">
          <span>{t("opacity")}</span>
          <span className="tabular-nums">{t("opacityValue", { value: opacity })}</span>
        </span>
        <input
          aria-label={t("opacityLabel", { panel: title })}
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          disabled={compact}
          onChange={(event) => setOpacity(panel, Number(event.currentTarget.value))}
          className="w-full accent-primary"
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full justify-start"
        aria-pressed={!collapsed}
        disabled={sheet}
        onClick={() => setCollapsed(panel, !collapsed)}
      >
        {collapsed ? t("show", { panel: title }) : t("hide", { panel: title })}
      </Button>
    </section>
  )
}

export function WorkspaceLayoutSettings() {
  const t = useTranslations("app.shell.workspaceLayout")
  const settingsT = useTranslations("app.settings")
  const narrow = useNarrowWorkspace()
  const reset = useWorkspaceLayoutPreferences((state) => state.actions.reset)
  const compact = useCompactTaskPanel()

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1 text-xs font-medium">
        {settingsT("workspace")}
        <FieldHelp label={settingsT("workspace")}>{t("help")}</FieldHelp>
      </div>
      {compact ? <p className="text-xs text-muted-foreground">{t("helpCompact")}</p> : null}
      {narrow ? (
        <p className="text-xs text-muted-foreground">{settingsT("compactTreeDescription")}</p>
      ) : null}
      <PanelSettings compact={compact} panel="tree" />
      <PanelSettings compact={compact} panel="task" />
      <Button type="button" variant="secondary" onClick={reset}>
        {t("reset")}
      </Button>
    </div>
  )
}
