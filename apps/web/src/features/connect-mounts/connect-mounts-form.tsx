import type { FeatureRecord } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Form } from "@vibeshape/ui/integrations/tanstack-form"
import { ParameterPanel } from "../part-design/parameter-panel"
import { TaskPanelFormActions } from "../part-design/task-panel-form-actions"
import { useDebouncedFeaturePreview } from "../part-design/use-debounced-feature-preview"
import { ConnectMountsFields } from "./connect-mounts-form-fields"
import { type ConnectMountsFormProps, useConnectMountsDraft } from "./use-connect-mounts-draft"

function MountsPreview({
  feature,
  onPreviewChange,
}: {
  feature: FeatureRecord | null
  onPreviewChange: (feature: FeatureRecord | null) => void
}) {
  useDebouncedFeaturePreview({ preview: feature, onPreviewChange })
  return null
}

export function ConnectMountsForm(props: ConnectMountsFormProps) {
  const { mode, disabled = false, previewStatus, onPreviewChange } = props
  const t = useTranslations("app.connectMounts")
  const draft = useConnectMountsDraft(props)
  const { form, copy, candidate, state } = draft
  return (
    <Form
      form={form}
      aria-label={copy.title}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <form.Subscribe selector={(formState) => [formState.values, formState.isSubmitting] as const}>
        {([values, pending]) => {
          const { feature, issues } = candidate(values)
          return (
            <>
              {onPreviewChange && (
                <MountsPreview feature={feature} onPreviewChange={onPreviewChange} />
              )}
              <ParameterPanel
                copy={copy}
                previewStatus={previewStatus}
                legend={t("parameters")}
                disabled={disabled || pending}
                message={state.message ?? (!feature ? t("validationSummary") : null)}
                actions={
                  <TaskPanelFormActions
                    acceptLabel={t(mode.kind === "edit" ? "update" : "create")}
                    ariaLabel={copy.title}
                    cancelLabel={copy.cancel}
                    disabled={disabled || !feature}
                    onCancel={props.onCancel}
                    previewStatus={previewStatus}
                  />
                }
              >
                <p className="text-xs text-muted-foreground">{t("coordinateSnapshot")}</p>
                <ConnectMountsFields
                  draft={draft}
                  values={values}
                  issues={issues}
                  modelPoints={props.modelPoints}
                />
              </ParameterPanel>
            </>
          )
        }}
      </form.Subscribe>
    </Form>
  )
}
