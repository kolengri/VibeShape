import type { ComponentProps } from "react"
import { TanStackVariableExpressionField } from "../variables/tanstack-variable-expression-field"
import {
  VariableExpressionField,
  type VariableExpressionFieldProps,
} from "../variables/variable-expression-field"

type LengthExpressionFieldProps = Omit<
  ComponentProps<typeof VariableExpressionField>,
  "inputClassName"
> &
  Readonly<{
    description: string
    suggestions: VariableExpressionFieldProps["suggestions"]
  }>

export function LengthExpressionField(props: LengthExpressionFieldProps) {
  return <VariableExpressionField {...props} required inputClassName="font-mono tabular-nums" />
}

export function TanStackLengthExpressionField(
  props: Omit<ComponentProps<typeof TanStackVariableExpressionField>, "inputClassName">,
) {
  return (
    <TanStackVariableExpressionField {...props} required inputClassName="font-mono tabular-nums" />
  )
}
