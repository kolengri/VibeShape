import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { automationReviews } from "../automation/automation-review-controller"
import { createLocalAutomationConnection } from "../automation/local-automation-connection"
import { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import {
  type DocumentControllerState,
  getProjectActionBlock,
  registerProjectActionGuard,
} from "../document/document-controller"
import { useEditorSessionStoreApi } from "../editor-session/editor-session-provider"
import type { EditorSessionState } from "../editor-session/editor-session-store"
import { LocalAutomationStatus } from "./local-automation-status"
import { RemoteAutomationConsentDialog, RemoteAutomationStatus } from "./remote-automation-status"

export function AutomationStatus({ controller }: { controller: DocumentControllerState }) {
  const connections = useAutomationConnections()
  return (
    <>
      <RemoteAutomationConsentDialog
        connection={connections.remoteConnection}
        current={connections.remote}
      />
      <AutomationStatusControls
        controller={controller}
        blockedReason={getProjectActionBlock()}
        {...connections}
      />
    </>
  )
}

function useCreateAutomationConnections(controller: DocumentControllerState) {
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
        const draftBlock = editorDraftBlock(state)
        if (draftBlock) return draftBlock
        if (connection.getSnapshot().busy || remoteConnection.getSnapshot().busy)
          return "automation-busy"
        return null
      }),
    [connection, remoteConnection, editorStore],
  )
  const stopAll = useCallback(async () => {
    await Promise.all([connection.disable(), remoteConnection.disable()])
  }, [connection, remoteConnection])
  const controls = useMemo(
    () => ({
      connection: { ...connection, disable: stopAll },
      remoteConnection: { ...remoteConnection, disable: stopAll },
    }),
    [connection, remoteConnection, stopAll],
  )
  return { ...controls, current, remote }
}

type AutomationConnections = ReturnType<typeof useCreateAutomationConnections>
const AutomationConnectionsContext = createContext<AutomationConnections | null>(null)

export function AutomationConnectionsProvider({
  controller,
  children,
}: {
  controller: DocumentControllerState
  children: ReactNode
}) {
  const connections = useCreateAutomationConnections(controller)
  return (
    <AutomationConnectionsContext.Provider value={connections}>
      {children}
    </AutomationConnectionsContext.Provider>
  )
}

export function useAutomationConnections() {
  const connections = useContext(AutomationConnectionsContext)
  if (!connections) throw new Error("Automation controls require AutomationConnectionsProvider.")
  return connections
}
function editorDraftBlock(state: EditorSessionState) {
  const sketchDraft = state.sketch.activeSketchTool || state.sketch.draft
  if (state.activePartDesignTool?.kind === "surface-texture" && !sketchDraft)
    return "surface-texture-draft" as const
  if ((state.activePartDesignTool && state.activePartDesignTool.kind !== "measure") || sketchDraft)
    return "editor-draft" as const
  return null
}
function hasRetainedLocalApproval(current: AutomationConnections["current"]) {
  return current.connected || current.recovering
}
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
  const retainedLocal = hasRetainedLocalApproval(current)
  const showLocal = retainedLocal
    ? !remote.connected
    : current.available && !remote.pairingCode && !remote.connecting
  return (
    <>
      {showLocal && controller.status === "ready" ? (
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
          blocked={retainedLocal || blockedReason !== null}
        />
      ) : null}
    </>
  )
}
