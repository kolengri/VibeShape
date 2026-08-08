import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { Label } from "#components/label"
import { cn } from "#lib/cn"

const fieldVariants = cva("group/field grid w-full gap-1.5", {
  variants: {
    orientation: {
      horizontal: [
        "grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center",
        "[&>[data-slot=field-description]]:col-start-2 [&>[data-slot=field-error]]:col-start-2",
      ],
      vertical: "grid-cols-1",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
})

type FieldProps = React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>

function Field({ className, orientation = "vertical", ...props }: FieldProps) {
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
}

function FieldLabel({ children, className, required = false, ...props }: FieldLabelProps) {
  return (
    <Label
      {...props}
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-0 text-sm font-medium leading-none",
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
