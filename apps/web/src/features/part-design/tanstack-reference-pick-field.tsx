import { useFieldContext, validationMessage } from "@vibeshape/ui/integrations/tanstack-form"
import { ReferencePickField, type ReferencePickFieldProps } from "./reference-pick-field"

type Props = Omit<
  ReferencePickFieldProps,
  "name" | "value" | "error" | "onBlur" | "onValueChange"
> & {
  onValueChange?: (value: string) => void
}

export function TanStackReferencePickField({ onValueChange, ...props }: Props) {
  const field = useFieldContext<string>()
  const showError = field.state.meta.isBlurred || field.form.state.isSubmitted
  return (
    <ReferencePickField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={showError ? validationMessage(field.state.meta.errors[0]) : undefined}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        onValueChange?.(value)
        field.handleChange(value)
      }}
    />
  )
}
