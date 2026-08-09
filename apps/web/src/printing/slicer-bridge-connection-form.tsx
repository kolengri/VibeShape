import { slicerBridgeTokenSchema } from "@vibeshape/slicer-handoff/protocol"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useState } from "react"
import {
  SlicerBridgeConnectionPanel,
  type SlicerBridgeConnectionPanelCopy,
} from "./slicer-bridge-connection-panel"

export type SlicerBridgeConnectionFormCopy = SlicerBridgeConnectionPanelCopy &
  Readonly<{
    disconnectFailed: string
    formLabel: string
    tokenLabel: string
    tokenDescription: string
    invalidToken: string
    save: string
    saved: string
    saveFailed: string
  }>

export function SlicerBridgeConnectionForm({
  connected,
  copy,
  onDisconnect,
  onSave,
}: {
  connected: boolean
  copy: SlicerBridgeConnectionFormCopy
  onDisconnect: () => boolean | Promise<boolean>
  onSave: (token: string) => boolean | Promise<boolean>
}) {
  const [status, setStatus] = useState<{ message: string; failed: boolean } | null>(null)
  const form = useAppForm({
    defaultValues: { token: "" },
    onSubmit: async ({ value }) => {
      const parsed = slicerBridgeTokenSchema.safeParse(value.token.trim())
      if (!parsed.success) return
      const saved = await onSave(parsed.data)
      setStatus({ message: saved ? copy.saved : copy.saveFailed, failed: !saved })
      if (saved) form.reset()
    },
  })

  return (
    <Form form={form} aria-label={copy.formLabel} className="gap-0">
      <SlicerBridgeConnectionPanel
        connected={connected}
        copy={copy}
        onDisconnect={async () => {
          setStatus(null)
          const disconnected = await onDisconnect()
          if (!disconnected) {
            setStatus({ message: copy.disconnectFailed, failed: true })
          }
        }}
        tokenField={
          <form.AppField
            name="token"
            validators={{
              onChange: ({ value }) =>
                slicerBridgeTokenSchema.safeParse(value.trim()).success
                  ? undefined
                  : copy.invalidToken,
            }}
          >
            {(field) => (
              <field.TextField
                type="password"
                autoComplete="off"
                spellCheck={false}
                label={copy.tokenLabel}
                description={copy.tokenDescription}
              />
            )}
          </form.AppField>
        }
        status={
          status ? (
            <p
              className={
                status.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
              role={status.failed ? "alert" : "status"}
            >
              {status.message}
            </p>
          ) : null
        }
        saveAction={<form.SubmitButton size="sm">{copy.save}</form.SubmitButton>}
      />
    </Form>
  )
}
