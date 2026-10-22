import type { AssemblyMutation } from "@vibeshape/domain/assembly-authority"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { useIsMounted } from "@vibeshape/ui/hooks/use-is-mounted"
import {
  Form,
  FormError,
  useAppForm,
  useFormContext,
} from "@vibeshape/ui/integrations/tanstack-form"
import { type ComponentProps, createContext, type ReactNode, useContext } from "react"
import { TaskPanelLayout } from "../../components/task-panel-layout"
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

export function useAssemblyForm<T>({
  defaultValues,
  build,
  actions,
  invalidMessage,
}: {
  defaultValues: T
  build: (values: T) => readonly AssemblyMutation[]
  actions: AssemblyFormActions
  invalidMessage?: string
}) {
  const t = useTranslations("app.assembly")
  const isMounted = useIsMounted()
  return useAppForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      if (!isMounted() || actions.pending) return
      let changes: readonly AssemblyMutation[]
      try {
        changes = build(value)
      } catch {
        formApi.setErrorMap({
          onSubmit: { form: invalidMessage ?? t("invalidParameters"), fields: {} },
        })
        return
      }
      if (isMounted() && !actions.pending) await actions.onApply(changes)
    },
  })
}

export function AssemblyTaskForm({
  form,
  children,
  actions,
  canApply = true,
}: {
  form: ComponentProps<typeof Form>["form"]
  children: ReactNode
  actions: AssemblyFormActions
  canApply?: boolean
}) {
  return (
    <Form
      form={form}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !actions.pending &&
          !form.state.isSubmitting
        ) {
          event.preventDefault()
          actions.onCancel()
        }
      }}
    >
      <AssemblyTaskFormContent actions={actions} canApply={canApply}>
        {children}
      </AssemblyTaskFormContent>
    </Form>
  )
}
function AssemblyTaskFormContent({
  children,
  actions,
  canApply,
}: {
  children: ReactNode
  actions: AssemblyFormActions
  canApply: boolean
}) {
  const t = useTranslations("app.assembly")
  const panel = useContext(AssemblyTaskPanelContext)
  const form = useFormContext()
  const appOwnsError = useReportApplicationError(panel?.error ?? null)
  if (!panel) throw new Error("Assembly task forms require an assembly task panel context.")
  return (
    <form.Subscribe
      selector={(state) => [state.isSubmitting, state.canSubmit, state.errorMap.onSubmit] as const}
    >
      {([submitting, canSubmit, invalid]) => {
        const pending = actions.pending || submitting
        return (
          <TaskPanelLayout
            title={panel.title}
            actions={
              <TaskPanelLifecycleActions
                ariaLabel={panel.title}
                acceptLabel={t("apply")}
                acceptType="submit"
                acceptDisabled={pending || !canSubmit || !canApply}
                acceptLoading={pending}
                cancelLabel={t("cancel")}
                cancelDisabled={pending}
                onCancel={actions.onCancel}
              />
            }
          >
            {panel.error && !appOwnsError && <Alert>{panel.error}</Alert>}
            <fieldset disabled={pending} className="grid min-w-0 gap-2">
              {children}
            </fieldset>
            {invalid && <FormError />}
          </TaskPanelLayout>
        )
      }}
    </form.Subscribe>
  )
}
