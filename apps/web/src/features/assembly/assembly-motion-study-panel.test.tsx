import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyMotionStudySchema } from "@vibeshape/domain/assembly-authority"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { type ComponentProps, useState } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { asBuiltUiFixture } from "./assembly-as-built-test-fixture"
import { identityAssemblyPose } from "./assembly-model"
import {
  AssemblyMotionStudyPanel,
  type AssemblyMotionStudySession,
} from "./assembly-motion-study-panel"

afterEach(cleanup)
function setup({ playing = false }: { playing?: boolean } = {}) {
  const f = asBuiltUiFixture(2)
  const joint = assemblyJointRecordSchema.parse({
    schemaVersion: 2,
    id: id(800),
    kind: "revolute",
    parentInstanceId: id(510),
    childInstanceId: id(511),
    parentFrame: identityAssemblyPose,
    childFrame: identityAssemblyPose,
    axis: [0, 0, 1],
    value: 0,
    limits: { min: -Math.PI, max: Math.PI },
    driven: true,
  })
  const study = assemblyMotionStudySchema.parse({
    schemaVersion: 1,
    id: id(810),
    name: "Crank",
    duration: 2,
    tracks: [
      {
        id: id(811),
        jointId: joint.id,
        coordinate: "angle",
        keys: [
          { time: 0, value: 0 },
          { time: 2, value: 1 },
        ],
      },
    ],
  })
  const apply = vi.fn().mockResolvedValue(true),
    close = vi.fn(),
    reset = vi.fn(),
    play = vi.fn().mockResolvedValue(undefined),
    updatePlayback = vi.fn()
  const view: ComponentProps<typeof AssemblyMotionStudyPanel>["view"] = {
    assembly: { ...f.assembly, joints: [joint] },
    disabled: false,
    studyTask: { id: study.id, documentKey: "assembly:7", revision: 7 },
    mutations: { apply, error: null },
    closeStudy: close,
  }
  let current = study
  function Harness() {
    const [draft, setDraft] = useState(study)
    const session: AssemblyMotionStudySession = {
      draft,
      existing: true,
      edit: (next) => {
        current = next
        reset()
        setDraft(next)
      },
      motion: {
        key: "study",
        value: null,
        changes: null,
        inspection: null,
        pending: false,
        playing,
        applying: false,
        error: null,
        samples: [],
        reset,
        pause: vi.fn(),
        preview: vi.fn().mockResolvedValue(undefined),
        play,
        apply: vi.fn().mockResolvedValue(true),
        invalid: vi.fn(),
        updatePlayback,
      },
    }
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <AssemblyMotionStudyPanel view={view} session={session} />
      </I18nProvider>
    )
  }
  render(<Harness />)
  return { apply, close, reset, play, updatePlayback, current: () => current }
}
describe("Motion study form submission", () => {
  it("updates live playback controls while keeping authored study fields locked", () => {
    const f = setup({ playing: true })
    fireEvent.click(screen.getByText("Playback settings", { exact: true }))
    const speed = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Playback speed" })
    const loop = screen.getByRole<HTMLInputElement>("checkbox", { name: "Loop" })
    expect(speed.disabled).toBe(false)
    expect(loop.disabled).toBe(false)
    expect(
      screen
        .getByRole<HTMLInputElement>("spinbutton", { name: "Duration (s)" })
        .matches(":disabled"),
    ).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", { name: "Sample count" }).disabled,
    ).toBe(true)
    fireEvent.change(speed, { target: { value: "4" } })
    fireEvent.click(loop)
    expect(f.updatePlayback).toHaveBeenLastCalledWith({
      speed: 4,
      loop: true,
      reverse: false,
      count: 13,
    })
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.reset).not.toHaveBeenCalled()
  })
  it("commits duration retiming and name edits before one revision-checked save", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)", { exact: true }))
    const keyTime = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    if (!keyTime) throw new Error("Expected the second motion key.")
    await userEvent.click(keyTime)
    await userEvent.tab()
    const duration = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Duration (s)" })
    await userEvent.click(duration)
    fireEvent.change(duration, { target: { value: "4" } })
    expect(duration.checkValidity()).toBe(false)
    expect(f.current().duration).toBe(2)
    await userEvent.click(screen.getByRole("textbox", { name: "Study name" }))
    expect(duration.checkValidity()).toBe(true)
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(4)
    const retimed = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    expect(retimed?.value).toBe("4")
    expect(retimed?.checkValidity()).toBe(true)
    fireEvent.change(screen.getByRole("textbox", { name: "Study name" }), {
      target: { value: "Long crank" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(1))
    expect(f.apply.mock.calls[0]).toMatchObject([
      [
        {
          kind: "motion-study.update",
          study: {
            name: "Long crank",
            duration: 4,
            tracks: [{ keys: [{ time: 0 }, { time: 4 }] }],
          },
        },
      ],
      7,
    ])
    expect(f.close).toHaveBeenCalledTimes(1)
  })
  it("synchronizes a touched clean key time after a timeline move", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)", { exact: true }))
    const keyTime = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    if (!keyTime) throw new Error("Expected the second motion key.")
    await userEvent.click(keyTime)
    await userEvent.tab()
    fireEvent.keyDown(screen.getByRole("slider", { name: "Key 2 at 2 s" }), { key: "ArrowLeft" })
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(1.98)
    const moved = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    expect(moved?.value).toBe("1.98")
    expect(moved?.checkValidity()).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(1))
    expect(f.apply.mock.calls[0]?.[0][0].study.tracks[0].keys[1].time).toBe(1.98)
  })
  it("preserves a dirty key buffer through retiming and restores the latest value on Escape", async () => {
    const f = setup()
    await userEvent.click(screen.getByText("Edit keys (2)", { exact: true }))
    const keyTime = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    if (!keyTime) throw new Error("Expected the second motion key.")
    await userEvent.click(keyTime)
    fireEvent.change(keyTime, { target: { value: "" } })
    const duration = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Duration (s)" })
    await userEvent.click(duration)
    fireEvent.change(duration, { target: { value: "4" } })
    await userEvent.click(screen.getByRole("textbox", { name: "Study name" }))
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(4)
    const preserved = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    if (!preserved) throw new Error("Expected the retimed motion key.")
    expect(preserved.value).toBe("")
    expect(preserved.checkValidity()).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    expect(f.apply).not.toHaveBeenCalled()
    await userEvent.click(preserved)
    await userEvent.keyboard("{Escape}")
    const restored = screen.getAllByRole<HTMLInputElement>("spinbutton", { name: "Time (s)" })[1]
    expect(restored?.value).toBe("4")
    expect(restored?.checkValidity()).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(1))
    expect(f.apply.mock.calls[0]?.[0][0].study.tracks[0].keys[1].time).toBe(4)
  })
  it("retains an invalid duration, blocks save and playback, and accepts a corrected retry", async () => {
    const f = setup()
    const duration = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Duration (s)" })
    fireEvent.change(duration, { target: { value: "" } })
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await userEvent.click(screen.getByRole("button", { name: "Play animation" }))
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.play).not.toHaveBeenCalled()
    expect(duration.value).toBe("")
    fireEvent.change(duration, { target: { value: "3" } })
    fireEvent.blur(duration)
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(1))
    expect(f.apply.mock.calls[0]?.[0][0].study.duration).toBe(3)
  })
  it("owns pending save state until settlement and keeps edits after a failed save", async () => {
    const f = setup()
    let finish!: (ok: boolean) => void
    f.apply.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
    )
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Study name" })
    fireEvent.change(name, { target: { value: "Saved later" } })
    await userEvent.click(screen.getByRole("button", { name: "Save study" }))
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(1))
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save study" })
    expect(save.disabled).toBe(true)
    expect(save.getAttribute("aria-busy")).toBe("true")
    const element = save.closest("form")
    if (!element) throw new Error("Expected the study form.")
    fireEvent.submit(element)
    expect(f.apply).toHaveBeenCalledTimes(1)
    await act(async () => finish(false))
    expect(save.disabled).toBe(false)
    expect(name.value).toBe("Saved later")
    expect(f.close).not.toHaveBeenCalled()
    await userEvent.click(save)
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2))
  })
})
