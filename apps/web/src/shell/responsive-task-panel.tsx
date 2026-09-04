import { Button } from "@vibeshape/ui/components/button"
import { PanelBottomClose, PanelBottomOpen } from "@vibeshape/ui/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react"

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

function useCompactTaskPanel() {
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
  const activeTaskExpanded = activeTaskKey !== null && autoExpandActiveTask
  const [expanded, setExpanded] = useState(activeTaskExpanded)

  useEffect(
    () => setExpanded(activeTaskKey !== null && autoExpandActiveTask),
    [activeTaskKey, autoExpandActiveTask],
  )

  const panelExpanded = !compact || expanded
  const actionLabel = panelExpanded ? collapseLabel : expandLabel
  const ActionIcon = panelExpanded ? PanelBottomClose : PanelBottomOpen

  return (
    <div className="responsive-task-panel min-h-0" data-expanded={panelExpanded}>
      <div className="responsive-task-panel__toggle border-b bg-panel px-2">
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
                onClick={() => setExpanded((current) => !current)}
              >
                <ActionIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{actionLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div
        className="responsive-task-panel__content min-h-0"
        hidden={compact && !expanded}
        id={contentId}
      >
        {children}
      </div>
    </div>
  )
}
