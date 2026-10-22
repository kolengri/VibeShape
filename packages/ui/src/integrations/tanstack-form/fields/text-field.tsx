import { TextField, type TextFieldProps } from "#components/text-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackTextFieldProps = Omit<
  TextFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
> & { onValueChange?: (value: string) => void }

function TanStackTextField({ onValueChange, ...props }: TanStackTextFieldProps) {
  const field = useFieldContext<string>()
  const error = useFieldError()

  return (
    <TextField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => {
        field.handleChange(event.currentTarget.value)
        onValueChange?.(event.currentTarget.value)
      }}
    />
  )
}

export { TanStackTextField }
