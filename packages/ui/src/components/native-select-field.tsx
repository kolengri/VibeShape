import * as React from "react"

import { Field, FieldDescription, FieldError, FieldLabel } from "#components/field"
import { NativeSelect } from "#components/native-select"

export type NativeSelectFieldProps = Omit<
  React.ComponentProps<"select">,
  "aria-describedby" | "aria-invalid" | "className"
> & {
  className?: string
  description?: React.ReactNode
  error?: React.ReactNode
  label: React.ReactNode
  selectClassName?: string
}

function hasContent(value: React.ReactNode): boolean {
  return value !== undefined && value !== null && value !== ""
}

function NativeSelectField({
  className,
  description,
  disabled,
  error,
  id: providedId,
  label,
  required,
  selectClassName,
  ...props
}: NativeSelectFieldProps) {
  const generatedId = React.useId()
  const selectId = providedId ?? generatedId
  const descriptionId = `${selectId}-description`
  const errorId = `${selectId}-error`
  const hasDescription = hasContent(description)
  const hasError = hasContent(error)
  const describedBy = [hasDescription ? descriptionId : undefined, hasError ? errorId : undefined]
    .filter(Boolean)
    .join(" ")

  return (
    <Field
      data-component="native-select-field"
      data-disabled={disabled || undefined}
      data-invalid={hasError || undefined}
      className={className}
    >
      <FieldLabel htmlFor={selectId} required={Boolean(required)}>
        {label}
      </FieldLabel>
      <NativeSelect
        {...props}
        id={selectId}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        className={selectClassName}
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

export { NativeSelectField }
