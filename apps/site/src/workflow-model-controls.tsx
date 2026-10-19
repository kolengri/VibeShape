import { Button } from "@vibeshape/ui/components/button"
import type { ViewerStandardView } from "@vibeshape/viewer/three-viewport"

type WorkflowPreset = "isometric" | "front" | "top" | "right"

export function WorkflowModelControls({
  labels,
  disabled,
  view,
  onFit,
  onStandardView,
}: {
  labels: Readonly<Record<WorkflowPreset | "fit", string>>
  disabled: boolean
  view: ViewerStandardView | "orbit"
  onFit: () => void
  onStandardView: (view: ViewerStandardView) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={onFit}>
        {labels.fit}
      </Button>
      {(["isometric", "front", "top", "right"] as const).map((standardView) => (
        <Button
          key={standardView}
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          aria-pressed={view === standardView}
          onClick={() => onStandardView(standardView)}
        >
          {labels[standardView]}
        </Button>
      ))}
    </div>
  )
}
