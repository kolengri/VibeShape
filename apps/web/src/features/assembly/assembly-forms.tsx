import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { createContext, type ReactNode, useContext, useState } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"

export const AssemblyTaskPanelContext = createContext<{
  title: string
  error: string | null
} | null>(null)

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
  const panel = useContext(AssemblyTaskPanelContext)
  const [invalid, setInvalid] = useState(false)
  if (!panel) throw new Error("Assembly task forms require an assembly task panel context.")
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
      <TaskPanelHeader
        title={panel.title}
        actions={
          <TaskPanelLifecycleActions
            ariaLabel={panel.title}
            acceptLabel={t("apply")}
            acceptType="submit"
            acceptDisabled={actions.pending}
            acceptLoading={actions.pending}
            cancelLabel={t("cancel")}
            cancelDisabled={actions.pending}
            onCancel={actions.onCancel}
          />
        }
      />
      {panel.error && (
        <p role="alert" className="text-sm text-destructive">
          {panel.error}
        </p>
      )}
      <fieldset disabled={actions.pending} className="grid min-w-0 gap-4">
        {children}
      </fieldset>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t("invalidParameters")}
        </p>
      )}
    </form>
  )
}
