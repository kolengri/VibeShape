import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { Scan, Trash2, X } from "@vibeshape/ui/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"

export type ProfileSelectionFieldCopy = Readonly<{
  clear: string
  label: string
  remove: (profile: string) => string
  select: string
}>

export function ProfileSelectionField({
  copy,
  disabled = false,
  labels,
  onClear,
  onRemove,
  onSelectionRequest,
  selectionActive = false,
}: Readonly<{
  copy: ProfileSelectionFieldCopy
  disabled?: boolean
  labels: readonly string[]
  onClear?: (() => void) | undefined
  onRemove?: ((index: number) => void) | undefined
  onSelectionRequest?: (() => void) | undefined
  selectionActive?: boolean
}>) {
  const showClear = labels.length > 1 && onClear

  return (
    <fieldset className={fieldVariants({ orientation: "horizontal" })} disabled={disabled}>
      <legend className="sr-only">{copy.label}</legend>
      <span className="text-xs font-medium">{copy.label}</span>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-1">
          {onSelectionRequest ? (
            <Button
              type="button"
              size="sm"
              variant={selectionActive ? "secondary" : "outline"}
              className="min-w-0 flex-1 justify-start font-normal"
              aria-label={copy.select}
              aria-pressed={selectionActive}
              disabled={disabled}
              onClick={onSelectionRequest}
            >
              <Scan className="size-3.5" aria-hidden="true" />
              <span className="truncate">{labels[0] ?? copy.select}</span>
            </Button>
          ) : (
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {labels[0] ?? copy.select}
            </span>
          )}
          {onRemove && labels[0] ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={copy.remove(labels[0])}
              onClick={() => onRemove(0)}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          <div className="flex shrink-0 items-center gap-1">
            {showClear ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={copy.clear}
                    disabled={disabled}
                    onClick={onClear}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.clear}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
        {labels.slice(1).map((label, index) => (
          <div
            key={`${index}:${label}`}
            className="flex min-w-0 items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0 truncate">{label}</span>
            {onRemove ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={copy.remove(label)}
                    disabled={disabled}
                    onClick={() => onRemove(index + 1)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.remove(label)}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ))}
      </div>
    </fieldset>
  )
}
