import { useTranslations } from "@vibeshape/i18n"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import { createContext, type ReactNode, useCallback, useContext, useId, useState } from "react"

const WindowCollapseContext = createContext<{
  collapsed: boolean
  contentId: string
  toggle: () => void
  expand: () => void
} | null>(null)

/** Collapsing a window hides its retained content without disposing drafts or connections. */
export function WindowCollapseProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const expand = useCallback(() => setCollapsed(false), [])
  return (
    <WindowCollapseContext
      value={{ collapsed, contentId, expand, toggle: () => setCollapsed((value) => !value) }}
    >
      {children}
    </WindowCollapseContext>
  )
}

export function useWindowCollapse() {
  return useContext(WindowCollapseContext)
}

export function WindowCollapseTitle({ children }: { children: string }) {
  const window = useWindowCollapse()
  return window ? <WindowCollapseButton window={window}>{children}</WindowCollapseButton> : children
}

function WindowCollapseButton({
  window,
  children,
}: {
  window: NonNullable<ReturnType<typeof useWindowCollapse>>
  children: string
}) {
  const t = useTranslations("app.shell.workspaceLayout")
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-sm text-left",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={t(window.collapsed ? "expandWindow" : "collapseWindow", { title: children })}
      aria-expanded={!window.collapsed}
      aria-controls={window.contentId}
      onClick={window.toggle}
    >
      <ChevronDown
        aria-hidden="true"
        className={cn("size-3 shrink-0", window.collapsed && "-rotate-90")}
      />
      <span className="min-w-0 break-words">{children}</span>
    </button>
  )
}
