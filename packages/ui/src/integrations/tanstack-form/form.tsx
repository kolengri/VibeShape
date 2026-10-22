import { type AnyFormApi, createFormHook } from "@tanstack/react-form"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import {
  type ComponentType,
  type PropsWithChildren,
  type RefObject,
  useEffect,
  useRef,
} from "react"

import { cn } from "#lib/cn"
import { FormError } from "./components/form-error"
import { SubmitButton } from "./components/submit-button"
import { fieldContext, formContext, useFormContext } from "./context"
import { TanStackCheckboxField } from "./fields/checkbox-field"
import { TanStackChoiceField } from "./fields/choice-field"
import { TanStackNativeSelectField } from "./fields/native-select-field"
import { TanStackSelectField } from "./fields/select-field"
import { TanStackTextField } from "./fields/text-field"
import { TanStackTextareaField } from "./fields/textarea-field"
import { submitForm } from "./submit-form"

const fieldComponents = {
  CheckboxField: TanStackCheckboxField,
  ChoiceField: TanStackChoiceField,
  SelectField: TanStackSelectField,
  TextareaField: TanStackTextareaField,
  NativeSelectField: TanStackNativeSelectField,
  TextField: TanStackTextField,
}

const formComponents = {
  FormError,
  SubmitButton,
}

export const formHookOptions = {
  fieldContext,
  formContext,
  fieldComponents,
  formComponents,
}

export const { useAppForm, withFieldGroup, withForm } = createFormHook(formHookOptions)

export { createFormHook }

const formVariants = cva("grid gap-2", {
  variants: {
    variant: {
      bare: undefined,
      panel: "rounded-md border border-border bg-panel p-4 text-foreground",
    },
  },
  defaultVariants: {
    variant: "bare",
  },
})

type AppFormApi = Pick<AnyFormApi, "handleSubmit" | "state" | "store"> & {
  AppForm: ComponentType<PropsWithChildren>
}

export type FormProps<FormApi extends AppFormApi> = Omit<React.ComponentProps<"form">, "onSubmit"> &
  VariantProps<typeof formVariants> & {
    form: FormApi
  }

function Form<FormApi extends AppFormApi>({
  children,
  className,
  form,
  variant = "bare",
  noValidate = true,
  ref,
  ...props
}: FormProps<FormApi>) {
  const element = useRef<HTMLFormElement>(null)
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    await submitForm(form)
  }
  const AppForm = form.AppForm

  return (
    <form
      {...props}
      noValidate={noValidate}
      ref={(node) => {
        element.current = node
        if (typeof ref === "function") return ref(node)
        if (ref) ref.current = node
      }}
      data-slot="form"
      className={cn(formVariants({ variant }), className)}
      onSubmit={handleSubmit}
    >
      <AppForm>
        <ValidationFocus element={element} />
        {children}
      </AppForm>
    </form>
  )
}

function FocusInvalidField({
  element,
  attempts,
  pending,
  valid,
}: {
  element: RefObject<HTMLFormElement | null>
  attempts: number
  pending: boolean
  valid: boolean
}) {
  const handledAttempt = useRef(0)
  useEffect(() => {
    if (attempts === 0 || pending || handledAttempt.current === attempts) return
    handledAttempt.current = attempts
    if (!valid) {
      element.current
        ?.querySelector<HTMLElement>(
          "[aria-invalid='true']:is(input, textarea, select, button, [tabindex]):not(:disabled):not([aria-disabled='true'])",
        )
        ?.focus()
    }
  }, [element, attempts, pending, valid])
  return null
}

function ValidationFocus({ element }: { element: RefObject<HTMLFormElement | null> }) {
  const form = useFormContext()
  return (
    <form.Subscribe
      selector={(state) => [state.submissionAttempts, state.isSubmitting, state.isValid] as const}
    >
      {([attempts, pending, valid]) => (
        <FocusInvalidField element={element} attempts={attempts} pending={pending} valid={valid} />
      )}
    </form.Subscribe>
  )
}

export { Form, formVariants }
