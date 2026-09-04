import { Button } from "@vibeshape/ui/components/button"
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
    <fieldset
      className="grid min-w-0 gap-1 rounded-md border bg-panel-muted px-3 py-2"
      disabled={disabled}
    >
      <legend className="sr-only">{copy.label}</legend>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {copy.label}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onSelectionRequest ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={selectionActive ? "secondary" : "ghost"}
                  aria-label={copy.select}
                  aria-pressed={selectionActive}
                  disabled={disabled}
                  onClick={onSelectionRequest}
                >
                  <Scan className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.select}</TooltipContent>
            </Tooltip>
          ) : null}
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
      {labels.map((label, index) => (
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
                  onClick={() => onRemove(index)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.remove(label)}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ))}
    </fieldset>
  )
}
