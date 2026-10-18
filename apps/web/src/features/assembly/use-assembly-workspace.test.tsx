import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ReactNode } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

const ports = (() => ({ commit: vi.fn(), inspect: vi.fn() }))()
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  commitAuthoredTransaction: ports.commit,
  inspectActiveAssembly: ports.inspect,
}))

const { webcrypto } = await import("node:crypto")
const { act, cleanup, renderHook } = await import("@testing-library/react")
const { promoteDocumentSnapshotV4 } = await import("@vibeshape/domain/document-v4")
const { documentSnapshotV4Schema } = await import("@vibeshape/domain/document-v4")
const { assemblyJointRecordSchema } = await import("@vibeshape/domain/assembly-mates")
const { documentSnapshotV5Schema } = await import("@vibeshape/domain/document-v5")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { createAssemblyDefinitionChanges } = await import("./assembly-model")
const { assemblyUiFixture } = await import("./assembly-test-fixture")
const { identityAssemblyPose } = await import("./assembly-model")
const { authoredTestId: id } = await import("../../test-support/authored-tree-fixture")
const { assemblyTaskActions, useAssemblyWorkspace } = await import("./use-assembly-workspace")
const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n} initialLocale="en">
    {children}
  </I18nProvider>
)
function fixture() {
  const f = assemblyUiFixture()
  const controller = {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: f.authority,
    report: { snapshot: f.snapshot, rebuild: { ok: false } },
  } as unknown as DocumentControllerState
  const source = f.sources[0]
  if (!source) throw new Error("The fixture must contain an exact source.")
  const changes = createAssemblyDefinitionChanges(source, "Bracket", "Bracket instance")
  return { controller, changes }
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto)
  ports.commit.mockReset()
  ports.inspect.mockResolvedValue({ ok: true, inspection: { occurrences: [], interference: [] } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe("Assembly Apply publication", () => {
  it("keeps motion exclusive with authored tasks and closes it on a project transition at the same revision", async () => {
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
          assemblyJointRecordSchema.parse({
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
          }),
        ],
      },
    })
    const controller = {
      ...fixture().controller,
      authoredSnapshot,
      report: { ...fixture().controller.report, snapshot: f.snapshot },
    } as DocumentControllerState
    const hook = renderHook(({ controller }) => useAssemblyWorkspace(controller), {
      initialProps: { controller },
      wrapper,
    })
    await act(async () => {
      await Promise.resolve()
    })
    act(() => hook.result.current.openTask("editInstance", f.parent.id))
    act(() => hook.result.current.openMotion(id(503)))
    expect(hook.result.current.motion).toBeNull()
    act(() => hook.result.current.setTask(null))
    act(() => hook.result.current.openMotion(id(503)))
    expect(hook.result.current.motion).toMatchObject({ id: id(503), coordinate: "angle" })
    act(() => hook.result.current.openTask("editInstance", f.parent.id))
    expect(hook.result.current.task).toBeNull()
    await act(async () => {
      hook.rerender({
        controller: {
          ...controller,
          authoredSnapshot: { ...authoredSnapshot, id: id(900) as typeof authoredSnapshot.id },
          report: {
            ...controller.report,
            snapshot: { ...f.snapshot, id: id(900) as typeof f.snapshot.id },
          },
        } as DocumentControllerState,
      })
      await Promise.resolve()
    })
    expect(hook.result.current.motion).toBeNull()
    expect(ports.commit).not.toHaveBeenCalled()
  })
  it("keeps assembly inspection available on V5 authority", async () => {
    const f = fixture()
    const authority = f.controller.authoredSnapshot
    if (!authority || authority.schemaVersion === 1)
      throw new Error("Missing authored assembly fixture.")
    const authoredSnapshot = documentSnapshotV5Schema.parse({
      ...promoteDocumentSnapshotV4(authority),
      schemaVersion: 5,
      repairIntents: [],
      suspendedParts: [],
    })
    const hook = renderHook(() => useAssemblyWorkspace({ ...f.controller, authoredSnapshot }), {
      wrapper,
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(ports.inspect).toHaveBeenCalledWith([])
    expect(hook.result.current.disabled).toBe(false)
  })

  it("publishes one whole upgrade/assembly transaction and releases a rejected save for retry", async () => {
    const f = fixture()
    let reject!: (error: Error) => void
    ports.commit.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const hook = renderHook(() => useAssemblyWorkspace(f.controller), { wrapper })
    act(() => hook.result.current.openTask("createDefinition"))
    let applying!: Promise<boolean>
    act(() => {
      const actions = assemblyTaskActions(hook.result.current)
      applying = actions.onApply(f.changes)
      void actions.onApply(f.changes)
    })
    expect(ports.commit).toHaveBeenCalledTimes(1)
    expect(hook.result.current.disabled).toBe(true)
    expect(
      ports.commit.mock.calls[0]?.[1].commands.map((command: { kind: string }) => command.kind),
    ).toEqual([
      "org.vibeshape.document.upgrade-v3",
      "org.vibeshape.document.upgrade-v4",
      "org.vibeshape.document.assembly-command",
    ])
    await act(async () => {
      reject(new Error("Storage rejected"))
      expect(await applying).toBe(false)
    })
    expect(hook.result.current.task?.kind).toBe("createDefinition")
    expect(hook.result.current.disabled).toBe(false)
    expect(hook.result.current.mutations.error).toContain("could not be saved")
    ports.commit.mockResolvedValueOnce({ ok: true })
    await act(async () => {
      expect(await assemblyTaskActions(hook.result.current).onApply(f.changes)).toBe(true)
    })
    expect(hook.result.current.task).toBeNull()
    expect(ports.commit).toHaveBeenCalledTimes(2)
  })
  it("rejects a reviewed form after a revision change without publishing partial mutations", async () => {
    const f = fixture()
    const hook = renderHook(({ controller }) => useAssemblyWorkspace(controller), {
      initialProps: { controller: f.controller },
      wrapper,
    })
    act(() => hook.result.current.openTask("createDefinition"))
    const authority = f.controller.authoredSnapshot,
      report = f.controller.report
    if (!authority || !report) throw new Error("The fixture requires matching document authority.")
    hook.rerender({
      controller: {
        ...f.controller,
        authoredSnapshot: { ...authority, revision: authority.revision + 1 },
        report: {
          ...report,
          snapshot: { ...report.snapshot, revision: report.snapshot.revision + 1 },
        },
      },
    })
    await act(async () => {
      expect(await assemblyTaskActions(hook.result.current).onApply(f.changes)).toBe(false)
    })
    expect(ports.commit).not.toHaveBeenCalled()
    expect(hook.result.current.task?.kind).toBe("createDefinition")
    expect(hook.result.current.mutations.error).toContain("document changed")
  })
})
