import { cn } from "@vibeshape/ui/lib/cn"
import { type ComponentProps, createContext, type ReactNode, useContext } from "react"
import { TaskPanelFooter } from "./task-panel-footer"
import { TaskPanelHeader } from "./task-panel-header"
import { useWindowCollapse, WindowCollapseProvider } from "./window-collapse"

const supplementalContent = createContext<{ before: ReactNode; after: ReactNode }>({
  before: null,
  after: null,
})

export function TaskPanelContentProvider({
  content,
  trailingContent,
  children,
}: {
  content?: ReactNode
  trailingContent?: ReactNode
  children: ReactNode
}) {
  const inherited = useContext(supplementalContent)
  return (
    <supplementalContent.Provider
      value={{
        before: (
          <>
            {inherited.before}
            {content}
          </>
        ),
        after: (
          <>
            {trailingContent}
            {inherited.after}
          </>
        ),
      }}
    >
      {children}
    </supplementalContent.Provider>
  )
}

export function TaskPanelSurface({
  children,
  trailingContent,
  className,
  ...props
}: ComponentProps<"aside"> & { trailingContent?: ReactNode }) {
  return (
    <aside
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel", className)}
      {...props}
    >
      <TaskPanelContentProvider trailingContent={trailingContent}>
        {children}
      </TaskPanelContentProvider>
    </aside>
  )
}

/** Keeps command identity and lifecycle actions outside the field scrollport, inside the owning form. */
export function TaskPanelLayout(props: Parameters<typeof TaskPanelLayoutContent>[0]) {
  return (
    <WindowCollapseProvider>
      <TaskPanelLayoutContent {...props} />
    </WindowCollapseProvider>
  )
}

function TaskPanelLayoutContent({
  title,
  description,
  instruction,
  actions,
  footerContent,
  children,
  className,
  contentClassName,
}: {
  title: string
  description?: ReactNode
  instruction?: ReactNode
  actions?: ReactNode
  footerContent?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  const supplement = useContext(supplementalContent)
  const collapse = useWindowCollapse()
  return (
    <div
      data-slot="task-panel-layout"
      data-window-collapsed={collapse?.collapsed}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        "[&_[data-slot=input]]:h-7 [&_[data-slot=input]]:px-2 [&_[data-slot=input]]:text-xs",
        className,
      )}
    >
      <TaskPanelHeader title={title} description={description} />
      <div
        data-slot="task-panel-content"
        id={collapse?.contentId}
        inert={collapse?.collapsed}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
          contentClassName,
        )}
      >
        <div className="grid min-w-0 content-start gap-1.5 p-2">
          {instruction ? (
            <p className="break-words text-xs leading-4 text-muted-foreground">{instruction}</p>
          ) : null}
          {supplement.before}
          {children}
          {supplement.after}
        </div>
      </div>
      {actions || footerContent ? (
        <TaskPanelFooter>
          {footerContent}
          {actions ? <div className="flex min-w-0 justify-end">{actions}</div> : null}
        </TaskPanelFooter>
      ) : null}
    </div>
  )
}
