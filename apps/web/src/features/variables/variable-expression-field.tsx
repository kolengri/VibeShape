import { Field, FieldDescription, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import type { ComponentProps, ReactNode } from "react"
import {
  VariableExpressionInput,
  type VariableExpressionSuggestion,
} from "./variable-expression-input"

export type VariableExpressionFieldProps = Omit<
  ComponentProps<typeof VariableExpressionInput>,
  "aria-describedby" | "aria-invalid" | "className" | "id" | "suggestions" | "type"
> &
  Readonly<{
    description?: ReactNode
    error?: ReactNode
    id: string
    inputClassName?: string
    label: ReactNode
    reserveErrorSpace?: boolean
    suggestions: readonly VariableExpressionSuggestion[]
  }>

export function VariableExpressionField({
  description,
  error,
  id,
  inputClassName,
  label,
  required,
  reserveErrorSpace = false,
  suggestions,
  ...inputProps
}: VariableExpressionFieldProps) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy = [
    description ? descriptionId : null,
    error || reserveErrorSpace ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id} required={Boolean(required)}>
        {label}
      </FieldLabel>
      <VariableExpressionInput
        {...inputProps}
        id={id}
        type="text"
        required={required}
        suggestions={suggestions}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={inputClassName}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <FieldError id={errorId} reserveSpace={reserveErrorSpace}>
        {error}
      </FieldError>
    </Field>
  )
}
