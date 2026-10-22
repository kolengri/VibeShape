import { useFieldContext, useFieldError } from "@vibeshape/ui/integrations/tanstack-form"
import type { ComponentProps } from "react"
import { LocalizedSearchableSelectField } from "../../components/localized-searchable-select-field"

type Props = Omit<
  ComponentProps<typeof LocalizedSearchableSelectField>,
  "name" | "value" | "defaultValue" | "onBlur" | "onValueChange"
> & {
  onValueChange?: (value: string) => void
}

export function TanStackSearchableSelectField({
  onValueChange,
  error: diagnostic,
  ...props
}: Props) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return (
    <LocalizedSearchableSelectField
      {...props}
      name={field.name}
      value={field.state.value}
      error={diagnostic ?? error}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        field.handleChange(value)
        onValueChange?.(value)
      }}
    />
  )
}
