import { useTranslations } from "@vibeshape/i18n"
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@vibeshape/ui/components/resizable"
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  CompactModelTreeContext,
  CompactModelTreeToggle,
  useNarrowWorkspace,
} from "./compact-model-tree"
import { useCompactTaskPanel } from "./responsive-task-panel"
import {
  useWorkspaceLayoutPreferences,
  type WorkspaceLayoutPanel,
  type WorkspaceLayoutPreferencesState,
} from "./workspace-layout-preferences"
import { useWorkspaceTask } from "./workspace-task-context"

type PanelSize = { width: number; collapsed: boolean; layout: string }

function samePanelSize(previous: PanelSize | undefined, next: PanelSize) {
  return (
    previous?.width === next.width &&
    previous.collapsed === next.collapsed &&
    previous.layout === next.layout
  )
}

function applyPanelSize(panel: PanelImperativeHandle | null, size: PanelSize) {
  if (size.collapsed) panel?.collapse()
  else panel?.resize(size.width)
}

function usePanelSizes(
  preferences: WorkspaceLayoutPreferencesState,
  compact: boolean,
  narrow: boolean,
  taskActive: boolean,
) {
  const { treeWidth, taskWidth, treeCollapsed, taskCollapsed } = preferences
  const tree = useRef<PanelImperativeHandle | null>(null)
  const task = useRef<PanelImperativeHandle | null>(null)
  const applied = useRef<{ tree: PanelSize; task: PanelSize } | null>(null)
  const [initialTreeSize] = useState(() => (narrow || treeCollapsed ? 0 : treeWidth))
  const [initialTaskSize] = useState(() =>
    compact || taskCollapsed || !taskActive ? 0 : taskWidth,
  )
  useEffect(() => {
    const next = {
      task: {
        width: taskWidth,
        collapsed: compact || taskCollapsed || !taskActive,
        layout: `${compact}:${taskActive}`,
      },
      tree: {
        width: treeWidth,
        collapsed: narrow || treeCollapsed,
        layout: `${narrow ? "drawer" : compact ? "sheet" : "desktop"}:${taskActive}`,
      },
    }
    // Breakpoints re-register constraints; apply preferences after that layout settles.
    // Restore the task first so its expansion cannot redistribute the saved tree width.
    const frame = requestAnimationFrame(() => {
      if (!samePanelSize(applied.current?.task, next.task)) applyPanelSize(task.current, next.task)
      if (!samePanelSize(applied.current?.tree, next.tree)) applyPanelSize(tree.current, next.tree)
      applied.current = next
    })
    return () => cancelAnimationFrame(frame)
  }, [compact, narrow, taskActive, taskCollapsed, taskWidth, treeCollapsed, treeWidth])
  return { tree, task, initialTreeSize, initialTaskSize }
}

function persistPanelSize(
  panel: WorkspaceLayoutPanel,
  handle: PanelImperativeHandle | null,
  actions: WorkspaceLayoutPreferencesState["actions"],
) {
  if (!handle) return
  const collapsed = handle.isCollapsed()
  actions.setCollapsed(panel, collapsed)
  if (!collapsed) actions.setWidth(panel, handle.getSize().inPixels)
}

function treePresentation(narrow: boolean, open: boolean, collapsed: boolean) {
  if (narrow)
    return {
      min: 0,
      max: 0,
      overflow: "visible" as const,
      inert: !open,
      collapsed: true,
      drawerOpen: open,
    }
  return {
    min: 200,
    max: 420,
    overflow: "hidden" as const,
    inert: collapsed,
    collapsed,
    drawerOpen: false,
  }
}

function taskPresentation(compact: boolean, collapsed: boolean, active: boolean) {
  if (!active)
    return { min: 0, max: 0, centerMin: compact ? 160 : 320, collapsed: true, hidden: true }
  if (compact) return { min: 0, max: 0, centerMin: 160, collapsed: true, hidden: false }
  return { min: 280, max: 480, centerMin: 280, collapsed, hidden: collapsed }
}

function IdleModelTreeToggle({ taskActive, narrow }: { taskActive: boolean; narrow: boolean }) {
  if (taskActive || !narrow) return null
  return (
    <div className="absolute bottom-2 left-2 z-30">
      <CompactModelTreeToggle />
    </div>
  )
}

function useModelTreeDrawer(
  narrow: boolean,
  revealRequest: number | undefined,
  actions: WorkspaceLayoutPreferencesState["actions"],
) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!narrow) setOpen(false)
  }, [narrow])
  useEffect(() => {
    if (!revealRequest) return
    if (narrow) setOpen(true)
    else actions.setCollapsed("tree", false)
  }, [actions, narrow, revealRequest])
  return { open, toggle: () => setOpen((current) => !current) }
}

