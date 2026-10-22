import { type ComponentProps, type ReactNode, useId } from "react"
import { Field, FieldError, FieldLabel } from "#components/field"
import { Textarea } from "#components/textarea"

export type TextareaFieldProps = ComponentProps<typeof Textarea> & {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
}

export function TextareaField({
  label,
  description,
  error,
  id: providedId,
  ...props
}: TextareaFieldProps) {
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
    <Field data-disabled={props.disabled || undefined} data-invalid={Boolean(error) || undefined}>
      <FieldLabel
        htmlFor={id}
        required={Boolean(props.required)}
        description={description}
        descriptionId={`${id}-description`}
      >
        {label}
      </FieldLabel>
      <Textarea
        {...props}
        id={id}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy || undefined}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  )
}
