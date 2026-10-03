import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { type ReactNode, useState } from "react"

export type AssemblyFormActions = {
  pending: boolean
  onApply: (changes: readonly AssemblyMutation[]) => Promise<boolean>
  onCancel: () => void
}
export function AssemblyTaskForm({
  children,
  build,
  actions,
}: {
  children: ReactNode
  build: (data: FormData) => readonly AssemblyMutation[]
  actions: AssemblyFormActions
}) {
  const t = useTranslations("app.assembly")
  const [invalid, setInvalid] = useState(false)
  return (
    <form
      className="grid gap-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !actions.pending) {
          event.preventDefault()
          actions.onCancel()
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault()
        if (actions.pending) return
        const data = new FormData(event.currentTarget)
        let changes: readonly AssemblyMutation[]
        try {
          changes = build(data)
        } catch {
          setInvalid(true)
          return
        }
        setInvalid(false)
        await actions.onApply(changes)
      }}
    >
      <fieldset disabled={actions.pending} className="grid min-w-0 gap-4">
        {children}
      </fieldset>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t("invalidParameters")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={actions.pending} aria-busy={actions.pending}>
          {t("apply")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={actions.pending}
          onClick={actions.onCancel}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  )
}
