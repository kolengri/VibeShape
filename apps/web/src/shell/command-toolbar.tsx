import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { DocumentControllerState } from "../document/document-controller"
import { booleanInputFeatures } from "../features/part-design/part-design-tool"

type PartDesignCommand = "box" | "cylinder" | "subtract"

function canCreateFeature(controller: DocumentControllerState) {
  return controller.status === "ready" && controller.report?.mode === "read-write"
}

function canSubtractFeatures(controller: DocumentControllerState) {
  if (!canCreateFeature(controller)) return false
  return booleanInputFeatures(controller.report?.snapshot.features ?? []).length >= 2
}

function commandIsActive(activeCommand: PartDesignCommand | null, command: PartDesignCommand) {
  return activeCommand === command
}

export function CommandToolbar({
  activeCommand,
  controller,
  onCreateBox,
  onCreateCylinder,
  onCreateSubtract,
}: {
  activeCommand: PartDesignCommand | null
  controller: DocumentControllerState
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateSubtract: () => void
}) {
  const t = useTranslations("app.shell.commandToolbar")
  const canCreate = canCreateFeature(controller)
  const canSubtract = canSubtractFeatures(controller)

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
        aria-pressed={commandIsActive(activeCommand, "box")}
        onClick={onCreateBox}
      >
        {t("box")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canCreate}
        aria-pressed={commandIsActive(activeCommand, "cylinder")}
        onClick={onCreateCylinder}
      >
        {t("cylinder")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canSubtract}
        aria-pressed={commandIsActive(activeCommand, "subtract")}
        onClick={onCreateSubtract}
      >
        {t("subtract")}
      </Button>
    </nav>
  )
}
