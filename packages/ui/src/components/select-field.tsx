import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"
import { type ComponentProps, type FocusEventHandler, type ReactNode, useId } from "react"
import { Field, FieldLabel } from "#components/field"
import { cn } from "#lib/cn"

type SelectFieldProps = ComponentProps<typeof SelectPrimitive.Root> & {
  id?: string
  label: ReactNode
  menuLabel?: ReactNode
  menuDescription?: ReactNode
  "aria-describedby"?: string
  onBlur?: FocusEventHandler<HTMLButtonElement>
}

function SelectField({
  id: providedId,
  label,
  menuLabel,
  menuDescription,
  onBlur,
  children,
  "aria-describedby": describedBy,
  ...props
}: SelectFieldProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  return (
    <Field data-disabled={props.disabled || undefined}>
      <FieldLabel htmlFor={id} required={Boolean(props.required)}>
        {label}
      </FieldLabel>
      <SelectPrimitive.Root {...props}>
        <SelectPrimitive.Trigger
          id={id}
          aria-describedby={describedBy}
          onBlur={onBlur}
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          )}
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon asChild>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              "z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
              menuLabel && "max-w-[calc(100vw-1rem)]",
            )}
          >
            <SelectPrimitive.Viewport>
              {menuLabel ? (
                <SelectPrimitive.Group>
                  <SelectPrimitive.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {menuLabel}
                  </SelectPrimitive.Label>
                  {menuDescription && (
                    <p className="max-w-sm px-2 pb-1.5 text-xs text-muted-foreground">
                      {menuDescription}
                    </p>
                  )}
                  {children}
                </SelectPrimitive.Group>
              ) : (
                children
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </Field>
  )
}

function SelectOption({
  children,
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      {...props}
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground",
        className,
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
        <CheckIcon className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { SelectField, SelectOption }
