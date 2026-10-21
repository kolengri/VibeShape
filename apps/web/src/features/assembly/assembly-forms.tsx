import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { createContext, type ReactNode, useContext, useState } from "react"
import { TaskPanelHeader } from "../../components/task-panel-header"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import { useReportApplicationError } from "../../shell/application-notices"

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
  canApply = true,
  invalidMessage,
}: {
  children: ReactNode
  build: (data: FormData) => readonly AssemblyMutation[]
  actions: AssemblyFormActions
  canApply?: boolean
  invalidMessage?: string
}) {
  const t = useTranslations("app.assembly")
  const panel = useContext(AssemblyTaskPanelContext)
  const [invalid, setInvalid] = useState(false)
  const appOwnsError = useReportApplicationError(panel?.error ?? null)
  if (!panel) throw new Error("Assembly task forms require an assembly task panel context.")
  return (
    <form
      className="grid gap-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !actions.pending) {
          event.preventDefault()
          actions.onCancel()
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault()
        if (actions.pending || !canApply) return
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
            acceptDisabled={actions.pending || !canApply}
            acceptLoading={actions.pending}
            cancelLabel={t("cancel")}
            cancelDisabled={actions.pending}
            onCancel={actions.onCancel}
          />
        }
      />
      {panel.error && !appOwnsError && (
        <p role="alert" className="text-sm text-destructive">
          {panel.error}
        </p>
      )}
      <fieldset disabled={actions.pending} className="grid min-w-0 gap-4">
        {children}
      </fieldset>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {invalidMessage ?? t("invalidParameters")}
        </p>
      )}
    </form>
  )
}
