import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { Check, ChevronDown, Ellipsis } from "@vibeshape/ui/components/icons"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import { useEffect, useId, useState } from "react"
import {
  type EditorCommandId,
  type EditorCommandSketchFamilyId,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"
import { ActionAvailability } from "../components/action-availability"
import { NativeEditorCommandBridge } from "../desktop/native-editor-commands"
import { SketchConstraintManagerToolbarSlot } from "../features/sketch/sketch-toolbar-portals"

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
      <ActionAvailability
        disabledReason={disabledReason}
        disclosureLabel={label}
        presentation="disclosure"
      >
        {({ describedBy, blockActivation }) => (
          <TooltipTrigger asChild>
            <ToolbarButton asChild>
              <Button
                type="button"
                size="icon-sm"
                variant={command.active ? "secondary" : "ghost"}
                aria-label={label}
                aria-describedby={describedBy}
                aria-pressed={command.active}
                aria-disabled={!command.eligibility.enabled || undefined}
                className={cn("aria-disabled:pointer-events-auto", buttonClassName)}
                onClick={(event) => {
                  if (blockActivation(event)) return
                  if (!command.eligibility.enabled) return
                  return command.invoke()
                }}
              >
                <EditorCommandIconView icon={command.descriptor.icon} />
              </Button>
            </ToolbarButton>
          </TooltipTrigger>
        )}
      </ActionAvailability>
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

const sketchGeometryFamilies = [
  {
    id: "line",
    labelKey: "lineToolsLabel",
  },
  {
    id: "arc",
    labelKey: "arcToolsLabel",
  },
  {
    id: "rectangle",
    labelKey: "rectangleToolsLabel",
  },
  {
    id: "circle",
    labelKey: "circleToolsLabel",
  },
  {
    id: "slot",
    labelKey: "slotToolsLabel",
  },
  {
    id: "polygon",
    labelKey: "polygonToolsLabel",
  },
] as const satisfies readonly {
  id: EditorCommandSketchFamilyId
  labelKey:
    | "lineToolsLabel"
    | "rectangleToolsLabel"
    | "circleToolsLabel"
    | "polygonToolsLabel"
    | "arcToolsLabel"
    | "slotToolsLabel"
}[]

const sketchConstraintFamily = {
  id: "constraint",
  labelKey: "constraintToolsLabel",
} as const satisfies {
  id: EditorCommandSketchFamilyId
  labelKey: "constraintToolsLabel"
}

const profileFeatureCommandIds = [
  editorCommandIds.createExtrusion,
  editorCommandIds.createRevolve,
] as const satisfies readonly EditorCommandId[]

const modelDirectCommandIds = [
  editorCommandIds.createSketch,
  ...profileFeatureCommandIds,
] as const satisfies readonly EditorCommandId[]

const modelCreateCommandIds = [
  editorCommandIds.createDatumPlane,
  editorCommandIds.createLoft,
  editorCommandIds.createSweep,
  editorCommandIds.generativeDesign,
] as const satisfies readonly EditorCommandId[]

function commandsById(
  commands: readonly ResolvedEditorCommand[],
  commandIds: readonly EditorCommandId[],
) {
  const byId = new Map(commands.map((command) => [command.descriptor.id, command]))
  return commandIds.flatMap((id) => {
    const command = byId.get(id)
    return command ? [command] : []
  })
}

function familyCommands(
  commands: readonly ResolvedEditorCommand[],
  familyId: EditorCommandSketchFamilyId,
) {
  return commands
    .filter(({ descriptor }) => descriptor.sketchPresentation?.family === familyId)
    .sort(
      (first, second) =>
        (first.descriptor.sketchPresentation?.familyOrder ?? 0) -
          (second.descriptor.sketchPresentation?.familyOrder ?? 0) ||
        first.descriptor.id.localeCompare(second.descriptor.id),
    )
}

function ToolbarCommandFamilyAction({
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
  lastUsedCommandId: EditorCommandId | undefined
  onCommandSelect: (command: ResolvedEditorCommand) => void
}) {
  const activeCommand = commands.find(({ active }) => active)
  const primaryCommand =
    activeCommand ??
    commands.find(({ descriptor }) => descriptor.id === lastUsedCommandId) ??
    commands.find(({ descriptor }) => descriptor.sketchPresentation?.familyDefault) ??
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
                  className="rounded-l-none border-l border-border"
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
            value={primaryCommand.descriptor.id}
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
  framed = false,
  showLabel = framed,
  getDisabledReason,
  getLabel,
  label,
}: {
  framed?: boolean
  showLabel?: boolean
  commands: readonly ResolvedEditorCommand[]
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  getLabel: (command: ResolvedEditorCommand) => string
  label: string
}) {
  return (
    <fieldset
      aria-label={showLabel ? label : undefined}
      className={cn(
        showLabel ? "flex shrink-0 items-center gap-1 px-1" : "contents",
        framed && "rounded-md border border-border",
      )}
    >
      {!showLabel ? <legend className="sr-only">{label}</legend> : null}
      {showLabel ? (
        <span className="px-1 text-xs text-muted-foreground" aria-hidden="true">
          {label}
        </span>
      ) : null}
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

function ToolbarCommandMenu({
  commands,
  getDisabledReason,
  getLabel,
  label,
  showLabel = false,
}: {
  commands: readonly ResolvedEditorCommand[]
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  getLabel: (command: ResolvedEditorCommand) => string
  label: string
  showLabel?: boolean
}) {
  const menuId = useId()
  const hasActiveCommand = commands.some(({ active }) => active)
  if (commands.length === 0) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <ToolbarButton asChild>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size={showLabel ? "sm" : "icon-sm"}
                variant={hasActiveCommand ? "secondary" : "ghost"}
                aria-label={label}
                aria-current={hasActiveCommand ? "true" : undefined}
              >
                {showLabel ? (
                  <>
                    {hasActiveCommand ? <Check aria-hidden="true" /> : null}
                    {label}
                    <ChevronDown aria-hidden="true" />
                  </>
                ) : (
                  <Ellipsis aria-hidden="true" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
        </ToolbarButton>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className={
          showLabel
            ? "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
            : undefined
        }
      >
        {commands.map((command) => {
          const commandLabel = getLabel(command)
          const disabledReason = getDisabledReason(command)
          const reasonId = disabledReason ? `${menuId}-${command.descriptor.id}-reason` : undefined
          const shortcut = command.descriptor.shortcut
            ? editorCommandShortcutLabel(command.descriptor.shortcut)
            : null
          return (
            <DropdownMenuItem
              key={command.descriptor.id}
              aria-label={commandLabel}
              aria-describedby={reasonId}
              aria-current={command.active ? "true" : undefined}
              disabled={!command.eligibility.enabled}
              onSelect={command.invoke}
            >
              <EditorCommandIconView icon={command.descriptor.icon} />
              <span className="min-w-0 flex-1">
                <span className="block">{commandLabel}</span>
                {disabledReason ? (
                  <span
                    id={reasonId}
                    className="block max-w-72 whitespace-normal text-xs text-muted-foreground"
                  >
                    {disabledReason}
                  </span>
                ) : null}
              </span>
              {command.active ? <Check aria-hidden="true" /> : null}
              {shortcut ? (
                <kbd className="font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const modelPartCommands = group("model-part")
  const modelPrimaryCommands = group("model-primary")
  const modelInspectionCommands = group("model-inspection")
  const modelPrimitiveCommands = group("model-primitives")
  const sketchToolCommands = group("sketch-tools")
  const sketchPrecisionCommands = group("sketch-precision")
  const sketchModifyCommands = group("sketch-modify")
  const sketchModeCommands = group("sketch-mode")
  const sketchViewCommands = group("sketch-view")
  const historyCommands = group("history")
  const sketchMode = sketchToolCommands.length > 0
  const [lastUsedFamilyCommands, setLastUsedFamilyCommands] = useState<
    Partial<Record<EditorCommandSketchFamilyId, EditorCommandId>>
  >({})
  const sketchInteractiveCommands = [...sketchToolCommands, ...sketchPrecisionCommands]
  const activeSketchToolId = sketchInteractiveCommands.find(({ active }) => active)?.descriptor.id
  const activeSketchFamilyId = sketchInteractiveCommands.find(
    ({ descriptor }) => descriptor.id === activeSketchToolId,
  )?.descriptor.sketchPresentation?.family
  const profileFeatureCommands = commandsById(modelPrimaryCommands, profileFeatureCommandIds)
  const modelDirectCommands = commandsById(modelPrimaryCommands, modelDirectCommandIds)
  const modelCreateCommands = commandsById(modelPrimaryCommands, modelCreateCommandIds)
  const groupedModelCommandIds = new Set<EditorCommandId>([
    ...modelDirectCommandIds,
    ...modelCreateCommandIds,
  ])
  const modelModifyCommands = modelPrimaryCommands.filter(
    ({ descriptor }) => !groupedModelCommandIds.has(descriptor.id),
  )

  useEffect(() => {
    if (!activeSketchToolId) return
    if (!activeSketchFamilyId) return
    setLastUsedFamilyCommands((current) =>
      current[activeSketchFamilyId] === activeSketchToolId
        ? current
        : { ...current, [activeSketchFamilyId]: activeSketchToolId },
    )
  }, [activeSketchFamilyId, activeSketchToolId])

  const selectFamilyCommand = (
    familyId: EditorCommandSketchFamilyId,
    command: ResolvedEditorCommand,
  ) => {
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
      className="min-w-0 gap-2 border-b bg-toolbar px-2 py-1"
    >
      <nav>
        <NativeEditorCommandBridge commands={commands} />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sketchMode ? null : (
            <>
              <ToolbarCommandGroup
                commands={workspaceCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("workspaceLabel")}
              />
              <ToolbarSeparator />
            </>
          )}
          {sketchMode ? (
            <>
              <ToolbarCommandGroup
                commands={profileFeatureCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("profileFeaturesLabel")}
              />
              <ToolbarSeparator />
              <ToolbarCommandGroup
                commands={sketchToolCommands.filter(
                  ({ descriptor }) => !descriptor.sketchPresentation?.family,
                )}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("sketchToolsLabel")}
              />
              {sketchGeometryFamilies.map((family) => (
                <ToolbarCommandFamilyAction
                  key={family.id}
                  commands={familyCommands(sketchToolCommands, family.id)}
                  disabledReason={getDisabledReason}
                  familyLabel={t(family.labelKey)}
                  label={getLabel}
                  lastUsedCommandId={lastUsedFamilyCommands[family.id]}
                  onCommandSelect={(command) => selectFamilyCommand(family.id, command)}
                />
              ))}
              <ToolbarSeparator />
              <ToolbarCommandGroup
                commands={sketchPrecisionCommands.filter(
                  ({ descriptor }) => !descriptor.sketchPresentation?.family,
                )}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("sketchPrecisionLabel")}
              />
              <ToolbarCommandFamilyAction
                commands={familyCommands(sketchPrecisionCommands, sketchConstraintFamily.id)}
                disabledReason={getDisabledReason}
                familyLabel={t(sketchConstraintFamily.labelKey)}
                label={getLabel}
                lastUsedCommandId={lastUsedFamilyCommands[sketchConstraintFamily.id]}
                onCommandSelect={(command) =>
                  selectFamilyCommand(sketchConstraintFamily.id, command)
                }
              />
              <ToolbarCommandGroup
                commands={sketchModeCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("sketchModeLabel")}
              />
              <ToolbarSeparator />
              <ToolbarCommandGroup
                commands={sketchModifyCommands.filter(
                  ({ descriptor }) => descriptor.sketchPresentation?.compactToolbar === "visible",
                )}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("sketchModifyLabel")}
              />
              <span className="hidden xl:contents">
                <ToolbarCommandGroup
                  commands={sketchModifyCommands.filter(
                    ({ descriptor }) => descriptor.sketchPresentation?.compactToolbar !== "visible",
                  )}
                  getDisabledReason={getDisabledReason}
                  getLabel={getLabel}
                  label={t("sketchModifyLabel")}
                />
              </span>
              <span className="contents xl:hidden">
                <ToolbarCommandMenu
                  commands={sketchModifyCommands.filter(
                    ({ descriptor }) => descriptor.sketchPresentation?.compactToolbar !== "visible",
                  )}
                  getDisabledReason={getDisabledReason}
                  getLabel={getLabel}
                  label={t("sketchModifyLabel")}
                />
              </span>
              <ToolbarSeparator />
              <ToolbarCommandGroup
                commands={sketchViewCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("sketchViewLabel")}
              />
              <ToolbarSeparator />
              <SketchConstraintManagerToolbarSlot />
            </>
          ) : (
            <>
              {modelPartCommands.length > 0 ? (
                <ToolbarCommandGroup
                  framed
                  commands={modelPartCommands}
                  getDisabledReason={getDisabledReason}
                  getLabel={getLabel}
                  label={t("partActionsLabel")}
                />
              ) : null}
              <ToolbarCommandGroup
                commands={modelDirectCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("modelPrimaryLabel")}
              />

              <ToolbarCommandMenu
                showLabel
                commands={modelCreateCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("modelCreateLabel")}
              />
              <ToolbarCommandMenu
                showLabel
                commands={modelModifyCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("modelModifyLabel")}
              />
              <ToolbarCommandMenu
                showLabel
                commands={modelPrimitiveCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("primitives")}
              />
              <ToolbarCommandMenu
                showLabel
                commands={modelInspectionCommands}
                getDisabledReason={getDisabledReason}
                getLabel={getLabel}
                label={t("modelInspectLabel")}
              />
            </>
          )}
        </div>
        {historyCommands.length > 0 ? (
          <ToolbarCommandGroup
            showLabel
            commands={historyCommands}
            getDisabledReason={getDisabledReason}
            getLabel={getLabel}
            label={t("historyLabel")}
          />
        ) : null}
      </nav>
    </Toolbar>
  )
}
