import { CheckboxField, type CheckboxFieldProps } from "#components/checkbox-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackCheckboxFieldProps = Omit<
  CheckboxFieldProps,
  "checked" | "defaultChecked" | "error" | "name" | "onBlur" | "onChange"
> & { onValueChange?: (value: boolean) => void }

export function TanStackCheckboxField({ onValueChange, ...props }: TanStackCheckboxFieldProps) {
  const field = useFieldContext<boolean>()
  const error = useFieldError()
  return (
    <CheckboxField
      {...props}
      name={field.name}
      checked={field.state.value}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => {
        field.handleChange(event.currentTarget.checked)
        onValueChange?.(event.currentTarget.checked)
      }}
    />
  )
}
