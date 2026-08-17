import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { useEffect, useState } from "react"
import {
  type EditorCommandId,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

function ToolbarAction({
  buttonClassName,
  command,
  disabledReason,
  label,
}: {
  buttonClassName?: string
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
              className={buttonClassName}
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

type SketchToolFamilyId = "line" | "rectangle" | "circle" | "polygon" | "arc" | "slot"

const sketchToolFamilies = [
  {
    commandIds: [editorCommandIds.sketchLine, editorCommandIds.sketchMidpointLine],
    id: "line",
    labelKey: "lineToolsLabel",
  },
  {
    commandIds: [
      editorCommandIds.sketchRectangle,
      editorCommandIds.sketchCenterRectangle,
      editorCommandIds.sketchAlignedRectangle,
      editorCommandIds.sketchCenteredAlignedRectangle,
    ],
    id: "rectangle",
    labelKey: "rectangleToolsLabel",
  },
  {
    commandIds: [
      editorCommandIds.sketchCircle,
      editorCommandIds.sketchThreePointCircle,
      editorCommandIds.sketchEllipse,
    ],
    id: "circle",
    labelKey: "circleToolsLabel",
  },
  {
    commandIds: [
      editorCommandIds.sketchInscribedPolygon,
      editorCommandIds.sketchCircumscribedPolygon,
    ],
    id: "polygon",
    labelKey: "polygonToolsLabel",
  },
  {
    commandIds: [
      editorCommandIds.sketchSlot,
      editorCommandIds.sketchCenteredSlot,
      editorCommandIds.sketchSlotAroundLine,
    ],
    id: "slot",
    labelKey: "slotToolsLabel",
  },
  {
    commandIds: [
      editorCommandIds.sketchThreePointArc,
      editorCommandIds.sketchTangentArc,
      editorCommandIds.sketchArc,
      editorCommandIds.sketchEllipticalArc,
    ],
    id: "arc",
    labelKey: "arcToolsLabel",
  },
] as const satisfies readonly {
  commandIds: readonly EditorCommandId[]
  id: SketchToolFamilyId
  labelKey:
    | "lineToolsLabel"
    | "rectangleToolsLabel"
    | "circleToolsLabel"
    | "polygonToolsLabel"
    | "arcToolsLabel"
    | "slotToolsLabel"
}[]

const defaultFamilyCommandIds: Readonly<Record<SketchToolFamilyId, EditorCommandId>> = {
  arc: editorCommandIds.sketchThreePointArc,
  circle: editorCommandIds.sketchCircle,
  line: editorCommandIds.sketchLine,
  polygon: editorCommandIds.sketchInscribedPolygon,
  rectangle: editorCommandIds.sketchCenterRectangle,
  slot: editorCommandIds.sketchCenteredSlot,
}

const groupedSketchToolIds: ReadonlySet<EditorCommandId> = new Set<EditorCommandId>(
  sketchToolFamilies.flatMap(({ commandIds }) => commandIds),
)

function familyCommands(
  commands: readonly ResolvedEditorCommand[],
  commandIds: readonly EditorCommandId[],
) {
  const commandsById = new Map(commands.map((command) => [command.descriptor.id, command]))
  return commandIds.flatMap((id) => {
    const command = commandsById.get(id)
    return command ? [command] : []
  })
}

function SketchToolFamilyAction({
  commands,
  disabledReason,
  familyLabel,
  label,
  lastUsedCommandId,
  onCommandSelect,
}: {
  commands: readonly ResolvedEditorCommand[]
  disabledReason: (command: ResolvedEditorCommand) => string | null
  familyLabel: string
  label: (command: ResolvedEditorCommand) => string
  lastUsedCommandId: EditorCommandId
  onCommandSelect: (command: ResolvedEditorCommand) => void
}) {
  const activeCommand = commands.find(({ active }) => active)
  const primaryCommand =
    activeCommand ??
    commands.find(({ descriptor }) => descriptor.id === lastUsedCommandId) ??
    commands[0]
  if (!primaryCommand) return null
  return (
    <span className="inline-flex">
      <ToolbarAction
        buttonClassName="rounded-r-none"
        command={primaryCommand}
        disabledReason={disabledReason(primaryCommand)}
        label={label(primaryCommand)}
      />
      <DropdownMenu>
        <Tooltip>
          <ToolbarButton asChild>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={activeCommand ? "secondary" : "ghost"}
                  aria-label={familyLabel}
                  className="w-6 rounded-l-none border-l border-border px-0"
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
          </ToolbarButton>
          <TooltipContent>{familyLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={activeCommand?.descriptor.id ?? ""}
            onValueChange={(commandId) => {
              const command = commands.find(({ descriptor }) => descriptor.id === commandId)
              if (command) onCommandSelect(command)
            }}
          >
            {commands.map((command) => {
              const shortcut = command.descriptor.shortcut
                ? editorCommandShortcutLabel(command.descriptor.shortcut)
                : null
              return (
                <DropdownMenuRadioItem
                  key={command.descriptor.id}
                  value={command.descriptor.id}
                  aria-label={shortcut ? `${label(command)} ${shortcut}` : label(command)}
                  disabled={!command.eligibility.enabled}
                >
                  <EditorCommandIconView icon={command.descriptor.icon} />
                  <span className="flex-1">{label(command)}</span>
                  {shortcut ? (
                    <kbd className="font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>
                  ) : null}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
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
  const sketchModifyCommands = group("sketch-modify")
  const sketchModeCommands = group("sketch-mode")
  const historyCommands = group("history")
  const sketchMode = sketchToolCommands.length > 0
  const [lastUsedFamilyCommands, setLastUsedFamilyCommands] = useState(defaultFamilyCommandIds)
  const activeSketchToolId = sketchToolCommands.find(({ active }) => active)?.descriptor.id

  useEffect(() => {
    if (!activeSketchToolId) return
    const family = sketchToolFamilies.find(({ commandIds }) =>
      commandIds.some((commandId) => commandId === activeSketchToolId),
    )
    if (!family) return
    setLastUsedFamilyCommands((current) =>
      current[family.id] === activeSketchToolId
        ? current
        : { ...current, [family.id]: activeSketchToolId },
    )
  }, [activeSketchToolId])

  const selectFamilyCommand = (familyId: SketchToolFamilyId, command: ResolvedEditorCommand) => {
    setLastUsedFamilyCommands((current) => ({
      ...current,
      [familyId]: command.descriptor.id,
    }))
    command.invoke()
  }

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
              commands={sketchToolCommands.filter(
                ({ descriptor }) => !groupedSketchToolIds.has(descriptor.id),
              )}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              label={t("sketchToolsLabel")}
            />
            {sketchToolFamilies.map((family) => (
              <SketchToolFamilyAction
                key={family.id}
                commands={familyCommands(sketchToolCommands, family.commandIds)}
                disabledReason={getDisabledReason}
                familyLabel={t(family.labelKey)}
                label={getLabel}
                lastUsedCommandId={lastUsedFamilyCommands[family.id]}
                onCommandSelect={(command) => selectFamilyCommand(family.id, command)}
              />
            ))}
            <ToolbarSeparator />
            <ToolbarCommandGroup
              commands={sketchModifyCommands}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              label={t("sketchModifyLabel")}
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
