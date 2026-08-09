import { Button } from "@vibeshape/ui/components/button"
import type { ReactNode } from "react"

export type SlicerBridgeConnectionPanelCopy = Readonly<{
  connected: string
  disconnected: string
  disconnect: string
}>

export function SlicerBridgeConnectionPanel({
  connected,
  copy,
  onDisconnect,
  saveAction,
  status,
  tokenField,
}: {
  connected: boolean
  copy: SlicerBridgeConnectionPanelCopy
  onDisconnect: () => unknown
  saveAction: ReactNode
  status?: ReactNode
  tokenField: ReactNode
}) {
  return (
    <section className="grid gap-3 rounded-md border bg-panel-muted p-3">
      <p className="text-xs text-muted-foreground" role="status">
        {connected ? copy.connected : copy.disconnected}
      </p>
      {tokenField}
      {status}
      <div className="flex flex-wrap justify-end gap-2">
        {connected ? (
          <Button type="button" size="sm" variant="outline" onClick={onDisconnect}>
            {copy.disconnect}
          </Button>
        ) : null}
        {saveAction}
      </div>
    </section>
  )
}
