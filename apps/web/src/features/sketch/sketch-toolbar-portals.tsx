import { createContext, type ReactNode, useContext, useMemo, useState } from "react"

type SketchToolbarPortals = Readonly<{
  constraintManagerTarget: HTMLElement | null
  setConstraintManagerTarget: (target: HTMLElement | null) => void
}>

const SketchToolbarPortalsContext = createContext<SketchToolbarPortals | null>(null)

export function SketchToolbarPortalsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [constraintManagerTarget, setConstraintManagerTarget] = useState<HTMLElement | null>(null)
  const value = useMemo(
    () => ({ constraintManagerTarget, setConstraintManagerTarget }),
    [constraintManagerTarget],
  )
  return (
    <SketchToolbarPortalsContext.Provider value={value}>
      {children}
    </SketchToolbarPortalsContext.Provider>
  )
}

function useSketchToolbarPortals() {
  const portals = useContext(SketchToolbarPortalsContext)
  if (!portals) throw new Error("Sketch toolbar portals require SketchToolbarPortalsProvider.")
  return portals
}

export function SketchConstraintManagerToolbarSlot() {
  const { setConstraintManagerTarget } = useSketchToolbarPortals()
  return (
    <span
      ref={setConstraintManagerTarget}
      className="contents"
      data-sketch-constraint-manager-toolbar-slot
    />
  )
}

export function useSketchConstraintManagerToolbarTarget() {
  return useSketchToolbarPortals().constraintManagerTarget
}
