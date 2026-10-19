import type { ReactNode } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { ApplicationHeader } from "../shell/application-header"
import { ApplicationMenu } from "../shell/application-menu"

export function ProjectLibraryPageLayout({
  controller,
  title,
  description,
  busy = false,
  children,
}: {
  controller: DocumentControllerState
  title: string
  description: string
  busy?: boolean
  children: ReactNode
}) {
  return (
    <main className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <ApplicationHeader busy={busy} className="h-14">
        <ApplicationMenu controller={controller} scope="library" busy={busy} />
      </ApplicationHeader>
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
