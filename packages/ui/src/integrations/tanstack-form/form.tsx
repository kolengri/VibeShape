import { type AnyFormApi, createFormHook } from "@tanstack/react-form"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "#lib/cn"
import { SubmitButton } from "./components/submit-button"
import { fieldContext, formContext } from "./context"
import { TanStackTextField } from "./fields/text-field"

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

const formVariants = cva("grid gap-4", {
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

type FormApiWithProvider = AnyFormApi & {
  AppForm: React.ComponentType<React.PropsWithChildren>
}

export type FormProps<FormApi extends FormApiWithProvider> = Omit<
  React.ComponentProps<"form">,
  "onSubmit"
> &
  VariantProps<typeof formVariants> & {
    form: FormApi
  }

function Form<FormApi extends FormApiWithProvider>({
  children,
  className,
  form,
  variant = "bare",
  ...props
}: FormProps<FormApi>) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    void form.handleSubmit()
  }

  const AppForm = form.AppForm

  return (
    <form
      {...props}
      data-slot="form"
      className={cn(formVariants({ variant }), className)}
      onSubmit={handleSubmit}
    >
      <AppForm>{children}</AppForm>
    </form>
  )
}

export { Form, formVariants }
