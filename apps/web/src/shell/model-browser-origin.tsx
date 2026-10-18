import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown, Eye, EyeOff, Layers3 } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import type {
  ViewerOriginPlane,
  ViewerOriginPlaneVisibility,
} from "@vibeshape/viewer/origin-planes"
import { useState } from "react"
import {
  modelBrowserChildRow,
  modelBrowserGroupRow,
  modelBrowserItem,
  modelBrowserSelectedRow,
} from "./model-browser-styles"

export function ModelBrowserOrigin({
  disabled,
  onSelect,
  onVisibilityChange,
  selected,
  visibility,
}: {
  disabled: boolean
  onSelect: (plane: ViewerOriginPlane) => void
  onVisibilityChange: (plane: ViewerOriginPlane, visible: boolean) => void
  selected: ViewerOriginPlane | null
  visibility: ViewerOriginPlaneVisibility
}) {
  const t = useTranslations("app.shell.modelTree")
  const viewportT = useTranslations("app.shell.viewport")
  const [expanded, setExpanded] = useState(false)
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
        {t("items.origin")}
      </Button>
      {expanded && (
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("originPlanes")}</legend>
          {(["xy", "xz", "yz"] as const).map((plane) => (
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
                onClick={() => onSelect(plane)}
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
                onClick={() => onVisibilityChange(plane, !visibility[plane])}
              >
                {visibility[plane] ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              </Button>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  )
}
