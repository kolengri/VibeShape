import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { asBuiltUiFixture } from "./assembly-as-built-test-fixture"
import type { AssemblyWorkspaceView } from "./use-assembly-workspace"

const { act, cleanup, fireEvent, render, renderHook, screen, waitFor } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
const ports = { preview: vi.fn() }
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  previewAssemblyChanges: ports.preview,
}))
const { AssemblyPlaybackToolbar, useAssemblyToolbarPlayback } = await import(
  "./assembly-playback-toolbar"
)
const { AssemblyToolbarProvider, AssemblyToolbarSlot, AssemblyToolbarPortal } = await import(
  "./assembly-toolbar-portal"
)
const { assemblyMotionStudySchema } = await import("@vibeshape/domain/assembly-authority")
const { assemblyJointRecordSchema } = await import("@vibeshape/domain/assembly-mates")
const { authoredTestId: id } = await import("../../test-support/authored-tree-fixture")
const { identityAssemblyPose } = await import("./assembly-model")
const { CommandToolbar } = await import("../../shell/command-toolbar")
const { builtInEditorCommandDescriptors } = await import("../../commands/built-in-editor-commands")
const { editorCommandIds } = await import("../../commands/editor-command")
const { AssemblyToolbar } = await import("./assembly-toolbar")

function fixture(): AssemblyWorkspaceView {
  const f = asBuiltUiFixture()
  return {
    assembly: f.assembly,
    documentKey: f.capture.documentKey,
    sources: f.sources,
    task: null,
    setTask: vi.fn(),
    removal: null,
    setRemoval: vi.fn(),
    mutations: {
      pending: false,
      error: null,
      apply: vi.fn(),
      rejectStale: vi.fn(),
      rejectPose: vi.fn(),
    },
    inspection: {
      key: f.capture.documentKey,
      pending: false,
      diagnostic: null,
      inspection: f.inspection,
      inspectPairs: vi.fn(),
    },
    selected: {
      instance: f.assembly.instances[0],
      definition: f.definition,
      activeId: f.assembly.instances[0]?.id ?? null,
    },
    definitionId: null,
    disabled: false,
    selectInstance: vi.fn(),
    selectDefinition: vi.fn(),
    openTask: vi.fn(),
    motion: null,
    studyTask: null,
    openStudy: vi.fn(),
    closeStudy: vi.fn(),
    idle: true,
    panelKey: "assembly",
    motionActive: false,
    taskActionsDisabled: false,
    openMotion: vi.fn(),
    closeMotion: vi.fn(),
    setMotionCoordinate: vi.fn(),
    onRemove: vi.fn(),
    ground: vi.fn(),
    upgrade: vi.fn(),
  }
}
function setup(view = fixture()) {
  render(
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <AssemblyToolbar view={view} />
      </TooltipProvider>
    </I18nProvider>,
  )
  return view
}
async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "More assembly actions" }), { key: "Enter" })
  await screen.findByRole("menu")
}
beforeEach(() => {
  ports.preview.mockReset()
  ports.preview.mockResolvedValue({ ok: true, inspection: { occurrences: [], interference: [] } })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe("Assembly command presentation", () => {
  it("keeps frequent commands as named icon controls and the selected-item actions in a labelled menu", async () => {
    const view = setup()
    const toolbar = screen.getByRole("toolbar", { name: "Assembly actions" })
    expect(toolbar.querySelectorAll("button")).toHaveLength(6)
    const add = screen.getByRole("button", { name: "Add instance" })
    expect(add.textContent).toBe("")
    expect(add.getAttribute("title")).toBeNull()
    await userEvent.click(add)
    expect(view.openTask).toHaveBeenCalledWith("addInstance")
    await openMenu()
    expect(screen.getByRole("group", { name: "Create and connect" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "Actions for Member 1" })).toBeTruthy()
    const rename = screen.getByRole("menuitem", { name: "Edit instance" })
    expect(rename.getAttribute("title")).toBeNull()
    expect(rename.hasAttribute("data-slot")).toBe(true)
    await userEvent.click(rename)
    expect(view.openTask).toHaveBeenLastCalledWith("editInstance", view.selected.instance?.id)
  })
  it("shows the animation entry label and explains why a jointless assembly cannot animate", async () => {
    const view = setup()
    const motion = screen.getByRole("button", { name: "Motion studies" })
    expect(motion.textContent).toContain("Motion studies")
    await userEvent.click(motion)
    expect(screen.getByRole("menuitem", { name: "New study" }).getAttribute("aria-disabled")).toBe(
      "true",
    )
    expect(screen.getByText("Add a movable joint before creating a study.")).toBeTruthy()
    expect(view.openStudy).not.toHaveBeenCalled()
  })

  it("exposes pose-preserving authoring and existing upgrade handlers without applying automatically", async () => {
    const view = setup()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "As-built joint" }))
    expect(view.openTask).toHaveBeenCalledWith("asBuiltJoint")
    expect(view.mutations.apply).not.toHaveBeenCalled()
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Rigid group" }))
    expect(view.openTask).toHaveBeenLastCalledWith("rigidGroup")
    await openMenu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Enable general mates" }))
    expect(view.upgrade).toHaveBeenCalledTimes(1)
    expect(view.onRemove).not.toHaveBeenCalled()
  })
  it("keeps an active assembly draft from being replaced by toolbar actions", async () => {
    const view = setup({ ...fixture(), idle: false, taskActionsDisabled: true })
    for (const name of [
      "Create definition",
      "Add instance",
      "Add joint",
      "Motion studies",
      "More assembly actions",
    ])
      expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Add joint" }))
    expect(view.openTask).not.toHaveBeenCalled()
  })
  it("retains unavailable, inspection and pending guards for every command", async () => {
    const base = fixture()
    const view = {
      ...base,
      disabled: true,
      taskActionsDisabled: true,
      inspection: { ...base.inspection, pending: true },
    }
    setup(view)
    expect(screen.getByRole("button", { name: "Add joint" }).hasAttribute("disabled")).toBe(true)
    await openMenu()
    for (const item of screen.getAllByRole("menuitem"))
      expect(item.getAttribute("aria-disabled")).toBe("true")
    await userEvent.click(screen.getByRole("menuitem", { name: "Rigid group" }))
    expect(view.openTask).not.toHaveBeenCalled()
    expect(view.upgrade).not.toHaveBeenCalled()
    expect(view.onRemove).not.toHaveBeenCalled()
  })
})

