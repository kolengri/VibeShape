import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import type { DocumentControllerState } from "../document/document-controller"
import { booleanInputFeatures } from "../features/part-design/part-design-tool"
import type { EditorWorkspaceName } from "./workspace"

type PartDesignCommand = "box" | "cylinder" | "extrusion" | "subtract"

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
  extrusionAvailable,
  onCreateBox,
  onCreateCylinder,
  onCreateExtrusion,
  onCreateSketch,
  onCreateSubtract,
  onWorkspaceChange,
  workspace,
}: {
  activeCommand: PartDesignCommand | null
  controller: DocumentControllerState
  extrusionAvailable: boolean
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onCreateSubtract: () => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  workspace: EditorWorkspaceName
}) {
  const t = useTranslations("app.shell.commandToolbar")
  const canCreate = canCreateFeature(controller)
  const canSubtract = canSubtractFeatures(controller)
  const canExtrude = canCreate && extrusionAvailable

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="flex items-center gap-1 border-b bg-toolbar px-2"
      role="toolbar"
    >
      <Button
        type="button"
        size="sm"
        variant={workspace === "model" ? "secondary" : "ghost"}
        aria-pressed={workspace === "model"}
        onClick={() => onWorkspaceChange("model")}
      >
        {t("model")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={workspace === "sketch" ? "secondary" : "ghost"}
        aria-pressed={workspace === "sketch"}
        onClick={() => onWorkspaceChange("sketch")}
      >
        {t("sketch")}
      </Button>
      <Button type="button" size="sm" variant="ghost">
        {t("print")}
      </Button>
      <span className="mx-1 h-5 border-l" aria-hidden="true" />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canCreate}
        onClick={onCreateSketch}
      >
        {t("createSketch")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canExtrude}
        aria-pressed={commandIsActive(activeCommand, "extrusion")}
        onClick={onCreateExtrusion}
      >
        {t("extrude")}
      </Button>
      <span className="mx-1 h-5 border-l" aria-hidden="true" />
      <span className="px-1 text-xs text-muted-foreground">{t("directSolids")}</span>
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
