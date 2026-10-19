import type { AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useId, useRef, useState } from "react"
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
  const descriptionId = useId()
  return (
    <div className="min-w-0 max-w-40 [&_[data-slot=field-label]]:sr-only">
      <SelectField
        label={label}
        value={value ?? ""}
        disabled={busy}
        {...(description ? { "aria-describedby": descriptionId } : {})}
        onValueChange={onChange}
      >
        {options.map((option) => (
          <SelectOption key={option.id} value={option.id}>
            {option.name}
          </SelectOption>
        ))}
      </SelectField>
      {description && (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      )}
    </div>
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
  const changing = useRef(false)
  useReportActivity(pending)
  const change = async (action: () => Promise<void>) => {
    if (changing.current) return
    changing.current = true
    setPending(true)
    try {
      await action()
    } finally {
      changing.current = false
      setPending(false)
    }
  }
  const locked = busy || pending || snapshot.status !== "ready"
  const configs = snapshot.configOptions
  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending || undefined}>
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
    </div>
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
