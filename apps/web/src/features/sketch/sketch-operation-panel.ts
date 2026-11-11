import { cn } from "@vibeshape/ui/lib/cn"
import { SAFE_VIEWPORT_RIGHT } from "../../shell/viewport-chrome-styles"

/**
 * Bottom-right placement shared by sketch operation panels (transform, patterns, corner
 * treatment). It stays inside the canvas region left free by floating workspace windows and
 * scrolls instead of growing past the top of a short canvas.
 */
export const SKETCH_OPERATION_PANEL_CLASS_NAME = cn(
  "absolute bottom-3 right-3 z-10 w-80 gap-3 overflow-y-auto bg-background/95 p-3 shadow-md",
  SAFE_VIEWPORT_RIGHT,
  "max-h-[calc(100%_-_var(--workspace-chrome-top,0px)_-_var(--workspace-chrome-bottom,0px)_-_1.5rem)]",
)
