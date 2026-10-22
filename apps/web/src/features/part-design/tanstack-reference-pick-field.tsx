import { useFieldContext, useFieldError } from "@vibeshape/ui/integrations/tanstack-form"
import { ReferencePickField, type ReferencePickFieldProps } from "./reference-pick-field"

type Props = Omit<ReferencePickFieldProps, "name" | "value" | "onBlur" | "onValueChange"> & {
  onValueChange?: (value: string) => void
}

export function TanStackReferencePickField({ onValueChange, error: diagnostic, ...props }: Props) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return (
    <ReferencePickField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={diagnostic ?? error}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        field.handleChange(value)
        onValueChange?.(value)
      }}
    />
  )
}
