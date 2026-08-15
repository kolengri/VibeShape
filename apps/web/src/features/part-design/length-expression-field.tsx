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
