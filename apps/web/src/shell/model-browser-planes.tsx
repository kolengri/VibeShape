import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { ChevronDown, Eye, EyeOff, Layers3 } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "@vibeshape/viewer/origin-planes"
import { type ReactNode, useEffect, useState } from "react"
import {
  modelBrowserChildRow,
  modelBrowserGroupRow,
  modelBrowserItem,
  modelBrowserSelectedRow,
} from "./model-browser-styles"

type ModelBrowserPlanesProps = {
  authoredCount?: number
  children?: ReactNode
  disabled: boolean
  onSelect?: ((plane: ViewerOriginPlane) => void) | undefined
  onVisibilityChange?: ((plane: ViewerOriginPlane, visible: boolean) => void) | undefined
  selected: ViewerOriginPlane | null
  showOriginPlanes?: boolean
  revealSequence?: number | undefined
  visibility: ViewerOriginPlaneVisibility
}

function OriginPlanesVisibilityAction({
  onVisibilityChange,
  visibility,
}: Pick<ModelBrowserPlanesProps, "onVisibilityChange" | "visibility">) {
  const t = useTranslations("app.shell.modelTree")
  const visibleCount = viewerOriginPlanes.filter((plane) => visibility[plane]).length
  const anyVisible = visibleCount > 0
  const visibilityLabel = t(anyVisible ? "hideAllOriginPlanes" : "showAllOriginPlanes")
  const visibilityPressed =
    visibleCount === 0 ? false : visibleCount === viewerOriginPlanes.length ? true : "mixed"
  const toggleAllVisibility = () => {
    for (const plane of viewerOriginPlanes) {
      if (visibility[plane] !== !anyVisible) onVisibilityChange?.(plane, !anyVisible)
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={visibilityLabel}
          aria-pressed={visibilityPressed}
          onClick={toggleAllVisibility}
        >
          {anyVisible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{visibilityLabel}</TooltipContent>
    </Tooltip>
  )
}

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
}: ModelBrowserPlanesProps) {
  const t = useTranslations("app.shell.modelTree")
  const viewportT = useTranslations("app.shell.viewport")
  const [expanded, setExpanded] = useState(authoredCount > 0)
  useEffect(() => {
    if (authoredCount > 0 || revealSequence !== undefined) setExpanded(true)
  }, [authoredCount, revealSequence])
  return (
    <div role="none">
      <div className={modelBrowserItem}>
        <Button
          role="treeitem"
          tabIndex={-1}
          aria-expanded={expanded}
          variant="ghost"
          size="xs"
          className={cn(modelBrowserGroupRow, "flex-1")}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown aria-hidden="true" className={cn("size-4", !expanded && "-rotate-90")} />
          <Layers3 aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("items.planes")}
        </Button>
        {showOriginPlanes && (
          <OriginPlanesVisibilityAction
            onVisibilityChange={onVisibilityChange}
            visibility={visibility}
          />
        )}
      </div>
      {expanded && (
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("items.planes")}</legend>
          {(showOriginPlanes ? viewerOriginPlanes : []).map((plane) => (
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
