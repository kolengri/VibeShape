import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"

export function NativeAgentActions({
  connected,
  pending,
  disabled,
  disconnect,
}: {
  connected: boolean
  pending: boolean
  disabled?: boolean
  disconnect: () => Promise<void>
}) {
  const t = useTranslations("app.assistant")
  return connected ? (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={disconnect}>
      {t("disconnect")}
    </Button>
  ) : (
    <Button type="submit" size="sm" aria-busy={pending || undefined} disabled={pending || disabled}>
      {t("connect")}
    </Button>
  )
}
