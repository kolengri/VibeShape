import { Alert } from "#components/alert"
import { useFormContext } from "../context"
import { validationMessage } from "../validation-message"

export function FormError({ afterSubmit = false }: { afterSubmit?: boolean }) {
  const form = useFormContext()
  return (
    <form.Subscribe
      selector={(state) => (afterSubmit && !state.submissionAttempts ? undefined : state.errors)}
    >
      {(errors) => {
        if (!errors) return null
        const messages = [...new Set(errors.map(validationMessage).filter(Boolean))]
        return messages.length ? <Alert>{messages.join(" ")}</Alert> : null
      }}
    </form.Subscribe>
  )
}
