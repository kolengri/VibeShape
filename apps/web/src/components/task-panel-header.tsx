import { cn } from "@vibeshape/ui/lib/cn"
import { createContext, type ReactNode, useContext } from "react"

const supplementalContent = createContext<ReactNode>(null)

export function TaskPanelHeaderContentProvider({
  content,
  children,
}: {
  content: ReactNode
  children: ReactNode
}) {
  return <supplementalContent.Provider value={content}>{children}</supplementalContent.Provider>
}

export function TaskPanelHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  actions: ReactNode
  className?: string
  children?: ReactNode
}) {
  const supplement = useContext(supplementalContent)
  return (
    <header
      className={cn(
        "sticky top-0 z-10 grid min-w-0 gap-2 bg-transparent max-lg:bg-panel",
        // Cover the compact scrollport's top padding without moving the header or its actions.
        "max-lg:before:pointer-events-none max-lg:before:absolute max-lg:before:inset-x-0 max-lg:before:-top-4 max-lg:before:h-4 max-lg:before:bg-panel max-lg:before:content-['']",
        className,
      )}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <h2 className="min-w-0 truncate text-sm font-medium" title={title}>
          {title}
        </h2>
        <div className="min-w-0 max-w-40 justify-self-end">{actions}</div>
      </div>
      {description ? (
        <p className="break-words text-xs leading-4 text-muted-foreground">{description}</p>
      ) : null}
      {children}
      {supplement}
    </header>
  )
}
