import { useReportBlockingActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { FilesIcon, NewProjectIcon, X } from "@vibeshape/ui/components/icons"
import { Tabs, TabsList, TabsTrigger } from "@vibeshape/ui/components/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { useEffect, useId } from "react"
import type { DocumentControllerState, ProjectSwitchResult } from "../document/document-controller"
import { useReportApplicationError } from "../shell/application-notices"
import { useProjectTabsController } from "./use-project-tabs"

export const PROJECT_EDITOR_PANEL_ID = "project-editor-panel"
export const projectTabId = (documentId: string) => `project-tab-${documentId}`

export type ProjectTabsCopy = Readonly<{
  label: string
  newProject: string
  openProjects: string
  closeProject: (name: string) => string
  blocked: string
  switchFailed: string
  listFailed: string
  storageFailed: string
  working: string
}>

export function ProjectTabs({
  controller,
  copy,
  className,
  onOpenProjects,
}: {
  controller: DocumentControllerState
  copy: ProjectTabsCopy
  className?: string
  onOpenProjects?: () => Promise<ProjectSwitchResult>
}) {
  const tabs = useProjectTabsController(controller, onOpenProjects)
  useReportBlockingActivity(tabs.pending, copy.working)
  const feedbackId = useId()
  const message = tabs.feedback ? copy[tabs.feedback] : null
  const centralized = useReportApplicationError(message, tabs.feedbackAttempt)
  const storageCentralized = useReportApplicationError(
    tabs.storageFailed ? copy.storageFailed : null,
  )
  const disabled = tabs.pending || controller.status !== "ready"
  useEffect(() => {
    if (!tabs.focusRequested || tabs.pending || !tabs.activeId) return
    const target = document.getElementById(projectTabId(tabs.activeId))
    if (target) {
      target.focus()
      tabs.actions.clearFocus()
    }
  }, [tabs.activeId, tabs.actions, tabs.focusRequested, tabs.pending, tabs.tabs])
  return (
    <nav aria-label={copy.label} className={cn("min-w-0", className)}>
      <Tabs
        value={tabs.activeId ?? ""}
        activationMode="manual"
        onValueChange={tabs.activate}
        aria-busy={tabs.pending}
        aria-describedby={message && !centralized ? feedbackId : undefined}
        className="flex min-w-0 items-center gap-1"
      >
        <TabsList
          aria-label={copy.label}
          className="min-w-0 flex-1 flex-nowrap overflow-x-auto border-0 pb-0"
          onFocusCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) void tabs.refresh()
          }}
          onPointerEnter={() => void tabs.refresh()}
        >
          {tabs.tabs.map((tab) => (
            <ProjectTab
              key={tab.documentId}
              tab={tab}
              active={tab.documentId === tabs.activeId}
              disabled={disabled}
              closeLabel={copy.closeProject(tab.name)}
              onClose={tabs.close}
            />
          ))}
        </TabsList>
        <ProjectTabActions tabs={tabs} disabled={disabled} copy={copy} />
      </Tabs>
      {message && !centralized && (
        <p id={feedbackId} role="alert" className="sr-only">
          {message}
        </p>
      )}
      {tabs.storageFailed && !storageCentralized && (
        <p role="status" className="sr-only">
          {copy.storageFailed}
        </p>
      )}
    </nav>
  )
}

function ProjectTab({
  tab,
  active,
  disabled,
  closeLabel,
  onClose,
}: {
  tab: ReturnType<typeof useProjectTabsController>["tabs"][number]
  active: boolean
  disabled: boolean
  closeLabel: string
  onClose: ReturnType<typeof useProjectTabsController>["close"]
}) {
  return (
    <div className={cn("flex min-w-0 shrink-0 items-center rounded-md", active && "bg-secondary")}>
      <TabsTrigger
        value={tab.documentId}
        id={projectTabId(tab.documentId)}
        aria-controls={PROJECT_EDITOR_PANEL_ID}
        disabled={disabled}
        className="max-w-44 truncate py-1 pl-2 pr-1 text-xs"
        onKeyDown={(event) => {
          if (event.key !== "Delete") return
          event.preventDefault()
          void onClose(tab.documentId)
        }}
      >
        {tab.name}
      </TabsTrigger>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={disabled}
            aria-label={closeLabel}
            onClick={() => onClose(tab.documentId)}
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{closeLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function ProjectTabActions({
  tabs,
  disabled,
  copy,
}: {
  tabs: ReturnType<typeof useProjectTabsController>
  disabled: boolean
  copy: ProjectTabsCopy
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled || Boolean(tabs.blocked)}
            aria-label={copy.newProject}
            onClick={tabs.create}
          >
            <NewProjectIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tabs.blocked ? copy.blocked : copy.newProject}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={copy.openProjects}
            onClick={tabs.openLibrary}
          >
            <FilesIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copy.openProjects}</TooltipContent>
      </Tooltip>
    </>
  )
}
