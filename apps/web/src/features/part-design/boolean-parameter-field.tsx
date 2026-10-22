import { Field, FieldLabel } from "@vibeshape/ui/components/field"
import { type ComponentProps, type ReactNode, useId } from "react"

type BooleanParameterFieldProps = Omit<ComponentProps<"input">, "type"> &
  Readonly<{ label: ReactNode; description?: ReactNode }>

export function BooleanParameterField({
  className,
  label,
  description,
  ...input
}: BooleanParameterFieldProps) {
  const generatedId = useId()
  const inputId = input.id ?? generatedId
  const descriptionId = `${inputId}-description`
  return (
    <Field className="min-h-8" data-disabled={input.disabled || undefined}>
      <FieldLabel htmlFor={inputId} description={description} descriptionId={descriptionId}>
        {label}
      </FieldLabel>
      <input
        {...input}
        id={inputId}
        type="checkbox"
        aria-describedby={
          [input["aria-describedby"], description ? descriptionId : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className={className ?? "size-4 rounded border-input accent-primary"}
      />
    </Field>
  )
}

type TanStackBooleanField = Readonly<{
  name: string
  state: Readonly<{ value: boolean }>
  handleBlur: () => void
  handleChange: (value: boolean) => void
}>

export function TanStackBooleanParameterField({
  field,
  label,
  onBeforeChange,
}: Readonly<{
  field: TanStackBooleanField
  label: ReactNode
  onBeforeChange: () => void
}>) {
  return (
    <BooleanParameterField
      name={field.name}
      checked={field.state.value}
      label={label}
      onBlur={field.handleBlur}
      onChange={(event) => {
        onBeforeChange()
        field.handleChange(event.currentTarget.checked)
      }}
    />
  )
}
