import { type ComponentProps, type ReactNode, useId } from "react"
import { Field, FieldError, FieldLabel } from "#components/field"
import { cn } from "#lib/cn"

export type CheckboxFieldProps = Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
}

export function CheckboxField({
  label,
  description,
  error,
  id: providedId,
  className,
  ...props
}: CheckboxFieldProps) {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const describedBy = [
    props["aria-describedby"],
    description && `${id}-description`,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <Field
      data-disabled={props.disabled || undefined}
      data-invalid={Boolean(error) || undefined}
      className="min-h-8"
    >
      <FieldLabel
        htmlFor={id}
        required={Boolean(props.required)}
        description={description}
        descriptionId={`${id}-description`}
      >
        {label}
      </FieldLabel>
      <input
        {...props}
        id={id}
        type="checkbox"
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy || undefined}
        className={cn("size-4 rounded border-input accent-primary", className)}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  )
}
