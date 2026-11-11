import { cn } from "@vibeshape/ui/lib/cn"
import { SAFE_VIEWPORT_RIGHT } from "../../shell/viewport-chrome-styles"

/**
 * Bottom-right placement shared by sketch operation panels (transform, patterns, corner
 * treatment). It stays inside the canvas region left free by floating workspace windows and
 * scrolls instead of growing past the top of a short canvas. Panels render in the pass-through
 * sketch operation layer above the viewport view controls, so they re-enable their own pointer
 * input. The height cap keeps the top-right view-control row (0.75rem inset, 2.625rem tall, 0.5rem
 * gap) clear while at least 10rem of panel remains; a shorter canvas gives the panel its full
 * height, covering the controls until the operation is applied or cancelled.
 */
export const SKETCH_OPERATION_PANEL_CLASS_NAME = cn(
  "pointer-events-auto absolute bottom-3 right-3 z-10 w-80 gap-3 overflow-y-auto bg-background/95 p-3 shadow-md",
  SAFE_VIEWPORT_RIGHT,
  "max-h-[max(min(100%_-_var(--workspace-chrome-top,0px)_-_var(--workspace-chrome-bottom,0px)_-_1.5rem,10rem),100%_-_var(--workspace-chrome-top,0px)_-_var(--workspace-chrome-bottom,0px)_-_4.625rem)]",
)
