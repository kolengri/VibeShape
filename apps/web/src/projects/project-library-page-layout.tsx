import type { ReactNode } from "react"
import { getDesktopHost } from "../desktop/desktop-host"
import type { DocumentControllerState } from "../document/document-controller"
import { ProjectLibraryActions } from "./project-library-actions"

export function ProjectLibraryPageLayout({
  controller,
  title,
  description,
  children,
}: {
  controller: DocumentControllerState
  title: string
  description: string
  children: ReactNode
}) {
  const desktop = getDesktopHost()
  const unifiedChrome = desktop?.platform === "darwin" && desktop.windowChrome === "unified"
  return (
    <main className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <header
        data-unified-chrome={unifiedChrome || undefined}
        className="application-bar flex h-14 shrink-0 items-center border-b bg-toolbar px-6"
      >
        <span className="font-semibold">VibeShape</span>
        <ProjectLibraryActions controller={controller} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-8">
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}
