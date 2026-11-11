import { Button } from "@vibeshape/ui/components/button"
import { X } from "@vibeshape/ui/components/icons"
import { cn } from "@vibeshape/ui/lib/cn"
import { type ComponentProps, type ReactNode, useId } from "react"

/**
 * Dense list of selected treatment targets. About six one-line rows fit before it scrolls; rows keep
 * enough padding that the 3 px focus ring of a control stays visible inside the scroll container,
 * and the scroll padding keeps a focused control clear of the clipped edge.
 */
export function SelectedTargetList({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ul
      className="max-h-52 min-w-0 scroll-py-2 divide-y overflow-y-auto rounded-md border"
      data-edge-treatment-selection-list=""
    >
      {children}
    </ul>
  )
}

/**
 * One selected target: a single line with the label, compact per-row controls and the remove
 * action, plus optional details expanded and indented underneath.
 */
export function SelectedTargetRow({
  label,
  resolved,
  inline,
  details,
  removeLabel,
  disabled,
  onRemove,
}: Readonly<{
  label: string
  resolved: boolean
  inline?: ReactNode
  details: ReactNode
  removeLabel: string
  disabled: boolean
  onRemove: () => void
}>) {
  return (
    <li
      className={cn("grid min-w-0 gap-1 px-2 py-1", !resolved && "bg-destructive/5")}
      data-edge-treatment-selected-row=""
      data-resolved={resolved ? "true" : "false"}
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2 text-sm">
        <span
          className={cn(
            "min-w-0 flex-1",
            resolved ? "truncate" : "text-xs leading-4 text-destructive wrap-anywhere",
          )}
          title={resolved ? label : undefined}
        >
          {label}
        </span>
        {inline}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {/* Detail components render nothing when they do not apply; hide the empty indent then. */}
      <div
        className="ml-1 grid min-w-0 gap-1 border-l pb-1 pl-3 empty:hidden"
        data-edge-treatment-row-details=""
      >
        {details}
      </div>
    </li>
  )
}

/** Compact labelled checkbox for a per-row option; the accessible name names the row's target. */
export function SelectedRowToggle({
  label,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: string }) {
  const id = useId()
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
        props.disabled && "opacity-50",
      )}
    >
      <input
        {...props}
        id={id}
        type="checkbox"
        className={cn("size-3.5 rounded border-input accent-primary", className)}
      />
      <label htmlFor={id} className="cursor-pointer whitespace-nowrap">
        {label}
      </label>
    </span>
  )
}
