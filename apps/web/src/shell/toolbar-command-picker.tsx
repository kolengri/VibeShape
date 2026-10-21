import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@vibeshape/ui/components/command"
import { Check, ChevronDown, Ellipsis } from "@vibeshape/ui/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@vibeshape/ui/components/popover"
import { ToolbarButton } from "@vibeshape/ui/components/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@vibeshape/ui/components/tooltip"
import { type ComponentType, type RefObject, type SVGProps, useId, useState } from "react"
import type { ResolvedEditorCommand } from "../commands/editor-command"
import {
  EditorCommandIconView,
  editorCommandShortcutLabel,
  useEditorCommandCopy,
} from "../commands/editor-command-presentation"

export function ToolbarCommandPicker({
  commands,
  getLabel,
  getDisabledReason,
  label,
  showLabel,
  icon: Icon = Ellipsis,
  focusId,
  triggerRef,
  onOpenChange,
}: {
  commands: readonly ResolvedEditorCommand[]
  getLabel: (command: ResolvedEditorCommand) => string
  getDisabledReason: (command: ResolvedEditorCommand) => string | null
  label: string
  showLabel?: boolean
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  focusId?: string
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpenChange?: (open: boolean) => void
}) {
  const t = useTranslations("app.shell.commandToolbar")
  const copy = useEditorCommandCopy()
  const [open, setOpen] = useState(false)
  const id = useId()
  const active = commands.some((command) => command.active)
  const changeOpen = (value: boolean) => {
    setOpen(value)
    onOpenChange?.(value)
  }
  const trigger = (
    <ToolbarButton asChild>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          size={showLabel ? "sm" : "icon-sm"}
          variant={active ? "secondary" : "ghost"}
          aria-label={label}
          aria-current={active ? "true" : undefined}
          data-toolbar-menu={focusId}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              changeOpen(true)
            }
          }}
        >
          {showLabel ? (
            <>
              {label}
              <ChevronDown aria-hidden="true" />
            </>
          ) : (
            <Icon aria-hidden="true" />
          )}
        </Button>
      </PopoverTrigger>
    </ToolbarButton>
  )
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      {showLabel ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      <PopoverContent
        align="start"
        aria-label={label}
        className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <Command
          label={t("searchTools")}
          filter={(_value, query, keywords) => {
            const terms = query.toLocaleLowerCase().trim().split(/\s+/)
            const text = keywords?.join(" ").toLocaleLowerCase() ?? ""
            return terms.every((term) => text.includes(term)) ? 1 : 0
          }}
        >
          <CommandInput aria-label={t("searchTools")} placeholder={t("searchTools")} />
          <CommandList className="max-h-[min(24rem,calc(var(--radix-popover-content-available-height)-3rem))]">
            <CommandEmpty>{t("noMatchingTools")}</CommandEmpty>
            {commands.map((command) => {
              const name = getLabel(command)
              const reason = getDisabledReason(command)
              const reasonId = reason ? `${id}-${command.descriptor.id}` : undefined
              const shortcut = command.descriptor.shortcut
                ? editorCommandShortcutLabel(command.descriptor.shortcut)
                : null
              return (
                <CommandItem
                  key={command.descriptor.id}
                  value={command.descriptor.id}
                  keywords={[name, ...copy.keywords(command.descriptor.labelKey)]}
                  aria-label={name}
                  aria-describedby={reasonId}
                  aria-current={command.active ? "true" : undefined}
                  data-command-id={command.descriptor.id}
                  disabled={!command.eligibility.enabled}
                  onSelect={() => {
                    if (!command.eligibility.enabled) return
                    changeOpen(false)
                    void command.invoke()
                  }}
                >
                  <EditorCommandIconView icon={command.descriptor.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block">{name}</span>
                    {reason ? (
                      <span id={reasonId} className="block text-xs text-muted-foreground">
                        {reason}
                      </span>
                    ) : null}
                  </span>
                  {command.active ? <Check aria-hidden="true" /> : null}
                  {shortcut ? (
                    <kbd className="font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>
                  ) : null}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
