import type { AssistantSnapshot } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { useState } from "react"
import type { createNativeChatController } from "./native-chat-controller"

type Session = Pick<ReturnType<typeof createNativeChatController>, "setMode" | "setModel">

function SessionSelector({
  kind,
  options,
  value,
  busy,
  onChange,
}: {
  kind: "mode" | "model"
  options: readonly { id: string; name: string }[]
  value: string | null
  busy: boolean
  onChange: (value: string) => Promise<void>
}) {
  const t = useTranslations("app.assistant")
  const [pending, setPending] = useState(false)
  useReportActivity(pending)
  const select = async (next: string) => {
    setPending(true)
    try {
      await onChange(next)
    } finally {
      setPending(false)
    }
  }
  return (
    <div aria-busy={pending || undefined}>
      <SelectField
        label={t(kind)}
        value={value ?? ""}
        disabled={busy || pending}
        onValueChange={select}
      >
        {options.map((option) => (
          <SelectOption key={option.id} value={option.id}>
            {option.name}
          </SelectOption>
        ))}
      </SelectField>
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
  return (
    <div className="grid grid-cols-2 gap-2">
      {snapshot.modes.length > 0 && (
        <SessionSelector
          kind="mode"
          options={snapshot.modes}
          value={snapshot.currentModeId}
          busy={busy}
          onChange={chat.setMode}
        />
      )}
      {snapshot.models.length > 0 && (
        <SessionSelector
          kind="model"
          options={snapshot.models}
          value={snapshot.currentModelId}
          busy={busy}
          onChange={chat.setModel}
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
  const t = useTranslations("app.assistant")
  return (
    <>
      <p className="text-xs text-muted-foreground" role="status">
        {t(`status.${snapshot?.status ?? "disconnected"}`)}
      </p>
      {snapshot && <SessionChoices chat={chat} snapshot={snapshot} busy={busy} />}
    </>
  )
}
