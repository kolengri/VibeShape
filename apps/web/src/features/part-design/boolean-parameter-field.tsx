import type { ComponentProps, ReactNode } from "react"

type BooleanParameterFieldProps = Omit<ComponentProps<"input">, "type"> &
  Readonly<{ label: ReactNode }>

export function BooleanParameterField({ className, label, ...input }: BooleanParameterFieldProps) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input
        {...input}
        type="checkbox"
        className={className ?? "size-4 rounded border-input accent-primary"}
      />
      {label}
    </label>
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
