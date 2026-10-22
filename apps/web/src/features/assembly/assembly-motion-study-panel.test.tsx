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
function setup() {
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
    play = vi.fn().mockResolvedValue(undefined)
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
        playing: false,
        applying: false,
        error: null,
        samples: [],
        reset,
        pause: vi.fn(),
        preview: vi.fn().mockResolvedValue(undefined),
        play,
        apply: vi.fn().mockResolvedValue(true),
        invalid: vi.fn(),
      },
    }
    return (
      <I18nProvider i18n={i18n} initialLocale="en">
        <AssemblyMotionStudyPanel view={view} session={session} />
      </I18nProvider>
    )
  }
  render(<Harness />)
  return { apply, close, reset, play, current: () => current }
}
describe("Motion study form submission", () => {
  it("commits duration retiming and name edits before one revision-checked save", async () => {
    const f = setup()
    const duration = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Duration (s)" })
    await userEvent.click(duration)
    fireEvent.change(duration, { target: { value: "4" } })
    expect(duration.checkValidity()).toBe(false)
    expect(f.current().duration).toBe(2)
    await userEvent.click(screen.getByRole("textbox", { name: "Study name" }))
    expect(duration.checkValidity()).toBe(true)
    expect(f.current().tracks[0]?.keys[1]?.time).toBe(4)
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
