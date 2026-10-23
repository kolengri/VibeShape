import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useLayoutEffect, useMemo, useState } from "react"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { DocumentDisplayUnitsProvider } from "../../document/document-display-units"
import { i18n } from "../../i18n"
import { authoredTestId as id } from "../../test-support/authored-tree-fixture"
import { identityAssemblyPose } from "./assembly-model"
import { type AssemblyMotionCoordinate, assemblyMotionCoordinates } from "./assembly-motion"
import { AssemblyMotionPanel } from "./assembly-motion-panel"

const ports = { preview: vi.fn(), apply: vi.fn(), close: vi.fn() }
const controllerModule = { ...(await import("../../document/document-controller")) }
mock.module("../../document/document-controller", () => ({
  ...controllerModule,
  previewAssemblyChanges: ports.preview,
}))
const { useAssemblyMotion } = await import("./use-assembly-motion")
const joint = assemblyJointRecordSchema.parse({
  schemaVersion: 2,
  id: id(10),
  kind: "cylindrical",
  parentInstanceId: id(11),
  childInstanceId: id(12),
  parentFrame: identityAssemblyPose,
  childFrame: identityAssemblyPose,
  axis: [0, 0, 1],
  angle: 0.2,
  angleLimits: { min: -1, max: 1 },
  rotationDriven: false,
  translation: 6.35,
  translationLimits: { min: -100, max: 100 },
  translationDriven: false,
})
function Harness({ resetOnPreview = false }: { resetOnPreview?: boolean }) {
  const [kind, setKind] = useState<AssemblyMotionCoordinate["kind"]>("translation")
  const coordinate = useMemo(
    () => assemblyMotionCoordinates(joint).find((item) => item.kind === kind),
    [kind],
  )
  if (!coordinate) throw new Error("The cylindrical fixture requires this coordinate.")
  const motion = useAssemblyMotion({
    key: kind,
    joint,
    coordinate,
    revision: 7,
    disabled: false,
    onApply: ports.apply,
  })
  useLayoutEffect(() => {
    if (resetOnPreview && motion.value !== null)
      (screen.getByRole("button", { name: "Reset preview" }) as HTMLButtonElement).click()
  }, [resetOnPreview, motion.value])
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <DocumentDisplayUnitsProvider displayUnits={{ length: "in", angle: "rad" }}>
        <AssemblyMotionPanel
          key={kind}
          joint={joint}
          coordinate={coordinate}
          motion={motion}
          disabled={false}
          error={null}
          onCoordinate={setKind}
          onClose={ports.close}
        />
      </DocumentDisplayUnitsProvider>
    </I18nProvider>
  )
}
beforeEach(() => {
  ports.preview.mockReset()
  ports.apply.mockReset()
  ports.close.mockReset()
  ports.preview.mockResolvedValue({ ok: true, inspection: { occurrences: [], interference: [] } })
  ports.apply.mockResolvedValue(true)
})
afterEach(cleanup)
describe("Assembly motion controls", () => {
  it("changes speed and looping during playback without solving the cached poses again", async () => {
    vi.useFakeTimers({ now: 0 })
    try {
      render(<Harness />)
      fireEvent.change(screen.getByRole("spinbutton", { name: "Sample count" }), {
        target: { value: "2" },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Play animation" }))
      })
      const speed = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Playback speed" })
      const loop = screen.getByRole<HTMLInputElement>("checkbox", { name: "Loop" })
      expect(speed.disabled).toBe(false)
      expect(loop.disabled).toBe(false)
      expect(
        screen.getByRole<HTMLInputElement>("spinbutton", { name: "Sample count" }).disabled,
      ).toBe(true)
      expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Reverse" }).disabled).toBe(
        true,
      )
      fireEvent.change(speed, { target: { value: "2" } })
      fireEvent.click(loop)
      await act(async () => vi.advanceTimersByTimeAsync(200))
      expect(ports.preview).toHaveBeenCalledTimes(2)
      expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy()
      fireEvent.click(loop)
      await act(async () => vi.advanceTimersByTimeAsync(99))
      expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy()
      await act(async () => vi.advanceTimersByTimeAsync(1))
      expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
      expect(ports.preview).toHaveBeenCalledTimes(2)
      expect(ports.apply).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it("keeps Reset authoritative when a solved preview commits before passive effects", async () => {
    render(<Harness resetOnPreview />)
    const value = screen.getByRole("spinbutton", { name: "Coordinate (in)" }) as HTMLInputElement
    fireEvent.change(value, { target: { value: "1" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    })
    expect(ports.preview).toHaveBeenCalledTimes(1)
    expect(value.value).toBe("0.25")
    expect(screen.queryByText("Preview: 1 in")).toBeNull()
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("retains the visible coordinate through a pending sweep, pause and range edits without replacing manual raw input", async () => {
    render(<Harness />)
    const value = screen.getByRole("spinbutton", { name: "Coordinate (in)" }) as HTMLInputElement
    fireEvent.change(value, { target: { value: "0.75" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sweep start (in)" }), {
      target: { value: "-0.5" },
    })
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sweep end (in)" }), {
      target: { value: "0.5" },
    })
    expect(value.value).toBe("0.75")
    let solve!: () => void
    ports.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        solve = () => resolve({ ok: true, inspection: { occurrences: [], interference: [] } })
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }))
    expect(value.value).toBe("0.75")
    await screen.findByText("Solving motion preview…")
    await act(async () => solve())
    expect(value.value).toBe("-0.5")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    })
    expect(value.value).toBe("-0.5")
    fireEvent.change(screen.getByRole("spinbutton", { name: "Sweep end (in)" }), {
      target: { value: "1" },
    })
    expect(value.value).toBe("-0.5")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    })
    expect(ports.preview.mock.calls.at(-1)?.[0]).toMatchObject([
      { kind: "joint.update", joint: { translation: -12.7 } },
    ])
    fireEvent.change(value, { target: { value: "0.750" } })
    expect(value.value).toBe("0.750")
    expect(screen.queryByText("Preview: -0.5 in")).toBeNull()
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("rejects an out-of-range sweep before solving and plays a corrected range", async () => {
    render(<Harness />)
    const start = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Sweep start (in)" })
    await userEvent.click(start)
    fireEvent.change(start, { target: { value: "4" } })
    await userEvent.click(screen.getByRole("button", { name: "Play animation" }))
    expect(start.value).toBe("4")
    expect(start.getAttribute("aria-invalid")).toBe("true")
    const error = screen.getByRole("alert")
    expect(error.textContent).toBe(
      "Check the names, finite coordinates, rotation angles, nonzero axis and ordered drive limits.",
    )
    expect(start.getAttribute("aria-describedby")).toBe(error.id)
    expect(ports.preview).not.toHaveBeenCalled()
    expect(ports.apply).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply" }).disabled).toBe(true)
    fireEvent.change(start, { target: { value: "-0.5" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play animation" }))
    })
    await screen.findByText("Preview: -0.5 in")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(ports.preview.mock.calls[0]?.[0]).toMatchObject([
      { kind: "joint.update", joint: { translation: -12.7 } },
    ])
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("makes Pause an independent enabled action while a sweep is running", async () => {
    render(<Harness />)
    const play = screen.getByRole("button", { name: "Play animation" })
    fireEvent.click(play)
    const pause = await screen.findByRole("button", { name: "Pause" })
    expect(pause).not.toBe(play)
    expect((pause as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(pause)
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
  })

  it("uses project units, preserves passive cylinder rotation, resets and applies only the solved coordinate", async () => {
    render(<Harness />)
    const value = screen.getByRole("spinbutton", { name: "Coordinate (in)" })
    expect((value as HTMLInputElement).value).toBe("0.25")
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(value, { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    await waitFor(() => expect(screen.getByText("Preview: 1 in")).toBeTruthy())
    expect(ports.apply).not.toHaveBeenCalled()
    expect(ports.preview.mock.calls[0]?.[0]).toMatchObject([
      {
        kind: "joint.update",
        joint: { angle: 0.2, rotationDriven: false, translation: 25.4, translationDriven: true },
      },
    ])
    fireEvent.click(screen.getByRole("button", { name: "Reset preview" }))
    expect((value as HTMLInputElement).value).toBe("0.25")
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Rotation" }))
    const angle = screen.getByRole("spinbutton", { name: "Coordinate (rad)" })
    fireEvent.change(angle, { target: { value: "0.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    await waitFor(() => expect(screen.getByText("Preview: 0.5 rad")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(ports.apply).toHaveBeenCalledTimes(1))
    expect(ports.apply.mock.calls[0]?.[0]).toMatchObject([
      {
        kind: "joint.update",
        joint: { angle: 0.5, rotationDriven: true, translation: 6.35, translationDriven: false },
      },
    ])
  })
  it("cancels a pending worker with Escape and surfaces a solver failure without enabling Apply", async () => {
    render(<Harness />)
    let finish!: () => void
    ports.preview.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, inspection: { occurrences: [], interference: [] } })
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    await waitFor(() => expect(ports.preview).toHaveBeenCalledTimes(1))
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Coordinate (in)" }), {
      key: "Escape",
    })
    expect(signal.aborted).toBe(true)
    expect(ports.close).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish()
    })
    ports.preview.mockResolvedValueOnce({
      ok: false,
      diagnostic: { message: "The closed loop has conflicting mates." },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    })
    expect(screen.getByRole("alert").textContent).toContain(
      "Reset the preview and try a smaller sample set.",
    )
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
})
