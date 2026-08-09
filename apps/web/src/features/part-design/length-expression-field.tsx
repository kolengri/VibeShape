import { Field, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import type { ComponentProps } from "react"

type LengthExpressionFieldProps = Omit<
  ComponentProps<typeof Input>,
  "aria-describedby" | "aria-invalid" | "className" | "id" | "type"
> &
  Readonly<{
    description: string
    error?: string | undefined
    id: string
    label: string
  }>

export function LengthExpressionField({
  description,
  error,
  id,
  label,
  ...inputProps
}: LengthExpressionFieldProps) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Input
        {...inputProps}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${descriptionId} ${errorId}`}
        aria-invalid={error ? true : undefined}
        className="font-mono tabular-nums"
      />
      <p id={descriptionId} className="text-xs leading-4 text-muted-foreground">
        {description}
      </p>
      <FieldError id={errorId} reserveSpace>
        {error}
      </FieldError>
    </Field>
  )
}
