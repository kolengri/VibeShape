import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Box as BoxIcon,
  Circle,
  Construction,
  Cuboid,
  DraftingCompass,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Redo2,
  Scissors,
  Slash,
  Undo2,
} from "@vibeshape/ui/components/icons"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import type { ReactNode } from "react"
import type { DocumentControllerState } from "../document/document-controller"
import { booleanInputFeatures } from "../features/part-design/part-design-tool"
import type { ActiveSketchTool, SketchEditorTool } from "../features/sketch/sketch-tool"
import type { EditorWorkspaceName } from "./workspace"

type PartDesignCommand = "box" | "cylinder" | "extrusion" | "subtract"

type CommandToolbarProps = Readonly<{
  activeCommand: PartDesignCommand | null
  activeSketchTool: ActiveSketchTool | null
  controller: DocumentControllerState
  extrusionAvailable: boolean
  onCreateBox: () => void
  onCreateCylinder: () => void
  onCreateExtrusion: () => void
  onCreateSketch: () => void
  onCreateSubtract: () => void
  onSketchConstructionChange: (construction: boolean) => void
  onSketchEditorToolChange: (tool: SketchEditorTool) => void
  onSketchRedo: () => void
  onSketchUndo: () => void
  onWorkspaceChange: (workspace: EditorWorkspaceName) => void
  sketchConstruction: boolean
  sketchEditorTool: SketchEditorTool
  sketchRedoAvailable: boolean
  sketchUndoAvailable: boolean
  workspace: EditorWorkspaceName
}>

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

function ToolbarAction({
  children,
  disabled,
  onClick,
  pressed,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <ToolbarButton asChild>
      <Button
        type="button"
        size="sm"
        variant={pressed ? "secondary" : "ghost"}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </ToolbarButton>
  )
}

function WorkspaceSwitcher({
  activeCommand,
  activeSketchTool,
  onWorkspaceChange,
  workspace,
}: Pick<
  CommandToolbarProps,
  "activeCommand" | "activeSketchTool" | "onWorkspaceChange" | "workspace"
>) {
  const t = useTranslations("app.shell.commandToolbar")
  const displayedWorkspace = workspace === "variables" ? "model" : workspace
  return (
    <fieldset className="contents">
      <legend className="sr-only">{t("workspaceLabel")}</legend>
      <ToolbarAction
        pressed={displayedWorkspace === "model"}
        disabled={activeSketchTool !== null}
        onClick={() => onWorkspaceChange("model")}
      >
        <Cuboid aria-hidden="true" />
        {t("model")}
      </ToolbarAction>
      <ToolbarAction
        pressed={displayedWorkspace === "sketch"}
        disabled={activeCommand !== null}
        onClick={() => onWorkspaceChange("sketch")}
      >
        <DraftingCompass aria-hidden="true" />
        {t("sketch")}
      </ToolbarAction>
    </fieldset>
  )
}

const sketchTools = [
  ["select", MousePointer2],
  ["point", Circle],
  ["line", Slash],
  ["rectangle", RectangleHorizontal],
  ["circle", Circle],
  ["arc", PenLine],
] as const

