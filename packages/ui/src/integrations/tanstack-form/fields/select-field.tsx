import type { ComponentProps } from "react"
import { SelectField } from "#components/select-field"
import { useFieldContext } from "../context"
import { useFieldError } from "../use-field-error"

export type TanStackSelectFieldProps = Omit<
  ComponentProps<typeof SelectField>,
  "defaultValue" | "error" | "name" | "onBlur" | "onValueChange" | "value"
> & { onValueChange?: (value: string) => void }

export function TanStackSelectField({ onValueChange, ...props }: TanStackSelectFieldProps) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return (
    <SelectField
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
