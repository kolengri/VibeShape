import { Button, type ButtonProps } from "#components/button"
import { useFormContext } from "../context"

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

export { SubmitButton }
