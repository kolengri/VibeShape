import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

function ToolbarAction({
  command,
  disabledReason,
  label,
}: {
  command: ResolvedEditorCommand
  disabledReason: string | null
  label: string
}) {
  const shortcut = command.descriptor.shortcut
    ? editorCommandShortcutLabel(command.descriptor.shortcut)
    : null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <ToolbarButton asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={command.active ? "secondary" : "ghost"}
              aria-label={label}
              aria-pressed={command.active}
              disabled={!command.eligibility.enabled}
              onClick={command.invoke}
            >
              <EditorCommandIconView icon={command.descriptor.icon} />
            </Button>
          </ToolbarButton>
        </span>
      </TooltipTrigger>
      <TooltipContent className="grid gap-1">
        <span className="flex items-center justify-between gap-3">
          <span>{label}</span>
          {shortcut ? (
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              {shortcut}
            </kbd>
          ) : null}
        </span>
        {disabledReason ? <span className="text-muted-foreground">{disabledReason}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarCommandGroup({
  commands,
  getDisabledReason,
  getLabel,
  label,
}: {
  commands: readonly ResolvedEditorCommand[]
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  getLabel: (command: ResolvedEditorCommand) => string
  label: string
}) {
  return (
    <fieldset className="contents">
      <legend className="sr-only">{label}</legend>
      {commands.map((command) => (
        <ToolbarAction
          key={command.descriptor.id}
          command={command}
          disabledReason={getDisabledReason(command)}
          label={getLabel(command)}
        />
      ))}
    </fieldset>
  )
}

export function CommandToolbar({ commands }: { commands: readonly ResolvedEditorCommand[] }) {
  const t = useTranslations("app.shell.commandToolbar")
  const copy = useEditorCommandCopy()
  const getLabel = (command: ResolvedEditorCommand) => copy.label(command.descriptor)
  const getDisabledReason = (command: ResolvedEditorCommand) =>
    command.eligibility.enabled ? null : copy.disabledReason(command.eligibility.reason)
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
          getDisabledReason={getDisabledReason}
          getLabel={getLabel}
          label={t("workspaceLabel")}
        />
        <ToolbarSeparator />
        {sketchMode ? (
          <>
            <ToolbarCommandGroup
              commands={sketchToolCommands}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              label={t("sketchToolsLabel")}
            />
            <ToolbarSeparator />
            {sketchModeCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                disabledReason={getDisabledReason(command)}
                label={getLabel(command)}
              />
            ))}
            <ToolbarSeparator />
            {historyCommands.map((command) => (
              <ToolbarAction
                key={command.descriptor.id}
                command={command}
                disabledReason={getDisabledReason(command)}
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
                disabledReason={getDisabledReason(command)}
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
                disabledReason={getDisabledReason(command)}
                label={getLabel(command)}
              />
            ))}
          </>
        )}
      </nav>
    </Toolbar>
  )
}
