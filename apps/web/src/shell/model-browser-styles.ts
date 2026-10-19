import { cn } from "@vibeshape/ui/lib/cn"

// Keep disclosure, object icons, labels, and trailing controls on shared browser gutters.
const modelBrowserRow = cn(
  "h-8 min-w-0 justify-start gap-2 rounded-sm px-2 text-sm font-normal",
  "focus-visible:ring-2 focus-visible:ring-inset",
)
export const modelBrowserChildRow = cn(modelBrowserRow, "pl-8")
export const modelBrowserGroupRow = cn(modelBrowserRow, "w-full pr-9")
export const modelBrowserSelectedRow = "bg-accent text-accent-foreground"
export const modelBrowserCount = "ml-auto text-xs tabular-nums text-muted-foreground"
export const modelBrowserItem = "flex min-w-0 items-center rounded-sm pr-1 hover:bg-accent/50"
