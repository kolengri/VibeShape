import { TextareaField, type TextareaFieldProps } from "#components/textarea-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackTextareaFieldProps = Omit<
  TextareaFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
> & { onValueChange?: (value: string) => void }

export function TanStackTextareaField({ onValueChange, ...props }: TanStackTextareaFieldProps) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return (
    <TextareaField
      {...props}
      name={field.name}
      value={field.state.value}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => {
        field.handleChange(event.currentTarget.value)
        onValueChange?.(event.currentTarget.value)
      }}
    />
  )
}
