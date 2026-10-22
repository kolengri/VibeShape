import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { SubmitButton } from "@vibeshape/ui/integrations/tanstack-form"

export function NativeAgentActions({
  connected,
  pending,
  disabled,
  disconnect,
  form,
}: {
  connected: boolean
  pending: boolean
  disabled?: boolean
  disconnect: () => Promise<void>
  form?: string
}) {
  const t = useTranslations("app.assistant")
  return connected ? (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={disconnect}>
      {t("disconnect")}
    </Button>
  ) : (
    <SubmitButton form={form} size="sm" requireDirty={false} disabled={pending || disabled}>
      {t("connect")}
    </SubmitButton>
  )
}
