import { useTranslations } from "@vibeshape/i18n"
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@vibeshape/ui/components/resizable"
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { CompactModelTreeContext, useNarrowWorkspace } from "./compact-model-tree"
import { useCompactTaskPanel } from "./responsive-task-panel"
import {
  useWorkspaceLayoutPreferences,
  type WorkspaceLayoutPanel,
  type WorkspaceLayoutPreferencesState,
} from "./workspace-layout-preferences"

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
) {
  const { treeWidth, taskWidth, treeCollapsed, taskCollapsed } = preferences
  const tree = useRef<PanelImperativeHandle | null>(null)
  const task = useRef<PanelImperativeHandle | null>(null)
  const applied = useRef<{ tree: PanelSize; task: PanelSize } | null>(null)
  const [initialTreeSize] = useState(() => (narrow || treeCollapsed ? 0 : treeWidth))
  const [initialTaskSize] = useState(() => (compact || taskCollapsed ? 0 : taskWidth))
  useEffect(() => {
    const next = {
      task: { width: taskWidth, collapsed: compact || taskCollapsed, layout: String(compact) },
      tree: {
        width: treeWidth,
        collapsed: narrow || treeCollapsed,
        layout: narrow ? "drawer" : compact ? "sheet" : "desktop",
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
  }, [compact, narrow, taskCollapsed, taskWidth, treeCollapsed, treeWidth])
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

function taskPresentation(compact: boolean, collapsed: boolean) {
  if (compact) return { min: 0, max: 0, centerMin: 160, collapsed: true, hidden: false }
  return { min: 280, max: 480, centerMin: 320, collapsed, hidden: collapsed }
}

/** Layout changes never replace the viewport or the mounted task form. */
export function WorkspacePanels({
  allowTransparency,
  children,
  history,
  modelTree,
  revealTreeRequest,
  taskPanel,
}: {
  allowTransparency: boolean
  children: ReactNode
  history?: ReactNode
  modelTree: ReactNode
  revealTreeRequest?: number | undefined
  taskPanel: ReactNode
}) {
  const t = useTranslations("app.shell.workspaceLayout")
  const compact = useCompactTaskPanel()
  const narrow = useNarrowWorkspace()
  const [treeOpen, setTreeOpen] = useState(false)
  const treePanelId = useId()
  useEffect(() => {
    if (!narrow) setTreeOpen(false)
  }, [narrow])
  const preferences = useWorkspaceLayoutPreferences((state) => state)
  const root = useRef<HTMLDivElement>(null)
  const { treeCollapsed, taskCollapsed, treeOpacity, taskOpacity, actions } = preferences
  useEffect(() => {
    if (!revealTreeRequest) return
    if (narrow) setTreeOpen(true)
    else actions.setCollapsed("tree", false)
  }, [actions, narrow, revealTreeRequest])

  const treeLayout = treePresentation(narrow, treeOpen, treeCollapsed)
  const taskLayout = taskPresentation(compact, taskCollapsed)
  const { tree, task, initialTreeSize, initialTaskSize } = usePanelSizes(
    preferences,
    compact,
    narrow,
  )

  function trackSize(panel: "tree" | "task", pixels: number) {
    // Keep pointer-rate layout out of React, persistence, and document/geometry state.
    root.current?.style.setProperty(`--workspace-${panel}-size`, `${pixels}px`)
  }

  function persistLayout() {
    if (!narrow) persistPanelSize("tree", tree.current, actions)
    if (!compact) persistPanelSize("task", task.current, actions)
  }

  return (
    <CompactModelTreeContext.Provider
      value={{
        narrow,
        open: treeOpen,
        panelId: treePanelId,
        toggle: () => setTreeOpen((open) => !open),
      }}
    >
      <div className="flex min-h-0 flex-col">
        <div
          ref={root}
          className="cad-workspace-grid min-h-0 flex-1"
          data-transparent={
            allowTransparency && !compact && (treeOpacity < 100 || taskOpacity < 100)
          }
          style={
            {
              "--workspace-tree-opacity": `${treeOpacity}%`,
              "--workspace-task-opacity": `${taskOpacity}%`,
            } as CSSProperties
          }
        >
          <div className="workspace-viewport">{children}</div>
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
            <ResizableHandle
              aria-label={t("taskResize")}
              className="pointer-events-auto max-lg:hidden"
              disabled={compact}
              disableDoubleClick
              onDoubleClick={() => {
                actions.setCollapsed("task", false)
                actions.setWidth("task", 320)
                task.current?.resize(320)
              }}
            />
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
        </div>
        {history}
      </div>
    </CompactModelTreeContext.Provider>
  )
}
