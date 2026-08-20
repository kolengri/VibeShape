import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type ViewerOriginPlane,
  type ViewerOriginPlaneVisibility,
  viewerOriginPlanes,
} from "@vibeshape/viewer/origin-planes"

const planeAxes = {
  xy: [
    { axis: "X", className: "text-axis-x" },
    { axis: "Y", className: "text-axis-y" },
  ],
  xz: [
    { axis: "X", className: "text-axis-x" },
    { axis: "Z", className: "text-axis-z" },
  ],
  yz: [
    { axis: "Y", className: "text-axis-y" },
    { axis: "Z", className: "text-axis-z" },
  ],
} as const satisfies Record<
  ViewerOriginPlane,
  readonly [{ axis: string; className: string }, { axis: string; className: string }]
>

function PlaneVisibilitySymbol({ plane, visible }: { plane: ViewerOriginPlane; visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-plane-symbol={plane.toUpperCase()}
      className={cn(
        "relative grid size-5 place-items-center rounded-sm border border-current/45",
        "font-mono text-[9px] font-bold leading-none tracking-[-0.08em]",
        !visible && "opacity-45",
      )}
    >
      <span>
        {planeAxes[plane].map(({ axis, className }) => (
          <span key={axis} className={className}>
            {axis}
          </span>
        ))}
      </span>
      {!visible ? <span className="absolute h-px w-6 -rotate-45 bg-current" /> : null}
    </span>
  )
}

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
                <PlaneVisibilitySymbol plane={plane} visible={visible} />
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
