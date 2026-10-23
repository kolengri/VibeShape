import type { AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@vibeshape/ui/components/dropdown-menu"
import { ChevronDown } from "@vibeshape/ui/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vibeshape/ui/components/tooltip"
import { useId, useRef, useState } from "react"
import { useReportApplicationError } from "../shell/application-notices"
import type { createNativeChatController } from "./native-chat-controller"

type Session = Pick<
  ReturnType<typeof createNativeChatController>,
  "setMode" | "setModel" | "setConfigOption"
>

function SessionSelector({
  label,
  description,
  options,
  value,
  busy,
  onChange,
}: {
  label: string
  description?: string | undefined
  options: readonly { id: string; name: string }[]
  value: string | null
  busy: boolean
  onChange: (value: string) => Promise<void>
}) {
  const t = useTranslations("app.assistant")
  const labelId = useId()
  const descriptionId = useId()
  const selected = options.find((option) => option.id === value)?.name ?? value ?? "—"
  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="max-w-full min-w-0 rounded-md text-muted-foreground [&_svg:not([role=img])]:size-3"
                aria-label={label}
                aria-description={selected}
                aria-describedby={description ? descriptionId : undefined}
                disabled={busy}
              >
                <span className="max-w-36 truncate">{selected}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("sessionControlValue", { label, value: selected })}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
      <DropdownMenuContent
        side="top"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-sm overflow-y-auto"
      >
        <p id={labelId} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <DropdownMenuRadioGroup
          value={value ?? ""}
          aria-labelledby={labelId}
          onValueChange={onChange}
        >
          {description && (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">{description}</p>
          )}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SessionChoices({
  chat,
  snapshot,
  busy,
}: {
  chat: Session
  snapshot: AssistantSnapshot
  busy: boolean
}) {
  const t = useTranslations("app.assistant")
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const failure = failed ? t("errors.request-failed") : null
  const centralized = useReportApplicationError(failure)
  const changing = useRef(false)
  useReportActivity(pending)
  const change = async (action: () => Promise<void>) => {
    if (changing.current) return
    changing.current = true
    setPending(true)
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    } finally {
      changing.current = false
      setPending(false)
    }
  }
  const locked = busy || pending || snapshot.status !== "ready"
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" aria-busy={pending || undefined}>
      {failure && !centralized && <Alert>{failure}</Alert>}
      <SessionFields chat={chat} snapshot={snapshot} locked={locked} change={change} />
    </div>
  )
}

function SessionFields({
  chat,
  snapshot,
  locked,
  change,
}: {
  chat: Session
  snapshot: AssistantSnapshot
  locked: boolean
  change: (action: () => Promise<void>) => Promise<void>
}) {
  const t = useTranslations("app.assistant")
  const configs = snapshot.configOptions
  return (
    <>
      {snapshot.modes.length > 0 && !configs.some((config) => config.category === "mode") && (
        <SessionSelector
          label={t("mode")}
          options={snapshot.modes}
          value={snapshot.currentModeId}
          busy={locked}
          onChange={(value) => change(() => chat.setMode(value))}
        />
      )}
      {configs.map((config) => (
        <SessionSelector
          key={config.id}
          label={config.name}
          description={config.description}
          options={config.options}
          value={config.currentValue}
          busy={locked || config.options.length === 0}
          onChange={(value) => change(() => chat.setConfigOption(config.id, value))}
        />
      ))}
      {snapshot.models.length > 0 && !configs.some((config) => config.category === "model") && (
        <SessionSelector
          label={t("model")}
          options={snapshot.models}
          value={snapshot.currentModelId}
          busy={locked}
          onChange={(value) => change(() => chat.setModel(value))}
        />
      )}
    </>
  )
}

export function NativeSessionControls({
  chat,
  snapshot,
  busy,
}: {
  chat: Session
  snapshot: AssistantSnapshot | null
  busy: boolean
}) {
  // The connection error is presented once by the assistant's operational feedback.
  if (snapshot?.status === "error") return null
  return (
    <>
      {snapshot && (
        <SessionChoices key={snapshot.sessionToken} chat={chat} snapshot={snapshot} busy={busy} />
      )}
    </>
  )
}
