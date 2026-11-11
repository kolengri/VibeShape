import { cn } from "@vibeshape/ui/lib/cn"
import { createContext, type ReactNode, useContext, useState } from "react"
import { createPortal } from "react-dom"

type SketchOperationLayerValue = Readonly<{ host: HTMLDivElement | null }>

// `null` means no layer: operation panels render in place inside the drawing.
const SketchOperationLayerContext = createContext<SketchOperationLayerValue | null>(null)

/**
 * Hosts sketch operation panels in a sibling layer above the viewport view controls. The sketch
 * overlay section is its own lower stacking context, so panels rendered inside it sit below the
 * Rotate view cluster. The layer passes pointer input through except where a panel is rendered and
 * mirrors the section's inert, hidden state while the 3D context owns navigation. React portals
 * keep the panels in the sketch editor's React tree, so its context and synthetic events still
 * apply, and the layer stays inside the same sketch shortcut surface for document-level handlers.
 */
export function SketchOperationLayer({
  children,
  enabled,
  interactive,
}: Readonly<{ children: ReactNode; enabled: boolean; interactive: boolean }>) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  if (!enabled) return children
  return (
    <SketchOperationLayerContext.Provider value={{ host }}>
      {children}
      <div
        ref={setHost}
        aria-hidden={interactive ? undefined : true}
        className={cn(
          "pointer-events-none absolute inset-0 z-30 overflow-hidden",
          !interactive && "opacity-0",
        )}
        data-sketch-operation-layer=""
        inert={interactive ? undefined : true}
      />
    </SketchOperationLayerContext.Provider>
  )
}

/** Renders operation panels into the sketch operation layer when one exists, else in place. */
export function SketchOperationPanels({ children }: Readonly<{ children: ReactNode }>) {
  const layer = useContext(SketchOperationLayerContext)
  if (!layer) return children
  // Wait for the host instead of mounting in place first, which would remount panel form state.
  return layer.host ? createPortal(children, layer.host) : null
}