function WorkspacePanelSurface({
  allowTransparency,
  children,
  compact,
  opacity: { treeOpacity, taskOpacity },
  root,
  taskActive,
}: {
  allowTransparency: boolean
  children: ReactNode
  compact: boolean
  opacity: Pick<WorkspaceLayoutPreferencesState, "treeOpacity" | "taskOpacity">
  root: RefObject<HTMLDivElement | null>
  taskActive: boolean
}) {
  useLayoutEffect(() => {
    const element = root.current
    const panel = element?.querySelector<HTMLElement>(".workspace-panel--task")
    if (!element || !panel || !compact) return
    const update = () => {
      element.style.setProperty(
        "--workspace-sheet-observed-height",
        `${panel.getBoundingClientRect().height}px`,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      element.style.removeProperty("--workspace-sheet-observed-height")
    }
  }, [compact, root])
  return (
    <div
      ref={root}
      className="cad-workspace-grid min-h-0 flex-1"
      data-task-active={taskActive}
      data-transparent={allowTransparency && !compact && (treeOpacity < 100 || taskOpacity < 100)}
      style={
        {
          "--workspace-tree-opacity": `${treeOpacity}%`,
          "--workspace-task-opacity": `${taskOpacity}%`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}

function WorkspaceHistory({ children }: { children: ReactNode }) {
  const history = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = history.current
    const shell = element?.closest<HTMLElement>(".cad-shell")
    if (!element || !shell) return
    const update = () => {
      shell.style.setProperty(
        "--workspace-history-height",
        `${element.getBoundingClientRect().height}px`,
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      observer.disconnect()
      shell.style.removeProperty("--workspace-history-height")
    }
  }, [])
  return (
    <div ref={history} className="workspace-history min-w-0 shrink-0">
      {children}
    </div>
  )
}

/** Layout changes never replace the viewport or the mounted task form. */
export function WorkspacePanels({
  allowTransparency,
  children,
  history,
  modelTree,
  revealTreeRequest,
  taskPanel,
  taskPanelActive = true,
}: {
  allowTransparency: boolean
  children: ReactNode
  history?: ReactNode
  modelTree: ReactNode
  revealTreeRequest?: number | undefined
  taskPanel: ReactNode
  taskPanelActive?: boolean
}) {
  const t = useTranslations("app.shell.workspaceLayout")
  const compact = useCompactTaskPanel()
  const workspaceTask = useWorkspaceTask()
  const taskActive = taskPanelActive || workspaceTask !== null
  const narrow = useNarrowWorkspace()
  const treePanelId = useId()
  const preferences = useWorkspaceLayoutPreferences((state) => state)
  const root = useRef<HTMLDivElement>(null)
  const { treeCollapsed, taskCollapsed, actions } = preferences
  const drawer = useModelTreeDrawer(narrow, revealTreeRequest, actions)

  const treeLayout = treePresentation(narrow, drawer.open, treeCollapsed)
  const taskLayout = taskPresentation(compact, taskCollapsed, taskActive)
  const { tree, task, initialTreeSize, initialTaskSize } = usePanelSizes(
    preferences,
    compact,
    narrow,
    taskActive,
  )

  function trackSize(panel: "tree" | "task", pixels: number) {
    // Keep pointer-rate layout out of React, persistence, and document/geometry state.
    root.current?.style.setProperty(`--workspace-${panel}-size`, `${pixels}px`)
  }

  function persistLayout() {
    if (!narrow) persistPanelSize("tree", tree.current, actions)
    if (!compact && taskActive) persistPanelSize("task", task.current, actions)
  }

  return (
    <CompactModelTreeContext.Provider
      value={{
        narrow,
        open: drawer.open,
        panelId: treePanelId,
        toggle: drawer.toggle,
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-col">
        <WorkspacePanelSurface
          root={root}
          taskActive={taskActive}
          allowTransparency={allowTransparency}
          compact={compact}
          opacity={preferences}
        >
          <div className="workspace-viewport">{children}</div>
          <IdleModelTreeToggle taskActive={taskActive} narrow={narrow} />
          <ResizablePanelGroup
            className="pointer-events-none absolute inset-0 z-20"
            onLayoutChanged={(_layout, { isUserInteraction }) => {
              if (isUserInteraction) persistLayout()
            }}
          >
            <ResizablePanel
              id="workspace-tree"
              panelRef={tree}
              defaultSize={initialTreeSize}
              minSize={treeLayout.min}
              maxSize={treeLayout.max}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={({ inPixels }) => trackSize("tree", inPixels)}
              style={{ overflow: treeLayout.overflow }}
            >
              <div
                className="workspace-panel workspace-panel--tree"
                data-drawer-open={treeLayout.drawerOpen}
                id={treePanelId}
                inert={treeLayout.inert}
              >
                {modelTree}
              </div>
            </ResizablePanel>
            <ResizableHandle
              aria-label={t("treeResize")}
              className="pointer-events-auto max-sm:hidden"
              disabled={narrow}
              disableDoubleClick
              onDoubleClick={() => {
                actions.setCollapsed("tree", false)
                actions.setWidth("tree", 240)
                tree.current?.resize(240)
              }}
            />
            <ResizablePanel
              id="workspace-center"
              minSize={taskLayout.centerMin}
              aria-hidden="true"
            />
            {/* A display:none separator sorts at the origin and suppresses the tree hit region. */}
            {taskActive && !compact && (
              <ResizableHandle
                aria-label={t("taskResize")}
                className="pointer-events-auto"
                disableDoubleClick
                onDoubleClick={() => {
                  actions.setCollapsed("task", false)
                  actions.setWidth("task", 320)
                  task.current?.resize(320)
                }}
              />
            )}
            <ResizablePanel
              id="workspace-task"
              panelRef={task}
              defaultSize={initialTaskSize}
              minSize={taskLayout.min}
              maxSize={taskLayout.max}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={({ inPixels }) => trackSize("task", inPixels)}
              style={{ overflow: "visible" }}
            >
              <div
                className="workspace-panel workspace-panel--task"
                inert={taskLayout.hidden}
                data-collapsed={taskLayout.hidden}
              >
                {taskPanel}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </WorkspacePanelSurface>
        <WorkspaceHistory>{history}</WorkspaceHistory>
      </div>
    </CompactModelTreeContext.Provider>
  )
}
