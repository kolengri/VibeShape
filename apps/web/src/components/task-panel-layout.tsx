import { cn } from "@vibeshape/ui/lib/cn"
import { type ComponentProps, createContext, type ReactNode, useContext, useRef } from "react"
import { TaskPanelFooter } from "./task-panel-footer"
import { useTaskPanelFooterFit } from "./task-panel-footer-fit"
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

type TaskPanelLayoutProps = {
  title: string
  description?: ReactNode
  instruction?: ReactNode
  actions?: ReactNode
  footerContent?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

function TaskPanelLayoutContent({
  title,
  description,
  actions,
  footerContent,
  className,
  ...fields
}: TaskPanelLayoutProps) {
  const layout = useRef<HTMLDivElement>(null)
  // A short sheet (200% zoom on a compact window) cannot pin the footer beside a usable field
  // scrollport; it then scrolls as one region and a fade marks the content below.
  const fit = useTaskPanelFooterFit(layout)
  const collapse = useWindowCollapse()
  return (
    <div
      ref={layout}
      data-slot="task-panel-layout"
      data-window-collapsed={collapse?.collapsed}
      data-footer-layout={fit.flow ? "flow" : "pinned"}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overscroll-contain",
        fit.flow ? "overflow-y-auto" : "overflow-hidden",
        "[&_[data-slot=input]]:h-7 [&_[data-slot=input]]:px-2 [&_[data-slot=input]]:text-xs",
        className,
      )}
      onScroll={fit.onScroll}
    >
      <TaskPanelHeader title={title} description={description} />
      <TaskPanelFields flow={fit.flow} {...fields} />
      {actions || footerContent ? (
        <TaskPanelFooter>
          {footerContent}
          {actions ? <div className="flex min-w-0 justify-end">{actions}</div> : null}
        </TaskPanelFooter>
      ) : null}
      {fit.more ? <TaskPanelScrollCue /> : null}
    </div>
  )
}

/** The field scrollport; in a short window it takes its natural height inside the one scroller. */
function TaskPanelFields({
  flow,
  instruction,
  children,
  contentClassName,
}: Pick<TaskPanelLayoutProps, "instruction" | "children" | "contentClassName"> & {
  flow: boolean
}) {
  const supplement = useContext(supplementalContent)
  const collapse = useWindowCollapse()
  return (
    <div
      data-slot="task-panel-content"
      id={collapse?.contentId}
      inert={collapse?.collapsed}
      className={cn(
        "min-h-16 min-w-0",
        flow ? "flex-none" : "flex-1 overflow-y-auto",
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
  )
}

/** Decorative bottom fade that marks content below a short window's visible area. */
function TaskPanelScrollCue() {
  return (
    <div
      aria-hidden="true"
      data-slot="task-panel-scroll-cue"
      className={cn(
        "pointer-events-none sticky bottom-0 -mt-6 h-6 shrink-0",
        "border-b-2 border-primary/60 bg-linear-to-t from-panel to-transparent",
      )}
    />
  )
}
