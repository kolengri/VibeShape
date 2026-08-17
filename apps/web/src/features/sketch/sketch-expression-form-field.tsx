import type { ReactNode } from "react"
import { VariableExpressionField } from "../variables/variable-expression-field"
import type { VariableExpressionSuggestion } from "../variables/variable-expression-input"

type SketchExpressionFieldApi = Readonly<{
  handleBlur: () => void
  handleChange: (value: string) => void
  name: string
  state: Readonly<{ value: string }>
}>

export function SketchExpressionFormField({
  field,
  id,
  label,
  suggestions,
  onValueChange,
}: Readonly<{
  field: SketchExpressionFieldApi
  id: string
  label: ReactNode
  suggestions: readonly VariableExpressionSuggestion[]
  onValueChange?: (value: string) => void
}>) {
  return (
    <VariableExpressionField
      id={id}
      inputClassName="font-mono tabular-nums"
      label={label}
      name={field.name}
      suggestions={suggestions}
      value={field.state.value}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        field.handleChange(value)
        onValueChange?.(value)
      }}
    />
  )
}
