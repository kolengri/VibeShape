import { angleInputUnitSchema, lengthInputUnitSchema } from "@vibeshape/domain/units"
import { type ComponentProps, useRef } from "react"

const literalPattern =
  /^(\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s*([A-Za-z]+))?\s*$/
const units = new Set<string>([...lengthInputUnitSchema.options, ...angleInputUnitSchema.options])

function selectNumericValue(input: HTMLInputElement) {
  if (input.readOnly || input.disabled) return
  const match = literalPattern.exec(input.value)
  if (!match) return
  const [, leading = "", numeric = "", unit] = match
  if (unit && !units.has(unit)) return
  input.setSelectionRange(leading.length, leading.length + numeric.length)
}

type SelectionHandlers = Pick<
  ComponentProps<"input">,
  "onBlur" | "onClick" | "onKeyUp" | "onPointerDown"
>

export function useNumericValueSelection(handlers: SelectionHandlers): SelectionHandlers {
  const enteringWithPointer = useRef(false)
  return {
    onPointerDown(event) {
      handlers.onPointerDown?.(event)
      enteringWithPointer.current =
        !event.defaultPrevented &&
        event.button === 0 &&
        event.currentTarget.ownerDocument.activeElement !== event.currentTarget
    },
    onKeyUp(event) {
      handlers.onKeyUp?.(event)
      if (event.key === "Tab" && !event.defaultPrevented) selectNumericValue(event.currentTarget)
    },
    onClick(event) {
      handlers.onClick?.(event)
      // Select after native pointer placement, only when entering the field.
      if (enteringWithPointer.current && !event.defaultPrevented)
        selectNumericValue(event.currentTarget)
      enteringWithPointer.current = false
    },
    onBlur(event) {
      enteringWithPointer.current = false
      handlers.onBlur?.(event)
    },
  }
}
