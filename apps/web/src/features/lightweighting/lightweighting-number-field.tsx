import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { Input } from "@vibeshape/ui/components/input"

export function LightweightingNumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = "any",
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id} className="max-w-full">
        {label}
      </FieldLabel>
      <Input
        id={id}
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
