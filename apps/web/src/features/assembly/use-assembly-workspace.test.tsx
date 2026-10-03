// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { act, cleanup, renderHook } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { createAssemblyDefinitionChanges } from "./assembly-model"
import { assemblyUiFixture } from "./assembly-test-fixture"
import { assemblyTaskActions, useAssemblyWorkspace } from "./use-assembly-workspace"

const ports = vi.hoisted(() => ({ commit: vi.fn(), inspect: vi.fn() }))
vi.mock("../../document/document-controller", () => ({
  commitAuthoredTransaction: ports.commit,
  inspectActiveAssembly: ports.inspect,
}))
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
    expect(ports.commit).toHaveBeenCalledOnce()
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
