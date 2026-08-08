import { TextField, type TextFieldProps } from "#components/text-field"
import { useFieldContext } from "../context"
import { validationMessage } from "../validation-message"

export type TanStackTextFieldProps = Omit<
  TextFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
>

function TanStackTextField(props: TanStackTextFieldProps) {
  const field = useFieldContext<string>()
  const showError = field.state.meta.isBlurred || field.form.state.isSubmitted
  const error = showError ? validationMessage(field.state.meta.errors[0]) : undefined

  return (
    <TextField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => field.handleChange(event.currentTarget.value)}
    />
  )
}

export { TanStackTextField }
