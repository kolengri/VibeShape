import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Eye, EyeOff } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import {
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "@vibeshape/viewer/origin-planes"

/**
 * Keeps the visibility policy for the three persistent origin references consistent across CAD views.
 */
export function OriginPlaneVisibilityControls({
  onChange,
  visibility,
}: {
  onChange: (plane: ViewerOriginPlane, visible: boolean) => void
  visibility: ViewerOriginPlaneVisibility
}) {
  const t = useTranslations("app.shell.viewport")
  const labels: Record<ViewerOriginPlane, string> = {
    xy: t("planeXy"),
    xz: t("planeXz"),
    yz: t("planeYz"),
  }
  return (
    <fieldset className="flex items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm">
      <legend className="sr-only">{t("originPlanes")}</legend>
      {viewerOriginPlanes.map((plane) => {
        const visible = visibility[plane]
        const action = visible
          ? t("hidePlane", { plane: labels[plane] })
          : t("showPlane", { plane: labels[plane] })
        return (
          <Tooltip key={plane}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={action}
                aria-pressed={visible}
                onClick={() => onChange(plane, !visible)}
              >
                {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                <span className="sr-only">{labels[plane]}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action}</TooltipContent>
          </Tooltip>
        )
      })}
    </fieldset>
  )
}
