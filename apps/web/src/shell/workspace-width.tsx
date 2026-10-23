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
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const value = useMemo(() => ({ width, root }), [width])
  return <WorkspaceWidthContext.Provider value={value}>{children}</WorkspaceWidthContext.Provider>
}

export function WorkspaceWorkbench({ children }: { children: ReactNode }) {
  const context = useContext(WorkspaceWidthContext)
  return (
    <div ref={context?.root} className="editor-workbench">
      {children}
    </div>
  )
}

export function useWorkspaceWidth() {
  return useContext(WorkspaceWidthContext)?.width ?? null
}
