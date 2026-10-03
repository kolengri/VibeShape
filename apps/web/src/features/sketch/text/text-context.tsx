import type { SketchEntityId } from "@vibeshape/domain"
import { createContext, type ReactNode, useContext } from "react"

export type SketchTextActions = {
  error: string | null
  create: () => void
  edit: (groupId: SketchEntityId) => void
  detach: (groupId: SketchEntityId) => void
}
const Context = createContext<SketchTextActions | null>(null)
export function SketchTextActionsProvider({
  actions,
  children,
}: {
  actions: SketchTextActions
  children: ReactNode
}) {
  return <Context.Provider value={actions}>{children}</Context.Provider>
}
export function useSketchTextActions() {
  return useContext(Context)
}
