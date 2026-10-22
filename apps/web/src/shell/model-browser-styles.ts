import { cn } from "@vibeshape/ui/lib/cn"

// Keep disclosure, object icons, labels, and trailing controls on shared browser gutters.
const modelBrowserRow = cn(
  "h-8 min-w-0 justify-start gap-2 rounded-sm px-2 text-sm font-normal",
  "focus-visible:ring-2 focus-visible:ring-inset",
)
export const modelBrowserChildRow = cn(modelBrowserRow, "pl-8")
export const modelBrowserGroupRow = cn(
  "min-w-0 w-full justify-start gap-2 rounded-sm px-2 pr-9 text-xs font-medium",
  "focus-visible:ring-2 focus-visible:ring-inset",
)
export const modelBrowserSelectedRow = "bg-accent text-accent-foreground hover:bg-accent"
export const modelBrowserHighlightedRow =
  "bg-accent hover:bg-accent after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:ring-1 after:ring-primary after:ring-inset"
export const modelBrowserCount = "ml-auto text-xs tabular-nums text-muted-foreground"
export const modelBrowserItem = cn(
  "relative flex min-w-0 items-center rounded-sm pr-1 hover:bg-accent/50",
  "[&>[role=treeitem]:hover]:bg-transparent",
)
