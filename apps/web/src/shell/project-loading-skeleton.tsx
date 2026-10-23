import { useTranslations } from "@vibeshape/i18n"
import { Skeleton } from "@vibeshape/ui/components/skeleton"
import { builtInEditorCommandDescriptors } from "../commands/built-in-editor-commands"
import { editorCommandIds, type ResolvedEditorCommand } from "../commands/editor-command"
import { CommandToolbar } from "./command-toolbar"
import { ProjectLoadingProgress } from "./project-loading-progress"
import { WorkspacePanels } from "./workspace-panels"
import { WorkspaceWorkbench } from "./workspace-width"

const openingCommands: readonly ResolvedEditorCommand[] = builtInEditorCommandDescriptors
  .filter(
    ({ toolbarGroup, id }) =>
      toolbarGroup === "model-primary" ||
      toolbarGroup === "model-primitives" ||
      toolbarGroup === "model-inspection" ||
      id === editorCommandIds.documentUndo ||
      id === editorCommandIds.documentRedo,
  )
  .map((descriptor) => ({
    descriptor,
    active: false,
    toolbarVisible: true,
    eligibility: { enabled: false, reason: "documentLoading" },
    invoke: () => undefined,
  }))

function ModelTreeSkeleton() {
  const t = useTranslations("app.shell.modelTree")
  return (
    <div data-project-skeleton="tree" className="grid content-start gap-5 p-3">
      <h2 className="text-xs font-medium">{t("ariaLabel")}</h2>
      <div aria-hidden="true" className="grid gap-3">
        {["h-3 w-28", "h-3 w-20", "h-3 w-32", "h-3 w-24"].map((className) => (
          <div key={className} className="flex items-center gap-2">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className={className} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ViewportLoadingSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-project-skeleton="viewport"
      className="pointer-events-none absolute bottom-[var(--workspace-chrome-bottom,0px)] left-[var(--workspace-chrome-left,0px)] right-[var(--workspace-chrome-right,0px)] top-[var(--workspace-chrome-top,0px)] z-30 overflow-hidden bg-viewport-background"
    >
      <div className="absolute left-3 top-3 flex gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="size-7" />
      </div>
      <Skeleton className="absolute right-3 top-3 size-16" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
        <Skeleton className="h-32 w-40 max-w-full rounded-xl" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="absolute bottom-3 left-3 flex gap-2">
        <Skeleton className="size-7" />
        <Skeleton className="h-7 w-20" />
      </div>
    </div>
  )
}

export function ProjectWorkbenchSkeleton() {
  const t = useTranslations("app.shell")
  return (
    <WorkspaceWorkbench>
      <div className="contents">
        <CommandToolbar commands={openingCommands} />
        <div className="editor-model-area grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]">
          <WorkspacePanels
            allowTransparency={false}
            interactive={false}
            taskPanelActive={false}
            right={null}
            left={<ModelTreeSkeleton />}
            bottom={
              <section
                data-project-skeleton="history"
                className="flex h-14 items-center gap-3 overflow-hidden bg-card px-3"
              >
                <span className="shrink-0 text-xs font-medium">{t("modelTree.items.history")}</span>
                {["first", "second", "third", "fourth"].map((item) => (
                  <Skeleton key={item} aria-hidden="true" className="size-8 shrink-0" />
                ))}
              </section>
            }
          >
            <ViewportLoadingSkeleton />
            <ProjectLoadingProgress />
          </WorkspacePanels>
        </div>
        <footer className="flex min-w-0 items-center text-xs text-muted-foreground">
          <span>{t("applicationBar.loading")}</span>
        </footer>
      </div>
    </WorkspaceWorkbench>
  )
}
