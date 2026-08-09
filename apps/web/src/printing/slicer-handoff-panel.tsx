import { useTranslations } from "@vibeshape/i18n"
import type { SlicerBridgeDiagnosticCode, SlicerId } from "@vibeshape/slicer-handoff/protocol"
import { slicerIdSchema } from "@vibeshape/slicer-handoff/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { NativeSelectField } from "@vibeshape/ui/components/native-select-field"
import { useState } from "react"
import type { ActiveDocumentExportResult } from "../document/document-controller"
import { createDocumentExportFilename, downloadDocumentExport } from "../document/document-export"
import { SlicerBridgeConnectionForm } from "./slicer-bridge-connection-form"
import {
  handoffThreeMfToSlicer,
  readPreferredSlicer,
  readSlicerBridgeToken,
  removeSlicerBridgeToken,
  savePreferredSlicer,
  saveSlicerBridgeToken,
  slicerTargets,
} from "./slicer-handoff"

type HandoffStatus = Readonly<{ message: string; failed: boolean }>
type Translation = ReturnType<typeof useTranslations>

const reasonFallbackKeys = {
  "not-configured": "fallback.notConfigured",
  unavailable: "fallback.unavailable",
  "invalid-response": "fallback.invalidResponse",
} as const

const diagnosticFallbackKeys: Partial<Record<SlicerBridgeDiagnosticCode, string>> = {
  "slicer-not-installed": "fallback.notInstalled",
  unauthorized: "fallback.unauthorized",
}

function fallbackStatus(
  result: Exclude<Awaited<ReturnType<typeof handoffThreeMfToSlicer>>, { ok: true }>,
  slicerName: string,
  t: Translation,
): HandoffStatus {
  const key =
    result.reason === "rejected"
      ? (diagnosticFallbackKeys[result.diagnostic.code] ?? "fallback.rejected")
      : reasonFallbackKeys[result.reason]
  return { message: t(key, { slicer: slicerName }), failed: true }
}

function HandoffStatusMessage({ status }: { status: HandoffStatus | null }) {
  if (!status) return null
  return (
    <p
      className={status.failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
      role={status.failed ? "alert" : "status"}
      aria-live="polite"
    >
      {status.message}
    </p>
  )
}

function SlicerBridgeSetup({
  bridgeToken,
  onStatusReset,
  onTokenChange,
  t,
}: {
  bridgeToken: string | null
  onStatusReset: () => void
  onTokenChange: (token: string | null) => void
  t: Translation
}) {
  return (
    <details className="group rounded-md border bg-background p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("bridge.summary")}</summary>
      <div className="mt-3 grid gap-3">
        <p className="text-xs text-muted-foreground">{t("bridge.description")}</p>
        <SlicerBridgeConnectionForm
          connected={bridgeToken !== null}
          copy={{
            connected: t("bridge.connected"),
            disconnected: t("bridge.disconnected"),
            disconnect: t("bridge.disconnect"),
            disconnectFailed: t("bridge.disconnectFailed"),
            formLabel: t("bridge.formLabel"),
            tokenLabel: t("bridge.tokenLabel"),
            tokenDescription: t("bridge.tokenDescription"),
            invalidToken: t("bridge.invalidToken"),
            save: t("bridge.save"),
            saved: t("bridge.saved"),
            saveFailed: t("bridge.saveFailed"),
          }}
          onDisconnect={() => {
            const removed = removeSlicerBridgeToken()
            if (removed) onTokenChange(null)
            onStatusReset()
            return removed
          }}
          onSave={(token) => {
            const saved = saveSlicerBridgeToken(token)
            if (saved) onTokenChange(token)
            onStatusReset()
            return saved
          }}
        />
      </div>
    </details>
  )
}

export function SlicerHandoffPanel({
  disabled,
  onBusyChange,
  onOpened,
  prepareThreeMf,
}: {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onOpened: (message: string) => void
  prepareThreeMf: () => Promise<ActiveDocumentExportResult>
}) {
  const t = useTranslations("app.export.slicer")
  const [slicerId, setSlicerId] = useState<SlicerId>(readPreferredSlicer)
  const [bridgeToken, setBridgeToken] = useState(readSlicerBridgeToken)
  const [status, setStatus] = useState<HandoffStatus | null>(null)
  const slicerName = slicerTargets.find(({ id }) => id === slicerId)?.name ?? slicerId

  const openInSlicer = async () => {
    onBusyChange(true)
    setStatus({ message: t("preparing", { slicer: slicerName }), failed: false })
    try {
      const exported = await prepareThreeMf()
      if (!exported.ok || exported.format !== "3mf") {
        setStatus({ message: t("exportFailed"), failed: true })
        return
      }
      const handoff = await handoffThreeMfToSlicer({
        file: exported.file,
        filename: createDocumentExportFilename(exported.documentName, "3mf"),
        slicerId,
        token: bridgeToken,
      })
      if (handoff.ok) {
        onOpened(t("opened", { slicer: slicerName }))
        return
      }
      downloadDocumentExport(exported)
      setStatus(fallbackStatus(handoff, slicerName, t))
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <section className="grid gap-4 rounded-md border border-primary/30 bg-card p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <NativeSelectField
          label={t("targetLabel")}
          description={t("targetDescription")}
          value={slicerId}
          disabled={disabled}
          onChange={(event) => {
            const next = slicerIdSchema.safeParse(event.currentTarget.value)
            if (!next.success) return
            setSlicerId(next.data)
            savePreferredSlicer(next.data)
            setStatus(null)
          }}
        >
          {slicerTargets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </NativeSelectField>
        <Button
          type="button"
          className="sm:mt-[1.375rem]"
          disabled={disabled}
          onClick={openInSlicer}
        >
          {t("action", { slicer: slicerName })}
        </Button>
      </div>
      <HandoffStatusMessage status={status} />
      <SlicerBridgeSetup
        bridgeToken={bridgeToken}
        onStatusReset={() => setStatus(null)}
        onTokenChange={setBridgeToken}
        t={t}
      />
    </section>
  )
}
