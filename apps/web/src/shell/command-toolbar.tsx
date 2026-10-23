import { useTranslations } from "@vibeshape/i18n"
import { Button, buttonVariants } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import {
  AddIcon,
  Check,
  ChevronDown,
  MeasureIcon,
  ModelIcon,
  ModifyIcon,
} from "@vibeshape/ui/components/icons"
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { cn } from "@vibeshape/ui/lib/cn"
import {
  type ComponentType,
  type ReactNode,
  type RefObject,
  type SVGProps,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
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
import { useResponsiveToolbar } from "./responsive-toolbar"
import { ToolbarCommandPicker, toolbarMenuTriggerClassName } from "./toolbar-command-picker"

function ToolbarAction({
  buttonClassName,
  buttonRef,
  command,
  disabledReason,
  label,
}: {
  buttonClassName?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
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
                ref={buttonRef}
                type="button"
                size="icon-sm"
                variant={command.active ? "secondary" : "ghost"}
                aria-label={label}
                aria-describedby={describedBy}
                aria-pressed={command.active}
                data-responsive-command={command.descriptor.id}
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
  if (commands.length === 1)
    return (
      <ToolbarAction
        command={primaryCommand}
        disabledReason={disabledReason(primaryCommand)}
        label={label(primaryCommand)}
      />
    )
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

function useMenuTriggerFocus(direct: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (restoreFocus.current) triggerRef.current?.focus()
    restoreFocus.current = false
    return () => {
      restoreFocus.current =
        triggerRef.current !== null && triggerRef.current === document.activeElement
    }
  }, [direct])
  return triggerRef
}

type ToolbarCommandMenuProps = {
  commands: readonly ResolvedEditorCommand[]
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  getLabel: (command: ResolvedEditorCommand) => string
  label: string
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  focusId?: string
  onOpenChange?: (open: boolean) => void
}

function ToolbarCommandMenu(props: ToolbarCommandMenuProps) {
  const direct = props.commands.length === 1
  const triggerRef = useMenuTriggerFocus(direct)
  useEffect(() => {
    if (props.commands.length < 2) props.onOpenChange?.(false)
  }, [props.commands.length, props.onOpenChange])
  const first = props.commands[0]
  if (!first) return null
  if (direct)
    return (
      <ToolbarAction
        buttonRef={triggerRef}
        command={first}
        disabledReason={props.getDisabledReason(first)}
        label={props.getLabel(first)}
      />
    )
  return props.commands.length > 6 ? (
    <ToolbarCommandPicker {...props} triggerRef={triggerRef} />
  ) : (
    <ToolbarCommandDropdown {...props} triggerRef={triggerRef} />
  )
}

function ToolbarCommandDropdown({
  triggerRef,
  commands,
  getDisabledReason,
  getLabel,
  label,
  icon: Icon = ChevronDown,
  focusId,
  onOpenChange,
}: ToolbarCommandMenuProps & { triggerRef: RefObject<HTMLButtonElement | null> }) {
  const menuId = useId()
  const hasActiveCommand = commands.some(({ active }) => active)
  return (
    <DropdownMenu {...(onOpenChange ? { onOpenChange } : {})}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToolbarButton asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                size="icon-sm"
                variant={hasActiveCommand ? "secondary" : "ghost"}
                aria-label={label}
                aria-current={hasActiveCommand ? "true" : undefined}
                data-toolbar-menu={focusId}
                dropdown={Icon !== ChevronDown}
                data-has-indicator={Icon !== ChevronDown}
                className={toolbarMenuTriggerClassName}
              >
                <Icon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </ToolbarButton>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
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
              data-command-id={command.descriptor.id}
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

type ModelToolbarGroup = Readonly<{
  id: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  commands: readonly ResolvedEditorCommand[]
}>
const modelQuickCommands = [
  editorCommandIds.createFillet,
  editorCommandIds.createBox,
  editorCommandIds.measure,
  editorCommandIds.createDatumPlane,
  editorCommandIds.createChamfer,
  editorCommandIds.createCylinder,
  editorCommandIds.createLoft,
  editorCommandIds.createHole,
  editorCommandIds.createSweep,
] as const

function ModelToolbarProbe({
  groups,
  partCommands,
  directCommands,
  partLabel,
  probe,
}: {
  groups: readonly ModelToolbarGroup[]
  partCommands: readonly ResolvedEditorCommand[]
  directCommands: readonly ResolvedEditorCommand[]
  partLabel: string
  probe: RefObject<HTMLDivElement | null>
}) {
  const icon = (id: string) => (
    <span key={id} className={cn(buttonVariants({ size: "icon-sm", variant: "ghost" }))} />
  )
  // Inert shapes keep the current visible command set out of the fit measurement.
  return (
    <div
      ref={probe}
      aria-hidden="true"
      inert
      className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-1"
      data-toolbar-measure
    >
      <span data-fit-leading className="flex items-center gap-1">
        {partCommands.length > 0 && (
          <span className="flex items-center gap-1 rounded-md border border-border px-1">
            <span className="px-1 text-xs">{partLabel}</span>
            {partCommands.map((command) => icon(command.descriptor.id))}
          </span>
        )}
        {directCommands.map((command) => icon(command.descriptor.id))}
      </span>
      <span data-fit-icon>{icon("icon")}</span>
      <span data-fit-separator className="inline-flex">
        <span className="mx-1 h-5 w-px" />
      </span>
      {groups.map((group) => (
        <span
          key={group.id}
          data-fit-menu={group.id}
          data-has-indicator={group.icon !== undefined}
          className={cn(
            buttonVariants({ size: "icon-sm", variant: "ghost" }),
            toolbarMenuTriggerClassName,
          )}
        />
      ))}
    </div>
  )
}

function ModelToolbar({
  groups: allGroups,
  partCommands,
  directCommands,
  getDisabledReason,
  getLabel,
  partLabel,
  directLabel,
  overflowLabel,
}: {
  groups: readonly ModelToolbarGroup[]
  partCommands: readonly ResolvedEditorCommand[]
  directCommands: readonly ResolvedEditorCommand[]
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  getLabel: (command: ResolvedEditorCommand) => string
  partLabel: string
  directLabel: string
  overflowLabel: string
}) {
  const groups = allGroups.filter((group) => group.commands.length > 0)
  const layout = useResponsiveToolbar(
    groups.map((group) => ({
      id: group.id,
      commands: group.commands.map((command) => command.descriptor.id),
    })),
    modelQuickCommands,
  )
  const inline = new Set(layout.fit.inline)
  const shared = { getDisabledReason, getLabel }
  return (
    <div
      ref={layout.container}
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      data-responsive-model-toolbar
    >
      <ModelToolbarProbe
        groups={groups}
        partCommands={partCommands}
        directCommands={directCommands}
        partLabel={partLabel}
        probe={layout.probe}
      />
      {layout.fit.compact ? (
        <ToolbarCommandMenu
          {...shared}
          focusId="all"
          label={overflowLabel}
          commands={[
            ...partCommands,
            ...directCommands,
            ...groups.flatMap((group) => group.commands),
          ]}
          onOpenChange={layout.onMenuOpenChange}
        />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1" data-model-group="leading">
            {partCommands.length > 0 && (
              <ToolbarCommandGroup {...shared} framed commands={partCommands} label={partLabel} />
            )}
            <ToolbarCommandGroup {...shared} commands={directCommands} label={directLabel} />
          </div>
          {groups.map((group) => (
            <div key={group.id} className="contents">
              <ToolbarSeparator />
              <div className="flex shrink-0 items-center gap-1" data-model-group={group.id}>
                {group.commands
                  .filter((command) => inline.has(command.descriptor.id))
                  .map((command) => (
                    <ToolbarAction
                      key={command.descriptor.id}
                      command={command}
                      disabledReason={getDisabledReason(command)}
                      label={getLabel(command)}
                    />
                  ))}
                <ToolbarCommandMenu
                  {...shared}
                  icon={group.icon}
                  focusId={group.id}
                  label={group.label}
                  commands={group.commands.filter((command) => !inline.has(command.descriptor.id))}
                  onOpenChange={layout.onMenuOpenChange}
                />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export function CommandToolbar({
  commands,
  tools,
}: {
  commands: readonly ResolvedEditorCommand[]
  tools?: ReactNode
}) {
  const t = useTranslations("app.shell.commandToolbar")
  const copy = useEditorCommandCopy()
  const getLabel = (command: ResolvedEditorCommand) => copy.label(command.descriptor)
  const getDisabledReason = (command: ResolvedEditorCommand) =>
    command.eligibility.enabled ? null : copy.disabledReason(command.eligibility.reason)
  const visibleCommands = commands.filter(({ toolbarVisible }) => toolbarVisible)
  const group = (groupName: ResolvedEditorCommand["descriptor"]["toolbarGroup"]) =>
    visibleCommands.filter(({ descriptor }) => descriptor.toolbarGroup === groupName)
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

  if (tools !== undefined) {
    return (
      <nav
        aria-label={t("ariaLabel")}
        data-sketch-mode={false}
        className="flex min-w-0 items-center gap-2 border-b bg-toolbar px-2 py-1"
      >
        <NativeEditorCommandBridge commands={commands} />
        {tools}
        {historyCommands.length > 0 && (
          <Toolbar aria-label={t("historyLabel")} className="shrink-0 gap-1">
            <ToolbarCommandGroup
              commands={historyCommands}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              label={t("historyLabel")}
            />
          </Toolbar>
        )}
      </nav>
    )
  }

  return (
    <Toolbar
      asChild
      aria-label={t("ariaLabel")}
      data-sketch-mode={sketchMode}
      className={cn("min-w-0 gap-2 border-b bg-toolbar px-2 py-1", sketchMode && "items-start")}
    >
      <nav>
        <NativeEditorCommandBridge commands={commands} />
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1",
            sketchMode ? "overflow-x-auto pb-4 [scrollbar-width:thin]" : "overflow-hidden",
          )}
        >
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
            <ModelToolbar
              partCommands={modelPartCommands}
              directCommands={modelDirectCommands}
              partLabel={t("partActionsLabel")}
              directLabel={t("modelPrimaryLabel")}
              overflowLabel={t("modelPrimaryLabel")}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              groups={[
                {
                  id: "create",
                  label: t("modelCreateLabel"),
                  icon: AddIcon,
                  commands: modelCreateCommands,
                },
                {
                  id: "modify",
                  label: t("modelModifyLabel"),
                  icon: ModifyIcon,
                  commands: modelModifyCommands,
                },
                {
                  id: "primitives",
                  label: t("primitives"),
                  icon: ModelIcon,
                  commands: modelPrimitiveCommands,
                },
                {
                  id: "inspect",
                  label: t("modelInspectLabel"),
                  icon: MeasureIcon,
                  commands: modelInspectionCommands,
                },
              ]}
            />
          )}
        </div>
        {historyCommands.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1">
            <ToolbarCommandGroup
              commands={historyCommands}
              getDisabledReason={getDisabledReason}
              getLabel={getLabel}
              label={t("historyLabel")}
            />
          </div>
        ) : null}
      </nav>
    </Toolbar>
  )
}
