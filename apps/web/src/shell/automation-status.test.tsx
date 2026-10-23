import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { createLocalAutomationConnection } from "../automation/local-automation-connection"
import type { createRemoteAutomationConnection } from "../automation/remote-automation-connection"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"

type LocalSnapshot = ReturnType<ReturnType<typeof createLocalAutomationConnection>["getSnapshot"]>
type RemoteSnapshot = ReturnType<ReturnType<typeof createRemoteAutomationConnection>["getSnapshot"]>
const projectA = "0195b5ac-b250-7a2c-8c33-000000000101"
const projectB = "0195b5ac-b250-7a2c-8c33-000000000102"

function connection<State extends { busy: boolean }>(initial: State) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(patch: Partial<State>) {
      snapshot = { ...snapshot, ...patch }
      for (const listener of listeners) listener()
    },
    isProjectActionPending: vi.fn(() => false),
    validateDocumentScope: vi.fn(),
    start: vi.fn(),
    status: vi.fn(async () => {}),
    dispose: vi.fn(),
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
  }
}

function localConnection(projectBound: boolean) {
  return connection<LocalSnapshot>({
    available: true,
    connected: true,
    recovering: false,
    autoApply: false,
    projectManagement: false,
    projectBound,
    busy: false,
    client: null,
    error: false,
  })
}

function remoteConnection() {
  return connection<RemoteSnapshot>({
    available: true,
    connected: false,
    connecting: false,
    busy: false,
    autoApply: false,
    projectManagement: false,
    client: null,
    pairingCode: null,
    consent: null,
    error: false,
  })
}

const ports = {
  external: localConnection(false),
  nativeA: localConnection(true),
  nativeB: localConnection(true),
  remote: remoteConnection(),
  startNative: vi.fn(),
}
mock.module("../assistant/native-assistant-bridge", () => ({
  getNativeAssistant: () => ({ protocolVersion: 1 }),
}))
mock.module("../automation/local-automation-connection", () => ({
  createLocalAutomationConnection: () => ports.external,
}))
mock.module("../automation/native-project-automation", () => ({
  getNativeProjectAutomationConnection: (projectId: string) =>
    projectId === projectB ? ports.nativeB : ports.nativeA,
  startNativeProjectAutomationConnection: ports.startNative,
}))
mock.module("../automation/remote-automation-connection", () => ({
  createRemoteAutomationConnection: () => ports.remote,
}))

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react")
const { getProjectActiveWorkBlock, getProjectNavigationBlock } = await import(
  "../document/document-controller"
)
const { EditorSessionProvider, useEditorSessionStoreApi } = await import(
  "../editor-session/editor-session-provider"
)
const {
  AutomationConnectionsProvider,
  AutomationEditorScope,
  AutomationStatus,
  useAutomationConnections,
} = await import("./automation-status")

function controller(projectId = projectA): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report: {
      status: "created",
      mode: "read-write",
      snapshot: documentSnapshotSchema.parse({
        schemaVersion: 0,
        id: projectId,
        revision: 1,
        name: "Project",
        features: [],
        sketches: [],
        createdAt: "2026-10-19T00:00:00Z",
        updatedAt: "2026-10-19T00:00:00Z",
      }),
      historyItems: null,
      rebuild: {
        ok: false,
        diagnostic: {
          code: "rebuild-failed",
          message: "Geometry is outside this connection guard test.",
          retryable: true,
          sourceCode: null,
        },
      },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  }
}

function ControlsProbe() {
  const connections = useAutomationConnections()
  const editor = useEditorSessionStoreApi()
  return (
    <>
      <output aria-label="Selected local transport">
        {connections.current.projectBound ? "native" : "external"}
      </output>
      <button type="button" onClick={() => connections.connection.disable()}>
        Stop selected connection
      </button>
      <button type="button" onClick={() => connections.connection.enable()}>
        Enable selected connection
      </button>
      <button
        type="button"
        onClick={() => editor.getState().actions.startPartDesignTool({ kind: "create-box" })}
      >
        Start editor draft
      </button>
    </>
  )
}

