import * as React from "react"

import { Field, FieldError, FieldLabel } from "#components/field"
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
  trailingAction?: React.ReactNode
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
  trailingAction,
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
  const select = (
    <NativeSelect
      {...props}
      id={selectId}
      disabled={disabled}
      required={required}
      aria-describedby={describedBy || undefined}
      aria-invalid={hasError || undefined}
      className={selectClassName}
    />
  )

  return (
    <Field
      data-component="native-select-field"
      data-disabled={disabled || undefined}
      data-invalid={hasError || undefined}
      className={className}
    >
      <FieldLabel
        htmlFor={selectId}
        required={Boolean(required)}
        description={description}
        descriptionId={descriptionId}
      >
        {label}
      </FieldLabel>
      {trailingAction ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
          {select}
          {trailingAction}
        </div>
      ) : (
        select
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}

export { NativeSelectField }
