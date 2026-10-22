import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"
import type { ReactNode } from "react"

export function LightweightingNumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = "any",
  description,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: string
  description?: ReactNode
}) {
  return (
    <Field>
      <FieldLabel
        htmlFor={id}
        className="max-w-full"
        description={description}
        descriptionId={`${id}-description`}
      >
        {label}
      </FieldLabel>
      <Input
        id={id}
        aria-describedby={description ? `${id}-description` : undefined}
        type="number"
        required
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  )
}
