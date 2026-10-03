import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { useEffect, useState, useSyncExternalStore } from "react"
import { automationReviews } from "../automation/automation-review-controller"
import { createLocalAutomationConnection } from "../automation/local-automation-connection"
import { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import {
  type DocumentControllerState,
  getProjectActionBlock,
  getProjectActiveWorkBlock,
  registerProjectActionGuard,
} from "../document/document-controller"
import { DocumentRenameDialog } from "../document/document-rename-dialog"
import { useEditorSessionStoreApi } from "../editor-session/editor-session-provider"
import { ApplicationMenu } from "./application-menu"
import { LocalAutomationStatus } from "./local-automation-status"
import { RemoteAutomationConsentDialog, RemoteAutomationStatus } from "./remote-automation-status"

function saveStatusMessage(
  controller: DocumentControllerState,
  messages: {
    loading: string
    saved: string
    saving: string
    "save-error": string
  },
) {
  const loadingStatuses = new Set<DocumentControllerState["status"]>(["idle", "loading"])
  const messageKey = loadingStatuses.has(controller.status) ? "loading" : controller.saveStatus
  return messages[messageKey]
}

export function ApplicationBar({
  controller,
  onOpenCommandPalette,
  onOpenShortcutHelp,
}: {
  controller: DocumentControllerState
  onOpenCommandPalette: (returnFocusTarget: HTMLElement) => void
  onOpenShortcutHelp: (returnFocusTarget: HTMLElement) => void
}) {
  const t = useTranslations("app.shell.applicationBar")
  const { connection, remoteConnection, current, remote } = useAutomationConnections(controller)
  const blockedReason = getProjectActionBlock()
  const unitChangesBlocked =
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    getProjectActiveWorkBlock() !== null
  const documentName = controller.report?.snapshot.name ?? t("untitledProject")
  const saveStatus = saveStatusMessage(controller, {
    loading: t("loading"),
    saved: t("savedInBrowser"),
    saving: t("saving"),
    "save-error": t("saveFailed"),
  })

  return (
    <header className="flex min-w-0 items-center gap-1 border-b bg-toolbar px-2 sm:gap-3">
      <RemoteAutomationConsentDialog connection={remoteConnection} current={remote} />
      <ApplicationMenu
        controller={controller}
        blockedReason={blockedReason}
        unitChangesBlocked={unitChangesBlocked}
        remoteEndpoint={remote.available ? import.meta.env.VITE_REMOTE_MCP_URL : undefined}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenShortcutHelp={onOpenShortcutHelp}
        automationControls={
          controller.status === "ready" && (current.available || remote.available) ? (
            <AutomationStatusControls
              controller={controller}
              blockedReason={blockedReason}
              connection={connection}
              remoteConnection={remoteConnection}
              current={current}
              remote={remote}
            />
          ) : null
        }
      />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="min-w-0 truncate text-muted-foreground" title={documentName}>
          {documentName}
        </span>
        <DocumentRenameDialog controller={controller} />
      </div>
      {current.connected || remote.connected ? (
        <>
          <span role="status" className="shrink-0 text-xs font-medium text-primary">
            {current.autoApply || remote.autoApply ? t("autoApplyOn") : t("aiConnectedShort")}
          </span>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            title={t("stopAiDescription")}
            onClick={async () => {
              await Promise.all([connection.disable(), remoteConnection.disable()])
            }}
          >
            {t("stopAi")}
          </Button>
        </>
      ) : null}
      <span
        className="sr-only sm:not-sr-only sm:ml-auto sm:min-w-0 sm:truncate sm:text-xs sm:text-muted-foreground"
        role="status"
      >
        {saveStatus}
      </span>
    </header>
  )
}

function useAutomationConnections(controller: DocumentControllerState) {
  const editorStore = useEditorSessionStoreApi()
  useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState)
  const [connection] = useState(createLocalAutomationConnection)
  const [remoteConnection] = useState(() =>
    createRemoteAutomationConnection(import.meta.env.VITE_REMOTE_MCP_URL),
  )
  const remote = useSyncExternalStore(
    remoteConnection.subscribe,
    remoteConnection.getSnapshot,
    remoteConnection.getSnapshot,
  )
  const current = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    connection.getSnapshot,
  )
  useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getSnapshot,
    automationReviews.getSnapshot,
  )
  useEffect(() => {
    connection.start()
    void connection.status()
    return connection.dispose
  }, [connection])
  useEffect(() => {
    remoteConnection.start()
    return remoteConnection.dispose
  }, [remoteConnection])
  useEffect(
    () => () => {
      void remoteConnection.disable()
    },
    [remoteConnection, controller.report?.snapshot.id],
  )
  useEffect(() => {
    if (controller.status !== "ready") void remoteConnection.disable()
  }, [remoteConnection, controller.status])
  useEffect(
    () =>
      registerProjectActionGuard(() => {
        const state = editorStore.getState()
        if (
          (state.activePartDesignTool && state.activePartDesignTool.kind !== "measure") ||
          state.sketch.activeSketchTool ||
          state.sketch.draft
        )
          return "editor-draft"
        if (connection.getSnapshot().busy || remoteConnection.getSnapshot().busy)
          return "automation-busy"
        return null
      }),
    [connection, remoteConnection, editorStore],
  )
  return { connection, remoteConnection, current, remote }
}

type AutomationConnections = ReturnType<typeof useAutomationConnections>
function AutomationStatusControls({
  controller,
  blockedReason,
  connection,
  remoteConnection,
  current,
  remote,
}: AutomationConnections & {
  controller: DocumentControllerState
  blockedReason: ReturnType<typeof getProjectActionBlock>
}) {
  return (
    <>
      {current.available &&
      controller.status === "ready" &&
      !remote.pairingCode &&
      !remote.connecting ? (
        <LocalAutomationStatus
          key={`${controller.report?.snapshot.id}:${current.connected}`}
          connection={connection}
          current={current}
        />
      ) : null}
      {remote.available && controller.status === "ready" ? (
        <RemoteAutomationStatus
          connection={remoteConnection}
          current={remote}
          blocked={current.connected || blockedReason !== null}
        />
      ) : null}
    </>
  )
}
