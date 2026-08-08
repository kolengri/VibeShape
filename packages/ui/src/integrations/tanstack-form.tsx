import { createFormHook, createFormHookContexts, type ValidationError } from "@tanstack/react-form"
import { isAnyObject, isError, isString } from "is-what"

import { Button, type ButtonProps } from "#components/button"
import { TextField, type TextFieldProps } from "#components/text-field"

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

export type TanStackTextFieldProps = Omit<
  TextFieldProps,
  "defaultValue" | "error" | "name" | "onBlur" | "onChange" | "value"
>

function validationMessage(error: ValidationError | undefined): string | undefined {
  if (isString(error)) {
    return error
  }

  if (isError(error)) {
    return error.message
  }

  if (isAnyObject(error)) {
    const message = Reflect.get(error, "message")
    return isString(message) ? message : undefined
  }

  return undefined
}

function TanStackTextField(props: TanStackTextFieldProps) {
  const field = useFieldContext<string>()
  const showError = field.state.meta.isBlurred || field.form.state.isSubmitted
  const error = showError ? validationMessage(field.state.meta.errors[0]) : undefined

  return (
    <TextField
      {...props}
      name={field.name}
      value={field.state.value ?? ""}
      error={error}
      onBlur={field.handleBlur}
      onChange={(event) => field.handleChange(event.currentTarget.value)}
    />
  )
}

export type SubmitButtonProps = Omit<ButtonProps, "isLoading" | "type"> & {
  requireDirty?: boolean
}

function SubmitButton({ disabled, requireDirty = true, ...props }: SubmitButtonProps) {
  const form = useFormContext()

  return (
    <form.Subscribe
      selector={(state) => [state.canSubmit, state.isDirty, state.isSubmitting] as const}
    >
      {([canSubmit, isDirty, isSubmitting]) => (
        <Button
          {...props}
          type="submit"
          disabled={disabled || isSubmitting || !canSubmit || (requireDirty && !isDirty)}
          isLoading={isSubmitting}
        />
      )}
    </form.Subscribe>
  )
}

const fieldComponents = {
  TextField: TanStackTextField,
}

const formComponents = {
  SubmitButton,
}

export const { useAppForm, withFieldGroup, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents,
  formComponents,
})
