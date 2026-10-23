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
import { getNativeAssistant } from "../assistant/native-assistant-bridge"
import { automationReviews } from "../automation/automation-review-controller"
import { createLocalAutomationConnection } from "../automation/local-automation-connection"
import {
  getNativeProjectAutomationConnection,
  startNativeProjectAutomationConnection,
} from "../automation/native-project-automation"
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
  const editorStore = useEditorSessionStoreApi()
  useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState)
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

function useNativeAutomationConnection(
  controller: DocumentControllerState,
  externalConnection: ReturnType<typeof createLocalAutomationConnection>,
  external: ReturnType<ReturnType<typeof createLocalAutomationConnection>["getSnapshot"]>,
) {
  const projectId = getNativeAssistant() ? controller.report?.snapshot.id : undefined
  const nativeConnection = useMemo(
    () => (projectId ? getNativeProjectAutomationConnection(projectId) : null),
    [projectId],
  )
  const candidate = nativeConnection ?? externalConnection
  const native = useSyncExternalStore(
    candidate.subscribe,
    candidate.getSnapshot,
    candidate.getSnapshot,
  )
  useEffect(() => {
    if (projectId) startNativeProjectAutomationConnection(projectId)
  }, [projectId])
  const available =
    native.connected || native.recovering || (native.available && external.client === null)
  return nativeConnection && available
    ? { connection: nativeConnection, current: native, nativeConnection }
    : { connection: externalConnection, current: external, nativeConnection }
}

function useCreateAutomationConnections(controller: DocumentControllerState) {
  const [externalConnection] = useState(() => createLocalAutomationConnection())
  const [remoteConnection] = useState(() =>
    createRemoteAutomationConnection(import.meta.env.VITE_REMOTE_MCP_URL),
  )
  const remote = useSyncExternalStore(
    remoteConnection.subscribe,
    remoteConnection.getSnapshot,
    remoteConnection.getSnapshot,
  )
  const external = useSyncExternalStore(
    externalConnection.subscribe,
    externalConnection.getSnapshot,
    externalConnection.getSnapshot,
  )
  const { connection, current, nativeConnection } = useNativeAutomationConnection(
    controller,
    externalConnection,
    external,
  )
  const localConnections = useMemo(
    () => (nativeConnection ? [externalConnection, nativeConnection] : [externalConnection]),
    [externalConnection, nativeConnection],
  )
  useSyncExternalStore(
    automationReviews.subscribe,
    automationReviews.getSnapshot,
    automationReviews.getSnapshot,
  )
  useEffect(() => {
    externalConnection.start()
    void externalConnection.status()
    return externalConnection.dispose
  }, [externalConnection])
  useEffect(() => {
    remoteConnection.start()
    return remoteConnection.dispose
  }, [remoteConnection])
  useEffect(() => {
    for (const local of localConnections) local.validateDocumentScope()
    remoteConnection.validateDocumentScope()
  }, [localConnections, remoteConnection, controller.status, controller.report?.snapshot.id])
  const stopAll = useCallback(async () => {
    await Promise.all([
      ...localConnections.map((local) => local.disable()),
      remoteConnection.disable(),
    ])
  }, [localConnections, remoteConnection])
  const controls = useMemo(
    () => ({
      connection: { ...connection, disable: stopAll },
      remoteConnection: { ...remoteConnection, disable: stopAll },
    }),
    [connection, remoteConnection, stopAll],
  )
  return { ...controls, current, remote, localConnections, externalConnection, external }
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
export function AutomationEditorScope() {
  const { localConnections, remoteConnection } = useAutomationConnections()
  const editorStore = useEditorSessionStoreApi()
  useEffect(
    () =>
      registerProjectActionGuard(() => {
        const draftBlock = editorDraftBlock(editorStore.getState())
        if (draftBlock) return draftBlock
        const busy = [...localConnections, remoteConnection].filter(
          (connection) => connection.getSnapshot().busy,
        )
        if (busy.length > 1 || busy.some((connection) => !connection.isProjectActionPending()))
          return "automation-busy"
        return null
      }),
    [localConnections, remoteConnection, editorStore],
  )
  return null
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

function ExternalAutomationStatus({
  connection,
  current,
  externalConnection,
  external,
}: Pick<AutomationConnections, "connection" | "current" | "externalConnection" | "external">) {
  if (
    !current.projectBound ||
    !hasRetainedLocalApproval(current) ||
    !external.available ||
    !external.client
  )
    return null
  return (
    <LocalAutomationStatus
      connection={{ ...externalConnection, disable: connection.disable }}
      current={external}
      showStopControl={false}
    />
  )
}

function AutomationStatusControls({
  controller,
  blockedReason,
  connection,
  remoteConnection,
  current,
  remote,
  externalConnection,
  external,
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
        <>
          <LocalAutomationStatus
            key={`${controller.report?.snapshot.id}:${current.connected}`}
            connection={connection}
            current={current}
          />
          <ExternalAutomationStatus
            connection={connection}
            current={current}
            externalConnection={externalConnection}
            external={external}
          />
        </>
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
