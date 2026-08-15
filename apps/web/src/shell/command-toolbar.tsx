import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

function ToolbarAction({ command, label }: { command: ResolvedEditorCommand; label: string }) {
  return (
    <ToolbarButton asChild>
      <Button
        type="button"
        size="sm"
        variant={command.active ? "secondary" : "ghost"}
        aria-pressed={command.active}
        disabled={!command.eligibility.enabled}
        onClick={command.invoke}
      >
        <EditorCommandIconView icon={command.descriptor.icon} />
        {label}
      </Button>
    </ToolbarButton>
  )
}

function ToolbarCommandGroup({
  commands,
  getLabel,
  label,
}: {
  commands: readonly ResolvedEditorCommand[]
  getLabel: (command: ResolvedEditorCommand) => string
  label: string
}) {
  return (
    <fieldset className="contents">
      <legend className="sr-only">{label}</legend>
      {commands.map((command) => (
        <ToolbarAction key={command.descriptor.id} command={command} label={getLabel(command)} />
      ))}
    </fieldset>
  )
}

export function CommandToolbar({ commands }: { commands: readonly ResolvedEditorCommand[] }) {
  const t = useTranslations("app.shell.commandToolbar")
  const copy = useEditorCommandCopy()
  const getLabel = (command: ResolvedEditorCommand) => copy.label(command.descriptor)
  const visibleCommands = commands.filter(({ toolbarVisible }) => toolbarVisible)
  const group = (groupName: ResolvedEditorCommand["descriptor"]["toolbarGroup"]) =>
    visibleCommands.filter(({ descriptor }) => descriptor.toolbarGroup === groupName)
  const workspaceCommands = group("workspace")
  const modelPrimaryCommands = group("model-primary")
  const modelPrimitiveCommands = group("model-primitives")
  const sketchToolCommands = group("sketch-tools")
  const sketchModeCommands = group("sketch-mode")
  const historyCommands = group("history")
  const sketchMode = sketchToolCommands.length > 0

  return (
    <Toolbar
      asChild
      aria-label={t("ariaLabel")}
      className="min-w-0 gap-1 overflow-x-auto border-b bg-toolbar px-2"
    >
      <nav>
        <ToolbarCommandGroup
          commands={workspaceCommands}
          getLabel={getLabel}
          label={t("workspaceLabel")}
        />
        <ToolbarSeparator />
        {sketchMode ? (
          <>
            <ToolbarCommandGroup
              commands={sketchToolCommands}
              getLabel={getLabel}
              label={t("sketchToolsLabel")}
            />
            <ToolbarSeparator />
            {sketchModeCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                label={getLabel(command)}
              />
            ))}
            <ToolbarSeparator />
            {historyCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                label={getLabel(command)}
              />
            ))}
          </>
        ) : (
          <>
            {modelPrimaryCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                label={getLabel(command)}
              />
            ))}
            <ToolbarSeparator />
            <span className="px-1 text-xs text-muted-foreground" aria-hidden="true">
              {t("primitives")}
            </span>
            {modelPrimitiveCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                label={getLabel(command)}
              />
            ))}
          </>
        )}
      </nav>
    </Toolbar>
  )
}
