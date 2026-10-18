import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { webcrypto } from "node:crypto"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { documentSnapshotV4Schema, promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ReactNode } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"

const ports = { preview: vi.fn(), inspect: vi.fn(), commit: vi.fn() }
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  previewAssemblyChanges: ports.preview,
  inspectActiveAssembly: ports.inspect,
  commitAuthoredTransaction: ports.commit,
}))
const { useAssemblyWorkspace } = await import("./use-assembly-workspace")
const { useAssemblyMotionSession } = await import("./assembly-motion-session")
const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n} initialLocale="en">
    {children}
  </I18nProvider>
)
function controllerFixture() {
  const f = assemblyUiFixture()
  const authoredSnapshot = documentSnapshotV4Schema.parse({
    ...promoteDocumentSnapshotV4(f.authority),
    assembly: {
      ...f.assembly,
      instances: [
        ...f.assembly.instances,
        {
          schemaVersion: 1,
          id: id(502),
          definitionId: f.definition.id,
          name: "Motion arm",
          grounded: false,
        },
      ],
      joints: [
        {
          schemaVersion: 1,
          id: id(503),
          kind: "revolute",
          parentInstanceId: f.parent.id,
          childInstanceId: id(502),
          parentFrame: identityAssemblyPose,
          childFrame: identityAssemblyPose,
          axis: [0, 0, 1],
          value: 0,
          limits: { min: -1, max: 1 },
        },
      ],
    },
  })
  return {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot,
    report: { snapshot: f.snapshot, rebuild: { ok: false } },
  } as unknown as DocumentControllerState
}
function useSession(controller: DocumentControllerState) {
  const view = useAssemblyWorkspace(controller)
  return { view, motion: useAssemblyMotionSession(view) }
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto)
  ports.preview.mockReset()
  ports.inspect.mockReset()
  ports.commit.mockReset()
  const result = { ok: true, inspection: { occurrences: [], interference: [] } }
  ports.preview.mockResolvedValue(result)
  ports.inspect.mockResolvedValue(result)
  ports.commit.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe("Assembly motion transaction binding", () => {
  it("keeps preview disposable, applies exactly one reviewed joint transaction, and closes only after success", async () => {
    const controller = controllerFixture()
    const hook = renderHook(() => useSession(controller), { wrapper })
    await waitFor(() => expect(hook.result.current.view.inspection.pending).toBe(false))
    act(() => hook.result.current.view.openMotion(id(503)))
    expect(hook.result.current.motion.coordinate?.kind).toBe("angle")
    await act(async () => {
      await hook.result.current.motion.state.preview(0.5)
    })
    expect(ports.commit).not.toHaveBeenCalled()
    expect(hook.result.current.motion.state.inspection).not.toBeNull()
    await act(async () => {
      expect(await hook.result.current.motion.state.apply()).toBe(true)
    })
    expect(ports.commit).toHaveBeenCalledTimes(1)
    expect(hook.result.current.view.motion).toBeNull()
    expect(hook.result.current.motion.state.inspection).toBeNull()
    expect(ports.commit.mock.calls[0]?.[1].commands).toHaveLength(1)
    expect(ports.commit.mock.calls[0]?.[1].commands[0]).toMatchObject({
      kind: "org.vibeshape.document.assembly-command",
      payload: { changes: [{ kind: "joint.update", joint: { id: id(503), value: 0.5 } }] },
    })
  })
  it("aborts a late preview and closes its task on a revision change without publishing or saving", async () => {
    const controller = controllerFixture()
    const hook = renderHook(({ value }) => useSession(value), {
      initialProps: { value: controller },
      wrapper,
    })
    await waitFor(() => expect(hook.result.current.view.inspection.pending).toBe(false))
    act(() => hook.result.current.view.openMotion(id(503)))
    let finish!: (value: { ok: true; inspection: { occurrences: []; interference: [] } }) => void
    ports.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    let pending!: Promise<void> | undefined
    act(() => {
      pending = hook.result.current.motion.state.preview(0.5)
    })
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    const authority = controller.authoredSnapshot
    const report = controller.report
    if (!authority || !report) throw new Error("The motion fixture requires a report.")
    await act(async () => {
      hook.rerender({
        value: {
          ...controller,
          authoredSnapshot: { ...authority, revision: authority.revision + 1 },
          report: {
            ...report,
            snapshot: { ...report.snapshot, revision: report.snapshot.revision + 1 },
          },
        },
      })
    })
    await act(async () => {
      finish({ ok: true, inspection: { occurrences: [], interference: [] } })
      await pending
    })
    expect(signal.aborted).toBe(true)
    expect(hook.result.current.view.motion).toBeNull()
    expect(hook.result.current.motion.state.inspection).toBeNull()
    expect(ports.commit).not.toHaveBeenCalled()
  })
})