function playbackFixture() {
  const view = fixture()
  const joint = assemblyJointRecordSchema.parse({
    schemaVersion: 1,
    id: id(900),
    kind: "revolute",
    parentInstanceId: id(901),
    childInstanceId: id(902),
    parentFrame: identityAssemblyPose,
    childFrame: identityAssemblyPose,
    axis: [0, 0, 1],
    value: 0,
    limits: { min: -1, max: 1 },
  })
  const study = assemblyMotionStudySchema.parse({
    schemaVersion: 1,
    id: id(903),
    name: "Open lid",
    duration: 0.01,
    tracks: [
      {
        id: id(904),
        jointId: joint.id,
        coordinate: "angle",
        keys: [
          { time: 0, value: 0 },
          { time: 0.01, value: 1 },
        ],
      },
    ],
  })
  view.assembly = {
    ...view.assembly,
    joints: [joint],
    motionStudies: [study, { ...study, id: id(905), name: "Second case" }],
  }
  return { view, study }
}
const wrapper = ({ children }: { children: import("react").ReactNode }) => (
  <I18nProvider i18n={i18n} initialLocale="en">
    <TooltipProvider>{children}</TooltipProvider>
  </I18nProvider>
)
describe("Top Assembly playback", () => {
  it("renders the workspace actions into the top toolbar slot", async () => {
    const view = fixture()
    const descriptor = builtInEditorCommandDescriptors.find(
      ({ id }) => id === editorCommandIds.documentUndo,
    )
    if (!descriptor) throw new Error("Expected the Undo toolbar command.")
    render(
      <AssemblyToolbarProvider>
        <header data-testid="top">
          <CommandToolbar
            tools={<AssemblyToolbarSlot />}
            commands={[
              {
                descriptor,
                active: false,
                eligibility: { enabled: true },
                invoke: vi.fn(),
                toolbarVisible: true,
              },
            ]}
          />
        </header>
        <main>
          <AssemblyToolbarPortal>
            <AssemblyToolbar view={view} />
          </AssemblyToolbarPortal>
        </main>
      </AssemblyToolbarProvider>,
      { wrapper },
    )
    expect(
      screen.getByTestId("top").contains(await screen.findByRole("button", { name: "Add joint" })),
    ).toBe(true)
    expect(document.querySelector("main")?.querySelector("button")).toBeNull()
    expect(
      screen
        .getByRole("toolbar", { name: "Assembly actions" })
        .closest("[role=toolbar] [role=toolbar]"),
    ).toBeNull()
    await userEvent.tab()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Create definition" }),
      ),
    )
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add instance" })),
    )
    await userEvent.tab()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" })),
    )
  })
  it("selects and plays a saved case without opening an editor or committing poses", async () => {
    const { view, study } = playbackFixture()
    function Harness() {
      const playback = useAssemblyToolbarPlayback(view, 7)
      return (
        <AssemblyToolbar
          view={view}
          playback={<AssemblyPlaybackToolbar view={view} playback={playback} />}
        />
      )
    }
    render(<Harness />, { wrapper })
    const play = screen.getByRole("button", { name: "Play animation" })
    expect(play.hasAttribute("disabled")).toBe(true)
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Animation case" }),
      study.id,
    )
    await userEvent.click(play)
    await waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(13))
    expect(ports.preview.mock.calls[0]?.[1]).toBe(7)
    expect(view.openStudy).not.toHaveBeenCalled()
    expect(view.openMotion).not.toHaveBeenCalled()
    expect(view.mutations.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Reset preview" }))
  })
  it("retains keyboard focus through Play, Pause, and completed playback", async () => {
    const { view, study } = playbackFixture()
    function Harness() {
      const playback = useAssemblyToolbarPlayback(view, 7)
      return (
        <AssemblyToolbar
          view={view}
          playback={<AssemblyPlaybackToolbar view={view} playback={playback} />}
        />
      )
    }
    let finish!: (result: { ok: true; inspection: { occurrences: []; interference: [] } }) => void
    ports.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    render(<Harness />, { wrapper })
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Animation case" }),
      study.id,
    )
    const play = screen.getByRole("button", { name: "Play animation" })
    act(() => play.focus())
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Pause" })).toBe(play)
    expect(document.activeElement).toBe(play)
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Play animation" })).toBe(play)
    expect(document.activeElement).toBe(play)
    await act(async () => {
      finish({ ok: true, inspection: { occurrences: [], interference: [] } })
    })
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(14))
    await waitFor(() => expect(screen.getByRole("button", { name: "Play animation" })).toBe(play))
    expect(document.activeElement).toBe(play)
  })
  it("cancels late samples when switching cases, revising the document, or starting authoring", async () => {
    const { view, study } = playbackFixture()
    const hook = renderHook(({ current }) => useAssemblyToolbarPlayback(current, 7), {
      initialProps: { current: view },
    })
    act(() => hook.result.current.select(study.id))
    let finish!: (result: { ok: true; inspection: { occurrences: []; interference: [] } }) => void
    ports.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    let running: Promise<void> | undefined
    act(() => {
      running = hook.result.current.motion.play(0, study.duration)
    })
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    act(() => hook.result.current.select(id(905)))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      finish({ ok: true, inspection: { occurrences: [], interference: [] } })
      await running
    })
    expect(hook.result.current.study?.id).toBe(id(905))
    expect(hook.result.current.motion.inspection).toBeNull()
    await act(async () => {
      await hook.result.current.motion.preview(0)
    })
    expect(hook.result.current.motion.inspection).not.toBeNull()
    act(() => hook.rerender({ current: { ...view, taskActionsDisabled: true } }))
    expect(hook.result.current.motion.inspection).toBeNull()
    act(() => hook.rerender({ current: { ...view, documentKey: "other:8" } }))
    expect(hook.result.current.study).toBeNull()
    expect(view.mutations.apply).not.toHaveBeenCalled()
  })
})
