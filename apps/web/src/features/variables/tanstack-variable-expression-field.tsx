import { useFieldContext, useFieldError } from "@vibeshape/ui/integrations/tanstack-form"
import type { ComponentProps } from "react"
import {
  VariableExpressionField,
  type VariableExpressionFieldProps,
} from "./variable-expression-field"
import { VariableExpressionInput } from "./variable-expression-input"

type Props = Omit<VariableExpressionFieldProps, "name" | "value" | "onBlur" | "onValueChange"> & {
  onValueChange?: (value: string) => void
}

function useExpressionBinding(onValueChange?: (value: string) => void) {
  const field = useFieldContext<string>()
  const error = useFieldError()
  return {
    error,
    name: field.name,
    value: field.state.value,
    onBlur: field.handleBlur,
    onValueChange: (value: string) => {
      field.handleChange(value)
      onValueChange?.(value)
    },
  }
}

export function TanStackVariableExpressionField({ onValueChange, error, ...props }: Props) {
  const binding = useExpressionBinding(onValueChange)
  return <VariableExpressionField {...props} {...binding} error={error ?? binding.error} />
}

export function TanStackVariableExpressionInput({
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof VariableExpressionInput>,
  "name" | "value" | "onBlur" | "onValueChange" | "aria-invalid"
> & {
  onValueChange?: (value: string) => void
}) {
  const { error, ...binding } = useExpressionBinding(onValueChange)
  return (
    <VariableExpressionInput {...props} {...binding} aria-invalid={Boolean(error) || undefined} />
  )
}
