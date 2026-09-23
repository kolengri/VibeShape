import { useTranslations } from "@vibeshape/i18n"
import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@vibeshape/ui/components/resizable"
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { useCompactTaskPanel } from "./responsive-task-panel"
import {
  useWorkspaceLayoutPreferences,
  type WorkspaceLayoutPanel,
  type WorkspaceLayoutPreferencesState,
} from "./workspace-layout-preferences"

function usePanelSize(width: number, collapsed: boolean) {
  const ref = useRef<PanelImperativeHandle | null>(null)
  const [defaultSize] = useState(() => (collapsed ? 0 : width))
  useEffect(() => {
    // Breakpoints re-register constraints; apply preferences after that layout settles.
    const frame = requestAnimationFrame(() => {
      if (collapsed) ref.current?.collapse()
      else ref.current?.resize(width)
    })
    return () => cancelAnimationFrame(frame)
  }, [collapsed, width])
  return { ref, defaultSize }
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

/** Layout changes never replace the viewport or the mounted task form. */
export function WorkspacePanels({
  allowTransparency,
  children,
  modelTree,
  taskPanel,
}: {
  allowTransparency: boolean
  children: ReactNode
  modelTree: ReactNode
  taskPanel: ReactNode
}) {
  const t = useTranslations("app.shell.workspaceLayout")
  const compact = useCompactTaskPanel()
  const preferences = useWorkspaceLayoutPreferences((state) => state)
  const root = useRef<HTMLDivElement>(null)
  const { treeWidth, taskWidth, treeCollapsed, taskCollapsed, treeOpacity, taskOpacity, actions } =
    preferences

  const { ref: tree, defaultSize: initialTreeSize } = usePanelSize(treeWidth, treeCollapsed)
  const { ref: task, defaultSize: initialTaskSize } = usePanelSize(
    taskWidth,
    compact || taskCollapsed,
  )

  function trackSize(panel: "tree" | "task", pixels: number) {
    // Keep pointer-rate layout out of React, persistence, and document/geometry state.
    root.current?.style.setProperty(`--workspace-${panel}-size`, `${pixels}px`)
  }

  function persistLayout() {
    persistPanelSize("tree", tree.current, actions)
    if (!compact) persistPanelSize("task", task.current, actions)
  }

  return (
    <div
      ref={root}
      className="cad-workspace-grid min-h-0"
      data-transparent={allowTransparency && !compact && (treeOpacity < 100 || taskOpacity < 100)}
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
          minSize={200}
          maxSize={420}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={({ inPixels }) => trackSize("tree", inPixels)}
          style={{ overflow: "hidden" }}
        >
          <div className="workspace-panel workspace-panel--tree" inert={treeCollapsed}>
            {modelTree}
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label={t("treeResize")}
          className="pointer-events-auto"
          disableDoubleClick
          onDoubleClick={() => {
            actions.setCollapsed("tree", false)
            actions.setWidth("tree", 240)
            tree.current?.resize(240)
          }}
        />
        <ResizablePanel id="workspace-center" minSize={compact ? 160 : 320} aria-hidden="true" />
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
          minSize={compact ? 0 : 280}
          maxSize={compact ? 0 : 480}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={({ inPixels }) => trackSize("task", inPixels)}
          style={{ overflow: "visible" }}
        >
          <div
            className="workspace-panel workspace-panel--task"
            inert={!compact && taskCollapsed}
            data-collapsed={!compact && taskCollapsed}
          >
            {taskPanel}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
