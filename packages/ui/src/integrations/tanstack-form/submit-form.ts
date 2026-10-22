import type { AnyFormApi } from "@tanstack/react-form"

type SubmittableForm = Pick<AnyFormApi, "handleSubmit" | "state" | "store">

export async function submitForm(form: SubmittableForm): Promise<void> {
  if (!form.state.isSubmitting) return form.handleSubmit()

  await new Promise<void>((resolve) => {
    const subscription = form.store.subscribe((state) => {
      if (!state.isSubmitting) {
        subscription.unsubscribe()
        resolve()
      }
    })
  })
}
