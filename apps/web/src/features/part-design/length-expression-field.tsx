import type { ComponentProps } from "react"
import {
  VariableExpressionField,
  type VariableExpressionFieldProps,
} from "../variables/variable-expression-field"

type LengthExpressionFieldProps = Omit<
  ComponentProps<typeof VariableExpressionField>,
  "inputClassName" | "reserveErrorSpace"
> &
  Readonly<{
    description: string
    suggestions: VariableExpressionFieldProps["suggestions"]
  }>

export function LengthExpressionField(props: LengthExpressionFieldProps) {
  return (
    <VariableExpressionField
      {...props}
      required
      reserveErrorSpace
      inputClassName="font-mono tabular-nums"
    />
  )
}

type PrimitiveLengthField = Readonly<{
  name: string
  state: Readonly<{ value: string }>
  handleBlur: () => void
  handleChange: (value: string) => void
}>

export function TanStackLengthExpressionField({
  field,
  onBeforeChange,
  ...props
}: Omit<LengthExpressionFieldProps, "name" | "value" | "onBlur" | "onValueChange"> &
  Readonly<{ field: PrimitiveLengthField; onBeforeChange: () => void }>) {
  return (
    <LengthExpressionField
      {...props}
      name={field.name}
      value={field.state.value}
      onBlur={field.handleBlur}
      onValueChange={(value) => {
        onBeforeChange()
        field.handleChange(value)
      }}
    />
  )
}
