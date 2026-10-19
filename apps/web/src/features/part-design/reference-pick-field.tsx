import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@vibeshape/ui/components/field"
import { Scan } from "@vibeshape/ui/components/icons"
import { NativeSelect } from "@vibeshape/ui/components/native-select"
import { cn } from "@vibeshape/ui/lib/cn"
import { type FocusEventHandler, type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { useReferencePicking } from "../../shell/reference-pick-context"
import type { ReferencePickCandidate } from "../../shell/reference-picking"

export type ReferencePickOption = Readonly<{ value: string; label: string; disabled?: boolean }>
export type ReferencePickFieldProps = Readonly<{
  id: string
  label: string
  value: string
  placeholder: string
  options: readonly ReferencePickOption[]
  candidates: readonly ReferencePickCandidate[]
  onValueChange: (value: string) => void
  name?: string
  description?: ReactNode
  error?: ReactNode
  disabled?: boolean
  required?: boolean
  onBlur?: FocusEventHandler<HTMLSelectElement | HTMLButtonElement>
  selectAriaLabel?: string
}>

type ReferencePicker = NonNullable<ReturnType<typeof useReferencePicking>>
type ReferenceControlProps = Readonly<{
  field: ReferencePickFieldProps
  describedBy: string | undefined
}>

function referenceFieldDescriptionIds(field: ReferencePickFieldProps, hasPicker: boolean) {
  const ids: string[] = []
  if (field.description) ids.push(`${field.id}-description`)
  if (field.error) ids.push(`${field.id}-error`)
  if (hasPicker) ids.push(`${field.id}-pick-help`)
  return ids.join(" ") || undefined
}

function ReferenceFieldLayout({
  field,
  children,
}: Readonly<{ field: ReferencePickFieldProps; children: ReactNode }>) {
  return (
    <Field
      data-disabled={field.disabled || undefined}
      data-invalid={Boolean(field.error) || undefined}
    >
      <FieldLabel htmlFor={field.id} required={Boolean(field.required)}>
        {field.label}
      </FieldLabel>
      {children}
      {field.description ? (
        <FieldDescription id={`${field.id}-description`}>{field.description}</FieldDescription>
      ) : null}
      <FieldError id={`${field.id}-error`} reserveSpace>
        {field.error}
      </FieldError>
    </Field>
  )
}

function ReferenceSelectControl({
  field,
  describedBy,
  compact = false,
  onBeforeChange,
}: ReferenceControlProps & Readonly<{ compact?: boolean; onBeforeChange?: () => void }>) {
  const retainMissingValue =
    field.value !== "" && !field.options.some((option) => option.value === field.value)
  return (
    <NativeSelect
      id={field.id}
      name={field.name}
      value={field.value}
      required={field.required}
      disabled={field.disabled}
      aria-label={field.selectAriaLabel ?? field.label}
      aria-describedby={describedBy}
      aria-invalid={field.error ? true : undefined}
      onBlur={field.onBlur}
      className={
        compact
          ? cn(
              "h-full w-full rounded-l-none border-0 border-l border-input px-0",
              "bg-transparent text-transparent dark:bg-transparent [&_option]:bg-background [&_option]:text-foreground",
            )
          : undefined
      }
      onChange={(event) => {
        onBeforeChange?.()
        field.onValueChange(event.currentTarget.value)
      }}
    >
      <option value="">{field.placeholder}</option>
      {retainMissingValue ? <option value={field.value}>{field.placeholder}</option> : null}
      {field.options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  )
}

function useReferenceFieldBinding(
  { candidates, disabled, label, onValueChange }: ReferencePickFieldProps,
  picker: ReferencePicker,
) {
  const [owner] = useState(() => Symbol("reference-field"))
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { cancel, update } = picker
  useLayoutEffect(() => () => cancel(owner), [cancel, owner])
  useLayoutEffect(() => {
    if (disabled) cancel(owner)
    else update({ owner, label, candidates, onPick: onValueChange, returnFocus: buttonRef.current })
  }, [cancel, candidates, disabled, label, onValueChange, owner, update])

  const active = picker.activeOwner === owner
  return {
    active,
    buttonRef,
    cancel: () => cancel(owner),
    toggle: () => {
      if (active) picker.cancel(owner, true)
      else {
        // Safari pointer activation does not focus buttons; Escape must remain in the task scope.
        buttonRef.current?.focus()
        picker.begin({
          owner,
          label,
          candidates,
          onPick: onValueChange,
          returnFocus: buttonRef.current,
        })
      }
    },
  }
}

function ReferencePickControls({
  field,
  describedBy,
  picker,
}: ReferenceControlProps & Readonly<{ picker: ReferencePicker }>) {
  const t = useTranslations("app.partDesign.referencePick")
  const binding = useReferenceFieldBinding(field, picker)
  const selectedLabel =
    field.options.find((option) => option.value === field.value)?.label ?? field.placeholder
  return (
    <>
      <div
        data-active={binding.active || undefined}
        data-invalid={Boolean(field.error) || undefined}
        className={cn(
          "flex h-8 min-w-0 rounded-md border border-input bg-background",
          "focus-within:border-ring data-[active=true]:border-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[invalid=true]:border-destructive",
          "[&>[data-slot=native-select-wrapper]]:h-full [&>[data-slot=native-select-wrapper]]:w-9 [&>[data-slot=native-select-wrapper]]:shrink-0",
        )}
      >
        <Button
          ref={binding.buttonRef}
          type="button"
          variant="outline"
          size="sm"
          className="h-full min-w-0 flex-1 justify-start rounded-r-none border-0 bg-transparent font-normal shadow-none"
          aria-label={t("pick", { field: field.label })}
          aria-pressed={binding.active}
          aria-describedby={describedBy}
          aria-invalid={field.error ? true : undefined}
          disabled={field.disabled || !picker.enabled || field.candidates.length === 0}
          onBlur={field.onBlur}
          onClick={binding.toggle}
        >
          <Scan className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedLabel}</span>
        </Button>
        <ReferenceSelectControl
          field={field}
          describedBy={describedBy}
          compact
          onBeforeChange={binding.cancel}
        />
      </div>
      <span id={`${field.id}-pick-help`} className="sr-only">
        {t("help")}
      </span>
    </>
  )
}

export function ReferencePickField(field: ReferencePickFieldProps) {
  const picker = useReferencePicking()
  const describedBy = referenceFieldDescriptionIds(field, picker !== null)
  return (
    <ReferenceFieldLayout field={field}>
      {picker ? (
        <ReferencePickControls field={field} describedBy={describedBy} picker={picker} />
      ) : (
        <ReferenceSelectControl field={field} describedBy={describedBy} />
      )}
    </ReferenceFieldLayout>
  )
}
