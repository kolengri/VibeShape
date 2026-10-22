import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { FieldHelp } from "#components/field-help"
import { Label } from "#components/label"
import { cn } from "#lib/cn"

const fieldVariants = cva("group/field grid min-w-0 w-full gap-x-2 gap-y-1", {
  variants: {
    orientation: {
      horizontal: [
        "grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center",
        "[&>[data-slot=field-description]]:col-start-2 [&>[data-slot=field-error]]:col-start-2",
      ],
      vertical: "grid-cols-1",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
})

type FieldProps = React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>

function Field({ className, orientation = "horizontal", ...props }: FieldProps) {
  return (
    <div
      {...props}
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
    />
  )
}

type FieldLabelProps = React.ComponentProps<typeof Label> & {
  required?: boolean
  description?: React.ReactNode
  descriptionId?: string | undefined
}

function FieldLabel({
  children,
  className,
  required = false,
  description,
  descriptionId,
  ...props
}: FieldLabelProps) {
  const label = (
    <Label
      {...props}
      data-slot="field-label"
      className={cn(
        "flex min-w-0 w-fit items-center gap-0 text-xs font-medium leading-4 wrap-anywhere",
        "group-data-[disabled=true]/field:cursor-not-allowed group-data-[disabled=true]/field:opacity-50",
        className,
      )}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </Label>
  )
  return description ? (
    <div data-slot="field-label-row" className="flex min-w-0 items-center gap-1">
      {label}
      <FieldHelp label={children} descriptionId={descriptionId}>
        {description}
      </FieldHelp>
    </div>
  ) : (
    label
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      {...props}
      data-slot="field-description"
      className={cn("text-xs leading-4 text-muted-foreground", className)}
    />
  )
}

type FieldErrorProps = React.ComponentProps<"p"> & {
  reserveSpace?: boolean
}

function FieldError({ children, className, reserveSpace = false, ...props }: FieldErrorProps) {
  const hasError = children !== undefined && children !== null && children !== ""

  if (!hasError && !reserveSpace) {
    return null
  }

  return (
    <p
      {...props}
      data-slot="field-error"
      role={hasError ? "alert" : undefined}
      className={cn(
        "text-xs leading-4 text-destructive",
        reserveSpace && "min-h-4",
        !hasError && "invisible",
        className,
      )}
    >
      {hasError ? children : "\u00A0"}
    </p>
  )
}

export type { FieldErrorProps, FieldLabelProps, FieldProps }
export { Field, FieldDescription, FieldError, FieldLabel, fieldVariants }
