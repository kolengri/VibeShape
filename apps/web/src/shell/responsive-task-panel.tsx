import { Button } from "@vibeshape/ui/components/button"
import { PanelBottomClose, PanelBottomOpen } from "@vibeshape/ui/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { CompactModelTreeToggle } from "./compact-model-tree"

const compactTaskPanelQuery = "(width < 64rem)"

function subscribeToCompactTaskPanel(change: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined
  const mediaQuery = window.matchMedia(compactTaskPanelQuery)
  mediaQuery.addEventListener("change", change)
  return () => mediaQuery.removeEventListener("change", change)
}

function compactTaskPanelSnapshot() {
  return (
    typeof window !== "undefined" && Boolean(window.matchMedia?.(compactTaskPanelQuery).matches)
  )
}

export function useCompactTaskPanel() {
  return useSyncExternalStore(subscribeToCompactTaskPanel, compactTaskPanelSnapshot, () => false)
}

export type ResponsiveTaskPanelProps = Readonly<{
  activeTaskKey: string | null
  autoExpandActiveTask?: boolean
  children: ReactNode
  collapseLabel: string
  expandLabel: string
}>

/** Keeps one task form mounted while presenting it as a collapsible narrow-screen sheet. */
export function ResponsiveTaskPanel({
  activeTaskKey,
  autoExpandActiveTask = true,
  children,
  collapseLabel,
  expandLabel,
}: ResponsiveTaskPanelProps) {
  const compact = useCompactTaskPanel()
  const contentId = useId()
  const content = useRef<HTMLDivElement>(null)
  const activeTaskExpanded = activeTaskKey !== null && autoExpandActiveTask
  const [expansion, setExpansion] = useState<{
    taskKey: string | null
    choice: boolean | null
  }>(() => ({ taskKey: activeTaskKey, choice: null }))
  const expanded =
    (expansion.taskKey === activeTaskKey ? expansion.choice : null) ?? activeTaskExpanded

  useLayoutEffect(() => {
    if (expansion.taskKey === activeTaskKey) return
    setExpansion({ taskKey: activeTaskKey, choice: null })
    const element = content.current
    if (!element) return
    element.scrollTop = 0
    for (const panel of element.querySelectorAll<HTMLElement>("aside, [role='complementary']")) {
      panel.scrollTop = 0
    }
  }, [activeTaskKey, expansion.taskKey])

  const panelExpanded = !compact || expanded
  const actionLabel = panelExpanded ? collapseLabel : expandLabel
  const ActionIcon = panelExpanded ? PanelBottomClose : PanelBottomOpen

  return (
    <div className="responsive-task-panel min-h-0" data-expanded={panelExpanded}>
      <div className="responsive-task-panel__toggle relative z-20 border-b bg-panel px-2">
        <CompactModelTreeToggle />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls={contentId}
                aria-expanded={panelExpanded}
                aria-label={actionLabel}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={(event) => {
                  event.currentTarget.focus()
                  setExpansion({ taskKey: activeTaskKey, choice: !expanded })
                }}
              >
                <ActionIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{actionLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div
        ref={content}
        className="responsive-task-panel__content min-h-0 overflow-clip"
        hidden={compact && !expanded}
        id={contentId}
      >
        {children}
      </div>
    </div>
  )
}