function Workspace({
  projectId = projectA,
  showStatus = false,
}: {
  projectId?: string
  showStatus?: boolean
}) {
  return (
    <AutomationConnectionsProvider controller={controller(projectId)}>
      <EditorSessionProvider documentId={projectId}>
        <AutomationEditorScope />
        <ControlsProbe />
        {showStatus ? (
          <I18nProvider i18n={i18n} initialLocale="en">
            <AutomationStatus controller={controller(projectId)} />
          </I18nProvider>
        ) : null}
      </EditorSessionProvider>
    </AutomationConnectionsProvider>
  )
}

beforeEach(() => {
  ports.external = localConnection(false)
  ports.nativeA = localConnection(true)
  ports.nativeB = localConnection(true)
  ports.remote = remoteConnection()
  ports.startNative.mockClear()
})
afterEach(cleanup)

describe("all-transport editor activity guard", () => {
  it.each(["connected", "recovering"] as const)(
    "allows explicit external approval while native access is %s and preserves its Stop control",
    (state) => {
      ports.nativeA.publish({
        connected: state === "connected",
        recovering: state === "recovering",
      })
      ports.external.publish({ connected: false, client: { name: "Diagnostics", version: "1" } })
      render(<Workspace showStatus />)
      const enable = screen.getByRole("button", { name: "Enable AI session" }) as HTMLButtonElement
      expect(enable.disabled).toBe(false)
      expect(ports.external.enable).not.toHaveBeenCalled()
      fireEvent.click(enable)
      expect(ports.external.enable).toHaveBeenCalledTimes(1)
      expect(ports.nativeA.enable).not.toHaveBeenCalled()
      expect(screen.getByLabelText("Selected local transport").textContent).toBe("native")
      act(() => ports.external.publish({ connected: true }))
      fireEvent.click(screen.getByRole("button", { name: "Stop AI" }))
      expect(ports.nativeA.disable).toHaveBeenCalledTimes(1)
      expect(ports.external.disable).toHaveBeenCalledTimes(1)
      expect(ports.remote.disable).toHaveBeenCalledTimes(1)
    },
  )

  it("offers the waiting external client after native access fails without granting it native authority", () => {
    ports.nativeA.publish({ connected: false, recovering: false, client: null, error: true })
    ports.external.publish({
      connected: false,
      client: { name: "VibeShape diagnostics", version: "1" },
    })
    render(<Workspace />)
    expect(screen.getByLabelText("Selected local transport").textContent).toBe("external")
    expect(ports.external.enable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Enable selected connection" }))
    expect(ports.external.enable).toHaveBeenCalledTimes(1)
    expect(ports.nativeA.enable).not.toHaveBeenCalled()
    expect(ports.external.getSnapshot()).toMatchObject({
      connected: false,
      autoApply: false,
      projectManagement: false,
      projectBound: false,
    })
    act(() => ports.external.publish({ client: null }))
    expect(screen.getByLabelText("Selected local transport").textContent).toBe("native")
  })

  it.each(["connected", "recovering"] as const)(
    "retains the %s native connection while another client waits for external approval",
    (state) => {
      ports.nativeA.publish({
        connected: state === "connected",
        recovering: state === "recovering",
      })
      ports.external.publish({ connected: false, client: { name: "Other client", version: "1" } })
      render(<Workspace />)
      expect(screen.getByLabelText("Selected local transport").textContent).toBe("native")
      expect(ports.external.enable).not.toHaveBeenCalled()
    },
  )

  it("blocks generic local work while idle native status is displayed and releases the guard on completion", () => {
    const view = render(<Workspace />)
    expect(screen.getByLabelText("Selected local transport").textContent).toBe("native")
    expect(getProjectActiveWorkBlock()).toBeNull()
    act(() => ports.external.publish({ busy: true }))
    expect(getProjectActiveWorkBlock()).toBe("automation-busy")
    expect(screen.getByLabelText("Selected local transport").textContent).toBe("native")
    expect(getProjectNavigationBlock()).toBeNull()
    act(() => ports.external.publish({ busy: false }))
    expect(getProjectActiveWorkBlock()).toBeNull()
    act(() => ports.external.publish({ busy: true }))
    view.unmount()
    expect(getProjectActiveWorkBlock()).toBeNull()
  })

  it.each(["external", "remote"] as const)(
    "allows only the %s connection's own project-management action while every other transport is idle",
    (owner) => {
      const other = owner === "external" ? "remote" : "external"
      ports[owner].publish({ busy: true, projectManagement: true })
      ports[owner].isProjectActionPending.mockReturnValue(true)
      render(<Workspace />)
      expect(getProjectActiveWorkBlock()).toBeNull()
      ports[other].isProjectActionPending.mockReturnValue(true)
      act(() => ports[other].publish({ busy: true, projectManagement: true }))
      expect(getProjectActiveWorkBlock()).toBe("automation-busy")
      act(() => ports[other].publish({ busy: false }))
      expect(getProjectActiveWorkBlock()).toBeNull()
      act(() => ports.nativeA.publish({ busy: true }))
      expect(getProjectActiveWorkBlock()).toBe("automation-busy")
      act(() => ports.nativeA.publish({ busy: false }))
      expect(getProjectActiveWorkBlock()).toBeNull()
      ports[owner].isProjectActionPending.mockReturnValue(false)
      expect(getProjectActiveWorkBlock()).toBe("automation-busy")
    },
  )

  it("validates every local scope after tab selection and retains native background project ownership", async () => {
    ports.nativeA.publish({ busy: true })
    const view = render(<Workspace />)
    expect(getProjectActiveWorkBlock()).toBe("automation-busy")
    view.rerender(<Workspace projectId={projectB} />)
    expect(getProjectActiveWorkBlock()).toBeNull()
    expect(ports.nativeA.getSnapshot().busy).toBe(true)
    expect(ports.external.validateDocumentScope).toHaveBeenCalledTimes(2)
    expect(ports.nativeA.validateDocumentScope).toHaveBeenCalledTimes(1)
    expect(ports.nativeB.validateDocumentScope).toHaveBeenCalledTimes(1)
    expect(ports.remote.validateDocumentScope).toHaveBeenCalledTimes(2)
    act(() => ports.external.publish({ busy: true }))
    expect(getProjectActiveWorkBlock()).toBe("automation-busy")
    fireEvent.click(screen.getByRole("button", { name: "Stop selected connection" }))
    expect(ports.external.disable).toHaveBeenCalledTimes(1)
    expect(ports.nativeB.disable).toHaveBeenCalledTimes(1)
    expect(ports.remote.disable).toHaveBeenCalledTimes(1)
    expect(ports.nativeA.disable).not.toHaveBeenCalled()
  })

  it("retains a live native busy guard and revokes all transports when the displayed status falls back to external", () => {
    ports.nativeA.publish({ available: false, connected: false, busy: true })
    render(<Workspace />)
    expect(screen.getByLabelText("Selected local transport").textContent).toBe("external")
    expect(getProjectActiveWorkBlock()).toBe("automation-busy")
    fireEvent.click(screen.getByRole("button", { name: "Stop selected connection" }))
    expect(ports.nativeA.disable).toHaveBeenCalledTimes(1)
    expect(ports.external.disable).toHaveBeenCalledTimes(1)
    expect(ports.remote.disable).toHaveBeenCalledTimes(1)
  })

  it("keeps the real editor's draft guard ahead of a transport's project-management allowance", () => {
    ports.external.publish({ busy: true, projectManagement: true })
    ports.external.isProjectActionPending.mockReturnValue(true)
    render(<Workspace />)
    expect(getProjectActiveWorkBlock()).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Start editor draft" }))
    expect(getProjectActiveWorkBlock()).toBe("editor-draft")
  })
})
