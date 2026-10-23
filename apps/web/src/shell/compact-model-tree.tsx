import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { PanelLeftClose, PanelLeftOpen } from "@vibeshape/ui/components/icons"
import { type ContextType, createContext, useContext, useSyncExternalStore } from "react"

import { useWorkspaceWidth } from "./workspace-width"

const narrowQuery = "(width < 40rem)"
function subscribe(change: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined
  const media = window.matchMedia(narrowQuery)
  media.addEventListener("change", change)
  return () => media.removeEventListener("change", change)
}
function snapshot() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(narrowQuery).matches)
}
export function useNarrowWorkspace() {
  const width = useWorkspaceWidth()
  const fallback = useSyncExternalStore(subscribe, snapshot, () => false)
  return width === null ? fallback : width < 39
}

export const CompactModelTreeContext = createContext<{
  narrow: boolean
  open: boolean
  panelId: string
  toggle: () => void
} | null>(null)

export function CompactModelTreeToggle() {
  const tree = useContext(CompactModelTreeContext)
  if (!tree?.narrow) return null
  return <TreeToggle tree={tree} />
}

function TreeToggle({ tree }: { tree: NonNullable<ContextType<typeof CompactModelTreeContext>> }) {
  const t = useTranslations("app.settings")
  const label = tree.open ? t("hideModelTree") : t("showModelTree")
  const Icon = tree.open ? PanelLeftClose : PanelLeftOpen
  return (
    <Button
      aria-controls={tree.panelId}
      aria-expanded={tree.open}
      className="mr-auto"
      size="sm"
      type="button"
      variant="ghost"
      onClick={tree.toggle}
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  )
}
