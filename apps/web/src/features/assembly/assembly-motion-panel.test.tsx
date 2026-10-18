import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { assemblyJointRecordSchema } from "@vibeshape/domain/assembly-mates"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { useMemo, useState } from "react"
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
function Harness() {
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
    ports.preview.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    const signal = ports.preview.mock.calls[0]?.[3] as AbortSignal
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Coordinate (in)" }), {
      key: "Escape",
    })
    expect(signal.aborted).toBe(true)
    expect(ports.close).toHaveBeenCalledTimes(1)
    ports.preview.mockResolvedValueOnce({
      ok: false,
      diagnostic: { message: "The closed loop has conflicting mates." },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview coordinate" }))
    })
    expect(screen.getByRole("alert").textContent).toContain(
      "The closed loop has conflicting mates.",
    )
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
})
