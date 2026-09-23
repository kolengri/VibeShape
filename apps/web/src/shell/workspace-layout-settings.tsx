import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { PanelsTopLeft } from "@vibeshape/ui/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
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
  const sheet = panel === "task" && compact

  return (
    <section className="grid min-w-0 gap-3 border-b py-3 last:border-b-0">
      <h3 className="text-sm font-medium">{title}</h3>
      <label className="grid gap-1 text-xs text-muted-foreground">
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
      <label className="grid gap-1 text-xs text-muted-foreground">
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
  const reset = useWorkspaceLayoutPreferences((state) => state.actions.reset)
  const compact = useCompactTaskPanel()

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t("title")}>
              <PanelsTopLeft aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("title")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        aria-labelledby="workspace-layout-settings-title"
        className="max-h-[min(80vh,40rem)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-4"
      >
        <div className="grid gap-2">
          <h2 id="workspace-layout-settings-title" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("help")}</p>
          {compact ? <p className="text-xs text-muted-foreground">{t("helpCompact")}</p> : null}
          <PanelSettings compact={compact} panel="tree" />
          <PanelSettings compact={compact} panel="task" />
          <Button type="button" variant="secondary" onClick={reset}>
            {t("reset")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
