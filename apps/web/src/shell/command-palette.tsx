import { useTranslations } from "@vibeshape/i18n"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@vibeshape/ui/components/command"
import { type RefObject, useState } from "react"
import { z } from "zod"
import {
  type EditorCommandGroup,
  type EditorCommandId,
  editorCommandIds,
  type ResolvedEditorCommand,
} from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

const recentStorageKey = "vibeshape.editor-command-recents.v1"
const recentCommandIdsSchema = z
  .array(
    z.enum([
      editorCommandIds.cancelActive,
      editorCommandIds.createBox,
      editorCommandIds.createCylinder,
      editorCommandIds.createExtrusion,
      editorCommandIds.createRevolve,
      editorCommandIds.createSketch,
      editorCommandIds.createSubtract,
      editorCommandIds.sketchAlignedRectangle,
      editorCommandIds.sketchArc,
      editorCommandIds.sketchEllipticalArc,
      editorCommandIds.sketchMidpointLine,
      editorCommandIds.sketchThreePointArc,
      editorCommandIds.sketchThreePointCircle,
      editorCommandIds.sketchCenterRectangle,
      editorCommandIds.sketchCenteredAlignedRectangle,
      editorCommandIds.sketchCenteredSlot,
      editorCommandIds.sketchCircle,
      editorCommandIds.sketchConstruction,
      editorCommandIds.sketchDimension,
      editorCommandIds.sketchLine,
      editorCommandIds.sketchPoint,
      editorCommandIds.sketchRectangle,
      editorCommandIds.sketchRedo,
      editorCommandIds.sketchSelect,
      editorCommandIds.sketchSlot,
      editorCommandIds.sketchSlotAroundLine,
      editorCommandIds.sketchTangentArc,
      editorCommandIds.sketchUndo,
      editorCommandIds.workspaceModel,
      editorCommandIds.workspaceSketch,
    ]),
  )
  .max(6)

const groupOrder: readonly EditorCommandGroup[] = ["workspace", "modeling", "sketch", "history"]

function readRecentCommandIds(): readonly EditorCommandId[] {
  try {
    const source = localStorage.getItem(recentStorageKey)
    if (!source) return []
    const parsed = recentCommandIdsSchema.safeParse(JSON.parse(source))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeRecentCommandIds(commandIds: readonly EditorCommandId[]) {
  try {
    localStorage.setItem(recentStorageKey, JSON.stringify(commandIds))
  } catch {
    // Command execution must not depend on preference storage.
  }
}

function sortByRecent(
  commands: readonly ResolvedEditorCommand[],
  recentCommandIds: readonly EditorCommandId[],
) {
  const recentRank = new Map(recentCommandIds.map((id, index) => [id, index]))
  return commands
    .map((command, index) => ({ command, index }))
    .sort((first, second) => {
      const firstRank = recentRank.get(first.command.descriptor.id) ?? Number.MAX_SAFE_INTEGER
      const secondRank = recentRank.get(second.command.descriptor.id) ?? Number.MAX_SAFE_INTEGER
      return firstRank - secondRank || first.index - second.index
    })
    .map(({ command }) => command)
}

function PaletteCommand({
  command,
  keywords,
  label,
  onInvoke,
  reason,
}: {
  command: ResolvedEditorCommand
  keywords: string[]
  label: string
  onInvoke: (command: ResolvedEditorCommand) => void
  reason: string | null
}) {
  return (
    <CommandItem
      disabled={!command.eligibility.enabled}
      keywords={keywords}
      value={command.descriptor.id}
      onSelect={() => onInvoke(command)}
    >
      <EditorCommandIconView icon={command.descriptor.icon} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {reason ? (
          <span className="block truncate text-xs text-muted-foreground">{reason}</span>
        ) : null}
      </span>
      {command.descriptor.shortcut ? (
        <CommandShortcut>{editorCommandShortcutLabel(command.descriptor.shortcut)}</CommandShortcut>
      ) : null}
    </CommandItem>
  )
}

export function EditorCommandPalette({
  commands,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  commands: readonly ResolvedEditorCommand[]
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const t = useTranslations("app.commands.palette")
  const copy = useEditorCommandCopy()
  const [query, setQuery] = useState("")
  const [recentCommandIds, setRecentCommandIds] =
    useState<readonly EditorCommandId[]>(readRecentCommandIds)
  const sortedCommands = sortByRecent(commands, recentCommandIds)
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) setQuery("")
    onOpenChange(nextOpen)
  }
  const invoke = (command: ResolvedEditorCommand) => {
    if (!command.eligibility.enabled) return
    const nextRecent = [
      command.descriptor.id,
      ...recentCommandIds.filter((id) => id !== command.descriptor.id),
    ].slice(0, 6)
    setRecentCommandIds(nextRecent)
    writeRecentCommandIds(nextRecent)
    setOpen(false)
    command.invoke()
  }

  return (
    <CommandDialog
      closeLabel={t("closeLabel")}
      description={t("description")}
      open={open}
      searchLabel={t("searchLabel")}
      title={t("title")}
      onCloseAutoFocus={(event) => {
        const returnTarget = returnFocusRef.current
        if (!returnTarget?.isConnected) return
        event.preventDefault()
        returnTarget.focus()
      }}
      onOpenChange={setOpen}
    >
      <CommandInput
        aria-label={t("searchLabel")}
        placeholder={t("placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList label={t("resultsLabel")}>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        {groupOrder.map((group) => {
          const groupedCommands = sortedCommands.filter(
            ({ descriptor }) => descriptor.group === group,
          )
          return groupedCommands.length > 0 ? (
            <CommandGroup key={group} heading={copy.group(group)}>
              {groupedCommands.map((command) => (
                <PaletteCommand
                  key={command.descriptor.id}
                  command={command}
                  keywords={[
                    ...copy.keywords(command.descriptor.labelKey),
                    command.eligibility.enabled
                      ? ""
                      : copy.disabledReason(command.eligibility.reason),
                  ]}
                  label={copy.label(command.descriptor)}
                  reason={
                    command.eligibility.enabled
                      ? null
                      : copy.disabledReason(command.eligibility.reason)
                  }
                  onInvoke={invoke}
                />
              ))}
            </CommandGroup>
          ) : null
        })}
      </CommandList>
    </CommandDialog>
  )
}
