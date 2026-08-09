import { NativeSelectField, type NativeSelectFieldProps } from "#components/native-select-field"
import { useFieldContext } from "../context"
import { validationMessage } from "../validation-message"

export type TanStackNativeSelectFieldProps = Omit<
  NativeSelectFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
> & {
  onValueChange?: (value: string) => void
}

function TanStackNativeSelectField({ onValueChange, ...props }: TanStackNativeSelectFieldProps) {
  const field = useFieldContext<string>()
  const showError = field.state.meta.isBlurred || field.form.state.isSubmitted
  const error = showError ? validationMessage(field.state.meta.errors[0]) : undefined

  return (
    <NativeSelectField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => {
        onValueChange?.(event.currentTarget.value)
        field.handleChange(event.currentTarget.value)
      }}
    />
  )
}

export { TanStackNativeSelectField }
