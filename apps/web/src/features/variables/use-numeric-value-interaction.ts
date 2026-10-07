import { angleInputUnitSchema, lengthInputUnitSchema } from "@vibeshape/domain/units"
import { type ComponentProps, type KeyboardEvent, useRef } from "react"

const literalPattern =
  /^(\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s*([A-Za-z]+))?\s*$/
const units = new Set<string>([...lengthInputUnitSchema.options, ...angleInputUnitSchema.options])

function numericLiteral(value: string) {
  const match = literalPattern.exec(value)
  if (!match || !Number.isFinite(Number(match[2]))) return null
  if (match[3] && !units.has(match[3])) return null
  return match
}

function selectNumericValue(input: HTMLInputElement) {
  if (input.readOnly || input.disabled) return
  const match = numericLiteral(input.value)
  if (!match) return
  const [, leading = "", numeric = ""] = match
  input.setSelectionRange(leading.length, leading.length + numeric.length)
}

function isStepKey(event: KeyboardEvent<HTMLInputElement>) {
  return (
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    (event.key === "ArrowUp" || event.key === "ArrowDown")
  )
}

function steppedNumber(numeric: string, direction: number) {
  const current = Number(numeric)
  const next = current + direction
  if (!Number.isFinite(next) || next === current) return null
  const [mantissa = "", exponent = "0"] = numeric.toLowerCase().split("e")
  const precision = Math.min(
    100,
    Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent)),
  )
  return String(Number(next.toFixed(precision)))
}

function stepNumericValue(input: HTMLInputElement, direction: -1 | 1) {
  if (input.readOnly || input.disabled) return false
  const match = numericLiteral(input.value)
  if (!match) return false
  const [, leading = "", numeric = ""] = match
  const nextNumeric = steppedNumber(numeric, direction)
  if (nextNumeric === null) return false
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setValue) return false
  // Bypass React's value tracker so native input dispatch reaches controlled form bindings.
  setValue.call(
    input,
    `${leading}${nextNumeric}${input.value.slice(leading.length + numeric.length)}`,
  )
  input.dispatchEvent(new Event("input", { bubbles: true }))
  selectNumericValue(input)
  return true
}

type InteractionHandlers = Pick<
  ComponentProps<"input">,
  "onBlur" | "onClick" | "onKeyDown" | "onKeyUp" | "onPointerDown"
>

export function useNumericValueInteraction(handlers: InteractionHandlers): InteractionHandlers {
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
    onKeyDown(event) {
      handlers.onKeyDown?.(event)
      if (
        isStepKey(event) &&
        stepNumericValue(event.currentTarget, event.key === "ArrowUp" ? 1 : -1)
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
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
