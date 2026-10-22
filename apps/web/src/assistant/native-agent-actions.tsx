import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"

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
    <Button
      form={form}
      type="submit"
      size="sm"
      aria-busy={pending || undefined}
      disabled={pending || disabled}
    >
      {t("connect")}
    </Button>
  )
}