function SketchCommandGroup({
  onSketchConstructionChange,
  onSketchEditorToolChange,
  onSketchRedo,
  onSketchUndo,
  sketchConstruction,
  sketchEditorTool,
  sketchRedoAvailable,
  sketchUndoAvailable,
}: Pick<
  CommandToolbarProps,
  | "onSketchConstructionChange"
  | "onSketchEditorToolChange"
  | "onSketchRedo"
  | "onSketchUndo"
  | "sketchConstruction"
  | "sketchEditorTool"
  | "sketchRedoAvailable"
  | "sketchUndoAvailable"
>) {
  const t = useTranslations("app.shell.commandToolbar")
  return (
    <>
      <fieldset className="contents">
        <legend className="sr-only">{t("sketchToolsLabel")}</legend>
        {sketchTools.map(([tool, Icon]) => (
          <ToolbarAction
            key={tool}
            pressed={sketchEditorTool === tool}
            onClick={() => onSketchEditorToolChange(tool)}
          >
            <Icon aria-hidden="true" />
            {t(`sketchTools.${tool}`)}
          </ToolbarAction>
        ))}
      </fieldset>
      <ToolbarSeparator />
      <ToolbarAction
        pressed={sketchConstruction}
        onClick={() => onSketchConstructionChange(!sketchConstruction)}
      >
        <Construction aria-hidden="true" />
        {t("construction")}
      </ToolbarAction>
      <ToolbarSeparator />
      <ToolbarAction disabled={!sketchUndoAvailable} onClick={onSketchUndo}>
        <Undo2 aria-hidden="true" />
        {t("undo")}
      </ToolbarAction>
      <ToolbarAction disabled={!sketchRedoAvailable} onClick={onSketchRedo}>
        <Redo2 aria-hidden="true" />
        {t("redo")}
      </ToolbarAction>
    </>
  )
}

function ModelCommandGroup({
  activeCommand,
  controller,
  extrusionAvailable,
  onCreateBox,
  onCreateCylinder,
  onCreateExtrusion,
  onCreateSketch,
  onCreateSubtract,
}: Pick<
  CommandToolbarProps,
  | "activeCommand"
  | "controller"
  | "extrusionAvailable"
  | "onCreateBox"
  | "onCreateCylinder"
  | "onCreateExtrusion"
  | "onCreateSketch"
  | "onCreateSubtract"
>) {
  const t = useTranslations("app.shell.commandToolbar")
  const canCreate = canCreateFeature(controller)
  const canSubtract = canSubtractFeatures(controller)
  const canExtrude = canCreate && extrusionAvailable
  return (
    <>
      <ToolbarAction disabled={!canCreate} onClick={onCreateSketch}>
        <DraftingCompass aria-hidden="true" />
        {t("createSketch")}
      </ToolbarAction>
      <ToolbarAction
        pressed={commandIsActive(activeCommand, "extrusion")}
        disabled={!canExtrude}
        onClick={onCreateExtrusion}
      >
        <BoxIcon aria-hidden="true" />
        {t("extrude")}
      </ToolbarAction>
      <ToolbarSeparator />
      <span className="px-1 text-xs text-muted-foreground" aria-hidden="true">
        {t("primitives")}
      </span>
      <ToolbarAction
        pressed={commandIsActive(activeCommand, "box")}
        disabled={!canCreate}
        onClick={onCreateBox}
      >
        <BoxIcon aria-hidden="true" />
        {t("box")}
      </ToolbarAction>
      <ToolbarAction
        pressed={commandIsActive(activeCommand, "cylinder")}
        disabled={!canCreate}
        onClick={onCreateCylinder}
      >
        <Circle aria-hidden="true" />
        {t("cylinder")}
      </ToolbarAction>
      <ToolbarAction
        pressed={commandIsActive(activeCommand, "subtract")}
        disabled={!canSubtract}
        onClick={onCreateSubtract}
      >
        <Scissors aria-hidden="true" />
        {t("subtract")}
      </ToolbarAction>
    </>
  )
}

export function CommandToolbar(props: CommandToolbarProps) {
  const t = useTranslations("app.shell.commandToolbar")
  return (
    <Toolbar
      asChild
      aria-label={t("ariaLabel")}
      className="min-w-0 gap-1 overflow-x-auto border-b bg-toolbar px-2"
    >
      <nav>
        <WorkspaceSwitcher
          activeCommand={props.activeCommand}
          activeSketchTool={props.activeSketchTool}
          workspace={props.workspace}
          onWorkspaceChange={props.onWorkspaceChange}
        />
        <ToolbarSeparator />
        {props.activeSketchTool ? (
          <SketchCommandGroup {...props} />
        ) : (
          <ModelCommandGroup {...props} />
        )}
      </nav>
    </Toolbar>
  )
}
