import * as React from "react"

import { Field, FieldDescription, FieldError, FieldLabel } from "#components/field"
import { Input } from "#components/input"

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
    <Field
      data-component="text-field"
      data-disabled={disabled || undefined}
      data-invalid={hasError || undefined}
      className={className}
    >
      <FieldLabel htmlFor={inputId} required={Boolean(required)}>
        {label}
      </FieldLabel>
      <Input
        {...props}
        id={inputId}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        className={inputClassName}
      />
      {hasDescription ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
      <FieldError id={errorId} reserveSpace>
        {error}
      </FieldError>
    </Field>
  )
}

export { TextField }
