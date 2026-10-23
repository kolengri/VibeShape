import { useTranslations } from "@vibeshape/i18n"
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import {
  CompactModelTreeContext,
  CompactModelTreeToggle,
  useNarrowWorkspace,
} from "./compact-model-tree"
import { useCompactTaskPanel } from "./responsive-task-panel"
import { ViewportGridItem } from "./viewport-grid"
import { useWorkspaceLayoutPreferences } from "./workspace-layout-preferences"
import { useWorkspaceTask } from "./workspace-task-context"

function IdleModelTreeToggle({ taskActive, narrow }: { taskActive: boolean; narrow: boolean }) {
  if (taskActive || !narrow) return null
  return (
    <div className="pointer-events-auto absolute bottom-[calc(var(--workspace-chrome-bottom,0px)+var(--workspace-gap))] left-[calc(var(--workspace-chrome-left,0px)+var(--workspace-gap))] z-30">
      <CompactModelTreeToggle />
    </div>
  )
}

type PanelPresentation = {
  interactive: boolean
  transparent: boolean
  children: ReactNode
}

function useTreeDrawer(
  narrow: boolean,
  revealTreeRequest: number | undefined,
  root: RefObject<HTMLDivElement | null>,
) {
  const actions = useWorkspaceLayoutPreferences((state) => state.actions)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!narrow) setOpen(false)
  }, [narrow])
  useEffect(() => {
    if (!revealTreeRequest) return
    if (narrow) setOpen(true)
    else actions.setCollapsed("tree", false)
  }, [actions, narrow, revealTreeRequest])
  const toggle = useCallback(() => {
    setOpen((value) => !value)
    const grid = root.current?.closest(".viewport-grid")
    const target = open ? "outside" : "drawer"
    requestAnimationFrame(() =>
      grid?.querySelector<HTMLButtonElement>(`[data-model-tree-toggle="${target}"]`)?.focus(),
    )
  }, [open, root])
  return { narrow, open, panelId, toggle }
}

function TreeSlot({
  children,
  drawer,
  interactive,
  transparent,
}: PanelPresentation & { drawer: ReturnType<typeof useTreeDrawer> }) {
  const t = useTranslations("app.shell.workspaceLayout")
  const { actions, treeWidth, treeCollapsed, treeOpacity } = useWorkspaceLayoutPreferences(
    (state) => state,
  )
  const resize = useCallback((width: number) => actions.setWidth("tree", width), [actions])
  const reset = useCallback(() => actions.setWidth("tree", 240), [actions])
  const visible = drawer.narrow ? drawer.open : !treeCollapsed
  return (
    <ViewportGridItem
      id="workspace-tree"
      area="left"
      visible={visible}
      overlay={drawer.narrow}
      width={drawer.narrow ? 288 : treeWidth}
      minWidth={200}
      maxWidth={420}
      resizeLabel={t("treeResize")}
      onWidthChange={interactive && !drawer.narrow ? resize : undefined}
      onResetWidth={reset}
    >
      <div
        className="workspace-panel workspace-panel--tree"
        id={drawer.panelId}
        data-drawer={drawer.narrow}
        data-drawer-open={drawer.open}
        data-transparent={transparent}
        inert={!interactive || !visible}
        aria-hidden={!interactive || undefined}
        style={{ "--workspace-tree-opacity": `${treeOpacity}%` } as CSSProperties}
      >
        {interactive && drawer.narrow && (
          <div className="shrink-0 border-b px-2">
            <CompactModelTreeToggle insideDrawer />
          </div>
        )}
        {children}
      </div>
    </ViewportGridItem>
  )
}

function TaskSlot({
  children,
  compact,
  active,
  interactive,
  transparent,
}: PanelPresentation & { compact: boolean; active: boolean }) {
  const t = useTranslations("app.shell.workspaceLayout")
  const { actions, taskWidth, taskCollapsed, taskOpacity } = useWorkspaceLayoutPreferences(
    (state) => state,
  )
  const resize = useCallback((width: number) => actions.setWidth("task", width), [actions])
  const reset = useCallback(() => actions.setWidth("task", 320), [actions])
  const visible = active && (compact || !taskCollapsed)
  return (
    <ViewportGridItem
      id="workspace-task"
      area={compact ? "bottom" : "right"}
      visible={visible}
      width={taskWidth}
      minWidth={280}
      maxWidth={480}
      resizeLabel={t("taskResize")}
      onWidthChange={interactive && !compact ? resize : undefined}
      onResetWidth={reset}
      maxHeight={compact ? "min(50svh, 32rem)" : undefined}
    >
      <div
        className="workspace-panel workspace-panel--task"
        data-collapsed={!visible}
        data-compact={compact}
        data-transparent={transparent}
        inert={!interactive || !visible}
        aria-hidden={!interactive || undefined}
        style={{ "--workspace-task-opacity": `${taskOpacity}%` } as CSSProperties}
      >
        {children}
      </div>
    </ViewportGridItem>
  )
}

/** Feature compositions declare content; the shared grid owns placement and resizing. */
export function WorkspacePanels({
  allowTransparency,
  children,
  bottom,
  interactive = true,
  left,
  revealTreeRequest,
  right,
  taskPanelActive = true,
}: {
  allowTransparency: boolean
  children: ReactNode
  bottom?: ReactNode
  interactive?: boolean
  left: ReactNode
  revealTreeRequest?: number | undefined
  right: ReactNode
  taskPanelActive?: boolean
}) {
  const compact = useCompactTaskPanel()
  const narrow = useNarrowWorkspace()
  const workspaceTask = useWorkspaceTask()
  const taskActive = taskPanelActive || workspaceTask !== null
  const hasTransparentPanel = useWorkspaceLayoutPreferences(
    (state) => state.treeOpacity < 100 || state.taskOpacity < 100,
  )
  const root = useRef<HTMLDivElement>(null)
  const drawer = useTreeDrawer(narrow, revealTreeRequest, root)
  const transparent = allowTransparency && !compact
  return (
    <CompactModelTreeContext.Provider value={drawer}>
      <div
        ref={root}
        className="cad-workspace-grid min-h-0"
        data-task-active={taskActive}
        data-compact={compact}
        data-narrow={narrow}
        data-transparent={transparent && hasTransparentPanel}
      >
        <div className="workspace-viewport">
          {children}
          {interactive && <IdleModelTreeToggle taskActive={taskActive} narrow={narrow} />}
        </div>
        <TreeSlot drawer={drawer} interactive={interactive} transparent={transparent}>
          {left}
        </TreeSlot>
        <TaskSlot
          active={taskActive}
          compact={compact}
          interactive={interactive}
          transparent={transparent}
        >
          {right}
        </TaskSlot>
        <ViewportGridItem id="workspace-history" area="bottom" order={50} visible={Boolean(bottom)}>
          <div className="workspace-history min-w-0">{bottom}</div>
        </ViewportGridItem>
      </div>
    </CompactModelTreeContext.Provider>
  )
}
