import { Button } from "@vibeshape/ui/components/button"
import { FolderOpen, FolderPlus, X } from "@vibeshape/ui/components/icons"
import { Tabs, TabsList, TabsTrigger } from "@vibeshape/ui/components/tabs"
import { cn } from "@vibeshape/ui/lib/cn"
import { useEffect, useId } from "react"
import type { DocumentControllerState, ProjectSwitchResult } from "../document/document-controller"
import { DocumentProjectDialog } from "../document/document-project-dialog"
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
  const feedbackId = useId()
  const message = tabs.feedback ? copy[tabs.feedback] : null
  const disabled = tabs.pending || controller.status !== "ready"
  useEffect(() => {
    if (!tabs.focusRequested || tabs.pending || !tabs.activeId || tabs.libraryOpen) return
    const target = document.getElementById(projectTabId(tabs.activeId))
    if (target) {
      target.focus()
      tabs.actions.clearFocus()
    }
  }, [tabs.activeId, tabs.actions, tabs.focusRequested, tabs.libraryOpen, tabs.pending, tabs.tabs])
  return (
    <nav aria-label={copy.label} className={cn("min-w-0", className)}>
      <Tabs
        value={tabs.activeId ?? ""}
        activationMode="manual"
        onValueChange={tabs.activate}
        aria-busy={tabs.pending}
        aria-describedby={message ? feedbackId : undefined}
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
            <div
              key={tab.documentId}
              className={cn(
                "flex min-w-0 shrink-0 items-center rounded-md",
                tab.documentId === tabs.activeId && "bg-secondary",
              )}
            >
              <TabsTrigger
                value={tab.documentId}
                id={projectTabId(tab.documentId)}
                aria-controls={PROJECT_EDITOR_PANEL_ID}
                disabled={disabled}
                title={tab.name}
                className="max-w-44 truncate py-1 pl-2 pr-1 text-xs"
                onKeyDown={(event) => {
                  if (event.key !== "Delete") return
                  event.preventDefault()
                  void tabs.close(tab.documentId)
                }}
              >
                {tab.name}
              </TabsTrigger>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={copy.closeProject(tab.name)}
                title={copy.closeProject(tab.name)}
                onClick={() => tabs.close(tab.documentId)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
        </TabsList>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={disabled || Boolean(tabs.blocked)}
          aria-label={copy.newProject}
          title={tabs.blocked ? copy.blocked : copy.newProject}
          onClick={tabs.create}
        >
          <FolderPlus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={disabled}
          aria-label={copy.openProjects}
          title={copy.openProjects}
          onClick={tabs.openLibrary}
        >
          <FolderOpen aria-hidden="true" />
        </Button>
      </Tabs>
      {message && (
        <p id={feedbackId} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
      {tabs.storageFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.storageFailed}
        </p>
      )}
      <DocumentProjectDialog
        controller={controller}
        blockedReason={tabs.blocked}
        showTrigger={false}
        open={tabs.libraryOpen}
        onOpenChange={tabs.changeLibraryOpen}
      />
    </nav>
  )
}
