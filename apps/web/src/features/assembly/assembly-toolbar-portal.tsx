import { createContext, type ReactNode, useContext, useMemo, useState } from "react"
import { createPortal } from "react-dom"

type ToolbarPortal = {
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
}
const AssemblyToolbarContext = createContext<ToolbarPortal | null>(null)

export function AssemblyToolbarProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ target, setTarget }), [target])
  return <AssemblyToolbarContext.Provider value={value}>{children}</AssemblyToolbarContext.Provider>
}

export function AssemblyToolbarSlot() {
  const portal = useContext(AssemblyToolbarContext)
  return <div ref={portal?.setTarget} className="min-w-0 flex-1 overflow-x-auto" />
}

export function AssemblyToolbarPortal({ children }: { children: ReactNode }) {
  const portal = useContext(AssemblyToolbarContext)
  return portal?.target ? createPortal(children, portal.target) : null
}
