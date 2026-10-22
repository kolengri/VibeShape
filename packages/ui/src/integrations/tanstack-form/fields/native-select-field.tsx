import { NativeSelectField, type NativeSelectFieldProps } from "#components/native-select-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackNativeSelectFieldProps = Omit<
  NativeSelectFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
> & {
  onValueChange?: (value: string) => void
}

function TanStackNativeSelectField({ onValueChange, ...props }: TanStackNativeSelectFieldProps) {
  const field = useFieldContext<string>()
  const error = useFieldError()

  return (
    <NativeSelectField
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

export { TanStackNativeSelectField }
