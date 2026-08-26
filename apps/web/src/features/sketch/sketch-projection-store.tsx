import type { ViewerFrame, ViewerSketchProjectionBounds } from "@vibeshape/viewer/three-viewport"
import { createContext, type ReactNode, useContext, useState } from "react"
import { createStore } from "zustand/vanilla"

export type SketchProjection = Readonly<{
  frame: ViewerFrame
  bounds: ViewerSketchProjectionBounds
}>

type SketchProjectionStore = Readonly<{
  projection: SketchProjection | null
  clear: () => void
  publish: (projection: SketchProjection) => void
}>

export type SketchProjectionStoreApi = ReturnType<typeof createSketchProjectionStore>

export function createSketchProjectionStore() {
  return createStore<SketchProjectionStore>((set) => ({
    projection: null,
    clear: () => set({ projection: null }),
    publish: (projection) => set({ projection }),
  }))
}

const SketchProjectionContext = createContext<SketchProjectionStoreApi | null>(null)

export function SketchProjectionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(() => createSketchProjectionStore())
  return (
    <SketchProjectionContext.Provider value={store}>{children}</SketchProjectionContext.Provider>
  )
}

export function useSketchProjectionStoreApi() {
  return useContext(SketchProjectionContext)
}
