import { Button } from "@vibeshape/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { useEffect, useRef, useState } from "react"
import type { UiExtensionsCopy } from "./ui-extensions-copy"
import { mountUiPluginPanel, type UiPanelStatus } from "./ui-panel-host"
import type { UiPluginPackage } from "./ui-plugin-package"
import { downloadSampleUiPlugin } from "./ui-plugin-sample"
import type { InstalledUiPlugin } from "./ui-plugin-store"
import { useUiPluginManager } from "./use-ui-plugin-manager"

type PluginStore = ReturnType<typeof useUiPluginManager>["store"]

function UiPluginFrame({
  entry,
  panelId,
  copy,
  authorize,
}: {
  entry: InstalledUiPlugin
  panelId: string
  copy: UiExtensionsCopy
  authorize: PluginStore["authorized"]
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<UiPanelStatus>("loading")
  useEffect(() => {
    if (!iframe.current) return
    const connection = mountUiPluginPanel({
      iframe: iframe.current,
      plugin: entry.package,
      panelId,
      copy: { compute: copy.compute, invalidInputs: copy.invalidInputs, results: copy.results },
      authorize,
      onStatus: setStatus,
    })
    return connection.dispose
  }, [entry.package, panelId, copy.compute, copy.invalidInputs, copy.results, authorize])
  const panel = entry.package.manifest.panels.find(({ id }) => id === panelId)
  return (
    <>
      {status === "loading" && <p role="status">{copy.panelLoading}</p>}
      {status === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {copy.panelFailed}
        </p>
      )}
      <iframe
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        ref={iframe}
        title={panel?.title ?? entry.package.manifest.name}
        className="min-h-80 w-full rounded-md border bg-background"
        hidden={status === "failed"}
      />
    </>
  )
}

function UiPluginReview({
  candidate,
  copy,
  pending,
  onInstall,
  onCancel,
}: {
  candidate: UiPluginPackage
  copy: UiExtensionsCopy
  pending: boolean
  onInstall: () => Promise<void>
  onCancel: () => void
}) {
  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label={copy.reviewTitle}>
      <h3 className="font-medium">{copy.reviewTitle}</h3>
      <p className="text-sm">{copy.reviewDescription}</p>
      <p>
        {candidate.manifest.name}{" "}
        <span className="text-muted-foreground">{copy.version(candidate.manifest.version)}</span>
      </p>
      <p className="text-sm text-muted-foreground">{candidate.manifest.description}</p>
      <code className="break-all text-xs">
        {candidate.manifest.id}
        <br />
        SHA-256: {candidate.integrity}
      </code>
      <h4 className="text-sm font-medium">{copy.permissions}</h4>
      <ul className="list-disc pl-5 text-sm">
        <li>{copy.capabilityCommand}</li>
        <li>{copy.capabilityPanel}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={onInstall}>
          {copy.installAndEnable}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </section>
  )
}

function UiPluginEntry({
  entry,
  copy,
  pending,
  onEnable,
  onRemove,
  onInvoke,
}: {
  entry: InstalledUiPlugin
  copy: UiExtensionsCopy
  pending: boolean
  onEnable: () => Promise<void>
  onRemove: () => Promise<void>
  onInvoke: (panelId: string) => void
}) {
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{entry.package.manifest.name}</h3>
        <span className="text-xs text-muted-foreground">
          {copy.version(entry.package.manifest.version)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{entry.package.manifest.description}</p>
      <p className="text-xs">{entry.enabled ? copy.enabled : copy.disabled}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={onEnable}>
          {entry.enabled ? copy.disable : copy.enable}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={onRemove}>
          {copy.remove}
        </Button>
        {entry.package.manifest.commands.map((command) => (
          <Button
            key={command.id}
            size="sm"
            disabled={pending || !entry.enabled}
            onClick={() => onInvoke(command.panelId)}
          >
            {command.label}
          </Button>
        ))}
      </div>
    </li>
  )
}

function UiPluginStoreStatus({
  state,
  copy,
}: {
  state: ReturnType<typeof useUiPluginManager>
  copy: UiExtensionsCopy
}) {
  const { snapshot, pending, reset, error } = state
  return (
    <>
      {snapshot.status === "loading" && <p role="status">{copy.loading}</p>}
      {snapshot.error && (
        <section className="grid gap-2">
          <p role="alert" className="text-sm text-destructive">
            {copy.errors[snapshot.error]}
          </p>
          <p className="text-sm">{copy.resetStoreDescription}</p>
          <Button variant="outline" disabled={pending} onClick={reset}>
            {copy.resetStore}
          </Button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {copy.errors[error]}
        </p>
      )}
      {snapshot.status === "ready" && snapshot.plugins.length === 0 && (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      )}
    </>
  )
}

function UiExtensionsManager({ copy }: { copy: UiExtensionsCopy }) {
  const state = useUiPluginManager()
  const {
    store,
    snapshot,
    candidate,
    setCandidate,
    pending,
    target,
    setTarget,
    active,
    install,
    selectedFile,
    invoke,
    changeEntry,
  } = state
  return (
    <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
      <div className="grid gap-2">
        <label className="grid gap-1 text-sm">
          <span>{copy.installFile}</span>
          <input
            type="file"
            accept=".vsui.json,application/json"
            aria-label={copy.fileLabel}
            disabled={pending || snapshot.status !== "ready"}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (file) void selectedFile(file)
            }}
          />
        </label>
        <Button variant="outline" size="sm" className="w-fit" onClick={downloadSampleUiPlugin}>
          {copy.sampleDownload}
        </Button>
      </div>
      <UiPluginStoreStatus state={state} copy={copy} />
      {candidate && (
        <UiPluginReview
          candidate={candidate}
          copy={copy}
          pending={pending}
          onInstall={install}
          onCancel={() => setCandidate(null)}
        />
      )}
      <ul className="grid gap-3">
        {snapshot.plugins.map((entry) => (
          <UiPluginEntry
            key={entry.package.integrity}
            entry={entry}
            copy={copy}
            pending={pending}
            onEnable={() => changeEntry(entry, false)}
            onRemove={() => changeEntry(entry, true)}
            onInvoke={(panelId) => invoke(entry, panelId)}
          />
        ))}
      </ul>
      {active && target && (
        <section className="grid gap-2 rounded-md border p-3" aria-label={copy.openPanel}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setTarget(null)}>
              {copy.closePanel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTarget({ ...target, generation: target.generation + 1 })}
            >
              {copy.reloadPanel}
            </Button>
          </div>
          <UiPluginFrame
            key={`${target.integrity}.${target.panelId}.${target.generation}`}
            entry={active}
            panelId={target.panelId}
            copy={copy}
            authorize={store.authorized}
          />
        </section>
      )}
    </div>
  )
}

export function UiExtensionsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  copy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: ((event: Event) => void) | undefined
  copy: UiExtensionsCopy
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        closeLabel={copy.close}
        className="flex max-w-3xl flex-col overflow-hidden p-4"
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {open && <UiExtensionsManager copy={copy} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{copy.close}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
