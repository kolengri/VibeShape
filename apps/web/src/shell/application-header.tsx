import { useActivityPending } from "@vibeshape/ui/components/activity"
import { cn } from "@vibeshape/ui/lib/cn"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { getDesktopHost } from "../desktop/desktop-host"

const NativeFullScreenContext = createContext(false)

/** Window chrome survives document-keyed headers and library navigation. */
export function ApplicationChromeProvider({ children }: { children: ReactNode }) {
  const [fullScreen, setFullScreen] = useState(false)
  const host = getDesktopHost()
  useEffect(() => host?.onFullScreenChange?.(setFullScreen), [host])
  return (
    <NativeFullScreenContext.Provider value={fullScreen}>
      {children}
    </NativeFullScreenContext.Provider>
  )
}

export function ApplicationHeader({
  busy = false,
  className,
  children,
}: {
  busy?: boolean
  className?: string
  children: ReactNode
}) {
  const activityPending = useActivityPending()
  const fullScreen = useContext(NativeFullScreenContext)
  const host = getDesktopHost()
  const unifiedChrome = host?.platform === "darwin" && host.windowChrome === "unified"
  return (
    <header
      data-loading={activityPending || busy || undefined}
      data-unified-chrome={unifiedChrome || undefined}
      data-full-screen={fullScreen}
      className={cn(
        "application-bar flex min-w-0 shrink-0 items-center border-b bg-toolbar px-2",
        className,
      )}
    >
      {children}
    </header>
  )
}
