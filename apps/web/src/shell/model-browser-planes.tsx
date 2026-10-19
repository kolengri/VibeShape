import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown, Eye, EyeOff, Layers3 } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import { type ReactNode, useEffect, useState } from "react"
import {
  modelBrowserChildRow,
  modelBrowserGroupRow,
  modelBrowserItem,
  modelBrowserSelectedRow,
} from "./model-browser-styles"

export function ModelBrowserPlanes({
  authoredCount = 0,
  children,
  disabled,
  onSelect,
  onVisibilityChange,
  selected,
  showOriginPlanes = true,
  revealSequence,
  visibility,
}: {
  authoredCount?: number
  children?: ReactNode
  disabled: boolean
  onSelect?: ((plane: ViewerOriginPlane) => void) | undefined
  onVisibilityChange?: ((plane: ViewerOriginPlane, visible: boolean) => void) | undefined
  selected: ViewerOriginPlane | null
  showOriginPlanes?: boolean
  revealSequence?: number | undefined
  visibility: ViewerOriginPlaneVisibility
}) {
  const t = useTranslations("app.shell.modelTree")
  const viewportT = useTranslations("app.shell.viewport")
  const [expanded, setExpanded] = useState(authoredCount > 0)
  useEffect(() => {
    if (authoredCount > 0 || revealSequence !== undefined) setExpanded(true)
  }, [authoredCount, revealSequence])
  return (
    <div role="none">
      <Button
        role="treeitem"
        tabIndex={-1}
        aria-expanded={expanded}
        variant="ghost"
        size="sm"
        className={modelBrowserGroupRow}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown aria-hidden="true" className={cn("size-4", !expanded && "-rotate-90")} />
        <Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("items.planes")}
      </Button>
      {expanded && (
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("items.planes")}</legend>
          {(showOriginPlanes ? (["xy", "xz", "yz"] as const) : []).map((plane) => (
            <div
              key={plane}
              className={cn(modelBrowserItem, selected === plane && modelBrowserSelectedRow)}
            >
              <Button
                role="treeitem"
                tabIndex={-1}
                aria-selected={selected === plane}
                disabled={disabled}
                size="sm"
                variant="ghost"
                className={cn(modelBrowserChildRow, "flex-1")}
                onClick={() => onSelect?.(plane)}
              >
                <Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />
                {plane.toUpperCase()}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={viewportT(visibility[plane] ? "hidePlane" : "showPlane", {
                  plane: plane.toUpperCase(),
                })}
                aria-pressed={visibility[plane]}
                onClick={() => onVisibilityChange?.(plane, !visibility[plane])}
              >
                {visibility[plane] ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </Button>
            </div>
          ))}
          {children}
        </fieldset>
      )}
    </div>
  )
}
