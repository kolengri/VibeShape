import * as React from "react"

import { Input } from "#components/input"
import { cn } from "#lib/cn"

export type TextFieldProps = Omit<
  React.ComponentProps<"input">,
  "aria-describedby" | "aria-invalid" | "className"
> & {
  className?: string
  description?: React.ReactNode
  error?: React.ReactNode
  inputClassName?: string
  label: React.ReactNode
}

function hasContent(value: React.ReactNode): boolean {
  return value !== undefined && value !== null && value !== ""
}

function describedByIds(
  descriptionId: string,
  errorId: string,
  description: boolean,
  error: boolean,
) {
  return [description ? descriptionId : undefined, error ? errorId : undefined]
    .filter(Boolean)
    .join(" ")
}

function TextFieldLabel({
  inputId,
  label,
  required,
}: {
  inputId: string
  label: React.ReactNode
  required: boolean
}) {
  return (
    <label htmlFor={inputId} className="text-sm font-medium leading-none">
      {label}
      {required ? (
        <span className="ml-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  )
}

function TextFieldDescription({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!hasContent(children)) {
    return null
  }

  return (
    <p id={id} className="text-xs leading-4 text-muted-foreground">
      {children}
    </p>
  )
}

function TextFieldError({ id, error }: { id: string; error?: React.ReactNode }) {
  const hasError = hasContent(error)

  return (
    <p
      id={id}
      role={hasError ? "alert" : undefined}
      className={cn("min-h-4 text-xs leading-4 text-destructive", !hasError && "invisible")}
    >
      {hasError ? error : "\u00A0"}
    </p>
  )
}

function TextField({
  className,
  description,
  disabled,
  error,
  id: providedId,
  inputClassName,
  label,
  required,
  ...props
}: TextFieldProps) {
  const generatedId = React.useId()
  const inputId = providedId ?? generatedId
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`
  const hasDescription = hasContent(description)
  const hasError = hasContent(error)
  const describedBy = describedByIds(descriptionId, errorId, hasDescription, hasError)

  return (
    <div
      data-slot="text-field"
      data-disabled={disabled || undefined}
      data-invalid={hasError || undefined}
      className={cn("grid gap-1.5", className)}
    >
      <TextFieldLabel inputId={inputId} label={label} required={Boolean(required)} />
      <Input
        {...props}
        id={inputId}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        className={inputClassName}
      />
      <TextFieldDescription id={descriptionId}>{description}</TextFieldDescription>
      <TextFieldError id={errorId} error={error} />
    </div>
  )
}

export { TextField }
