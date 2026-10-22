import { Alert } from "#components/alert"
import { useFormContext } from "../context"
import { validationMessage } from "../validation-message"

export function FormError() {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.errors}>
      {(errors) => {
        const messages = [...new Set(errors.map(validationMessage).filter(Boolean))]
        return messages.length ? <Alert>{messages.join(" ")}</Alert> : null
      }}
    </form.Subscribe>
  )
}
