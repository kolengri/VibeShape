import { Button } from "@vibeshape/ui/components/button"
import { useTranslations } from "@vibeshape/i18n"
import type { DocumentControllerState } from "../document/document-controller"

export function CommandToolbar({
  boxActive,
  controller,
  onCreateBox,
}: {
  boxActive: boolean
  controller: DocumentControllerState
  onCreateBox: () => void
}) {
  const t = useTranslations("app.shell.commandToolbar")
  const canCreate = controller.status === "ready" && controller.report?.mode === "read-write"

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="flex items-center gap-1 border-b bg-toolbar px-2"
      role="toolbar"
    >
      <Button type="button" size="sm" variant="secondary" aria-pressed="true">
        {t("model")}
      </Button>
      <Button type="button" size="sm" variant="ghost">
        {t("sketch")}
      </Button>
      <Button type="button" size="sm" variant="ghost">
        {t("print")}
      </Button>
      <span className="mx-1 h-5 border-l" aria-hidden="true" />
      <Button type="button" size="sm" variant="ghost">
        {t("createSketch")}
      </Button>
      <Button type="button" size="sm" variant="ghost">
        {t("extrude")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canCreate}
        aria-pressed={boxActive}
        onClick={onCreateBox}
      >
        {t("box")}
      </Button>
    </nav>
  )
}
