import { ChoiceField, type ChoiceFieldProps } from "#components/choice-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackChoiceFieldProps = Omit<
  ChoiceFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onValueChange" | "value"
> & { onValueChange?: (value: string) => void }

export function TanStackChoiceField({ onValueChange, ...props }: TanStackChoiceFieldProps) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return (
    <ChoiceField
      {...props}
      name={field.name}
      value={field.state.value}
      error={error}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        field.handleChange(value)
        onValueChange?.(value)
      }}
    />
  )
}
