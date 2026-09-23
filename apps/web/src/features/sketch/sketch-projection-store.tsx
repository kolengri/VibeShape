import type {
  ViewerFrame,
  ViewerSketchPlaneProjection,
  ViewerSketchProjectionBounds,
} from "@vibeshape/viewer/three-viewport"
import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react"
import { createStore } from "zustand/vanilla"

export type SketchProjection = Readonly<{
  frame: ViewerFrame
  bounds: ViewerSketchProjectionBounds
}>

type SketchProjectionStore = Readonly<{
  projection: SketchProjection | null
  cameraProjection: ViewerSketchPlaneProjection | null
  navigationElement: HTMLElement | SVGSVGElement | null
  publishCameraProjection: (projection: ViewerSketchPlaneProjection | null) => void
  setNavigationElement: (element: HTMLElement | SVGSVGElement | null) => void
  clear: () => void
  publish: (projection: SketchProjection) => void
}>

export type SketchProjectionStoreApi = ReturnType<typeof createSketchProjectionStore>

export function createSketchProjectionStore() {
  return createStore<SketchProjectionStore>((set) => ({
    projection: null,
    cameraProjection: null,
    navigationElement: null,
    publishCameraProjection: (cameraProjection) => set({ cameraProjection }),
    setNavigationElement: (navigationElement) => set({ navigationElement }),
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

const subscribeWithoutProvider = () => () => undefined

export function useSketchCameraProjection() {
  const store = useSketchProjectionStoreApi()
  return useSyncExternalStore(
    store?.subscribe ?? subscribeWithoutProvider,
    () => store?.getState().cameraProjection ?? null,
  )
}
