import * as React from "react"

import { Field, FieldError } from "#components/field"
import { FieldHelp } from "#components/field-help"
import { cn } from "#lib/cn"

export type ChoiceFieldOption = Readonly<{
  value: string
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean | undefined
}>

export type ChoiceFieldProps = Readonly<{
  options: readonly ChoiceFieldOption[]
  label: React.ReactNode
  value?: string | undefined
  defaultValue?: string | undefined
  onValueChange?: ((value: string) => void) | undefined
  onBlur?: React.FocusEventHandler<HTMLInputElement> | undefined
  description?: React.ReactNode
  error?: React.ReactNode
  id?: string | undefined
  name?: string | undefined
  disabled?: boolean | undefined
  required?: boolean | undefined
  className?: string | undefined
}>

function hasFieldContent(content: React.ReactNode) {
  return content !== undefined && content !== null && content !== ""
}

function fieldContent(id: string, description: React.ReactNode, error: React.ReactNode) {
  const hasDescription = hasFieldContent(description)
  const hasError = hasFieldContent(error)
  const describedBy = [hasDescription && `${id}-description`, hasError && `${id}-error`]
    .filter(Boolean)
    .join(" ")
  return { hasDescription, hasError, describedBy }
}

type ChoiceOptionProps = Pick<
  ChoiceFieldProps,
  "name" | "value" | "defaultValue" | "disabled" | "required" | "onValueChange" | "onBlur"
> & {
  id: string
  option: ChoiceFieldOption
  hasError: boolean
  describedBy: string
}

function ChoiceOption({
  id,
  option,
  name,
  value,
  defaultValue,
  disabled,
  required,
  onValueChange,
  onBlur,
  hasError,
  describedBy,
}: ChoiceOptionProps) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 max-w-full flex-auto cursor-pointer items-center gap-2 rounded-md border border-input px-2 py-1.5 text-sm",
        "has-checked:border-ring has-checked:bg-accent has-checked:text-accent-foreground",
        "has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
        "forced-colors:has-checked:outline-2 forced-colors:has-checked:outline-solid forced-colors:has-checked:-outline-offset-3 forced-colors:has-checked:outline-[Highlight]",
        "forced-colors:has-focus-visible:outline-2 forced-colors:has-focus-visible:outline-dashed forced-colors:has-focus-visible:outline-offset-2 forced-colors:has-focus-visible:outline-[Highlight]",
        "has-disabled:cursor-not-allowed has-disabled:opacity-50",
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="radio"
          id={id}
          name={name ?? id}
          value={option.value}
          checked={value === undefined ? undefined : value === option.value}
          defaultChecked={value === undefined ? defaultValue === option.value : undefined}
          disabled={disabled || option.disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-labelledby={`${id}-label`}
          aria-describedby={
            [describedBy, option.description ? `${id}-description` : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onBlur={onBlur}
          onChange={(event) => {
            if (event.currentTarget.checked) onValueChange?.(event.currentTarget.value)
          }}
          className="sr-only"
        />
        <span className="min-w-0 wrap-anywhere">
          <span id={`${id}-label`}>{option.label}</span>
        </span>
      </label>
      {option.description ? (
        <FieldHelp label={option.label} descriptionId={`${id}-description`}>
          {option.description}
        </FieldHelp>
      ) : null}
    </div>
  )
}

export function ChoiceField({
  options,
  label,
  value,
  defaultValue,
  onValueChange,
  onBlur,
  description,
  error,
  id: providedId,
  name,
  disabled,
  required,
  className,
}: ChoiceFieldProps) {
  const generatedId = React.useId()
  const id = providedId ?? generatedId
  const { hasDescription, hasError, describedBy } = fieldContent(id, description, error)

  return (
    <Field
      data-component="choice-field"
      data-disabled={disabled || undefined}
      data-invalid={hasError || undefined}
      className={className}
      orientation="vertical"
    >
      <fieldset
        id={id}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
        aria-invalid={hasError || undefined}
        className="flex min-w-0 w-full flex-wrap items-center gap-x-2 gap-y-1"
      >
        <legend className="sr-only">{label}</legend>
        <div className="min-w-0 flex-1 basis-28 text-xs font-medium wrap-anywhere">
          <span className="inline-flex items-center gap-1">
            <span id={`${id}-label`}>{label}</span>
            <span hidden={!required} className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
            {hasDescription ? (
              <FieldHelp label={label} descriptionId={`${id}-description`}>
                {description}
              </FieldHelp>
            ) : null}
          </span>
        </div>
        <div className="flex min-w-0 flex-[3_1_12rem] flex-wrap gap-1">
          {options.map((option, index) => (
            <ChoiceOption
              key={option.value}
              id={`${id}-${index}`}
              option={option}
              name={name ?? id}
              value={value}
              defaultValue={defaultValue}
              disabled={disabled}
              required={required}
              onValueChange={onValueChange}
              onBlur={onBlur}
              hasError={hasError}
              describedBy={describedBy}
            />
          ))}
        </div>
        <FieldError id={`${id}-error`} className="basis-full">
          {error}
        </FieldError>
      </fieldset>
    </Field>
  )
}
