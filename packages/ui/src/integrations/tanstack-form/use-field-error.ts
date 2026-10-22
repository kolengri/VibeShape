import { useFieldContext } from "./context"
import { validationMessage } from "./validation-message"

export function useFieldError() {
  const field = useFieldContext<unknown>()
  const showError = field.state.meta.isBlurred || field.form.state.submissionAttempts > 0
  return showError ? validationMessage(field.state.meta.errors[0]) : undefined
}
