import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { ViewportGrid, ViewportGridBottom } from "./viewport-grid"

const WorkspaceWidthContext = createContext<{
  width: number | null
  root: RefObject<HTMLDivElement | null>
} | null>(null)

export function WorkspaceWidthProvider({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const update = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      setWidth(element.getBoundingClientRect().width / rem)
    }
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  const value = useMemo(() => ({ width, root }), [width])
  return <WorkspaceWidthContext.Provider value={value}>{children}</WorkspaceWidthContext.Provider>
}

export function WorkspaceWorkbench({ children }: { children: ReactNode }) {
  const context = useContext(WorkspaceWidthContext)
  return (
    <ViewportGrid>
      <div ref={context?.root} className="editor-workbench">
        {children}
        <ViewportGridBottom />
      </div>
    </ViewportGrid>
  )
}

export function useWorkspaceWidth() {
  return useContext(WorkspaceWidthContext)?.width ?? null
}
