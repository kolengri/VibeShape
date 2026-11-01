import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { emptyAssemblyAuthority } from "@vibeshape/domain/assembly-authority"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { vi } from "../../../../../tests/unit/support/bun-test"
import { i18n } from "../../i18n"
import type {
  MotionClearanceInput,
  MotionClearanceProgress,
  MotionClearanceResult,
} from "./assembly-motion-clearance"

const id = (n: number) => `01950000-0000-7000-8000-${String(n).padStart(12, "0")}`
const operation =
  vi.fn<
    (
      input: MotionClearanceInput,
      signal?: AbortSignal,
      progress?: (value: MotionClearanceProgress) => void,
    ) => Promise<MotionClearanceResult>
  >()
const reset = vi.fn(),
  show = vi.fn()
mock.module("./motion-clearance-operation", () => ({
  captureMotionClearance: () => ({
    documentId: id(1),
    revision: 7,
    assembly: emptyAssemblyAuthority(),
    defaultMinimumGap: 0.35,
  }),
  inspectMotionClearance: operation,
}))
const { useMotionClearance } = await import("./use-motion-clearance")
const { AssemblyMotionClearancePanel } = await import("./assembly-motion-clearance-panel")
function result(): MotionClearanceResult {
  const pair = {
    leftInstanceId: id(2),
    rightInstanceId: id(3),
    distance: 0,
    volume: 2,
    solidCount: 1,
    violatesMinimumGap: true,
  }
  return {
    status: "complete",
    scope: {
      documentId: id(1),
      revision: 7,
      actor: { type: "user", userId: null },
      sourceDigest: "a".repeat(64),
    },
    jointId: id(4),
    coordinate: "translation",
    start: -2,
    end: 2,
    requestedSamples: 3,
    minimumGap: 0.35,
    resolution: 2,
    samples: [{ value: 0, poseDigest: "b".repeat(64), pairs: [pair] }],
    smallest: { value: 0, ...pair },
  }
}
function Harness({ scope = "project:7" }: { scope?: string }) {
  const clearance = useMotionClearance(scope)
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <AssemblyMotionClearancePanel
        input={{
          jointId: id(4),
          coordinate: { kind: "translation", min: -10, max: 10, value: 0, driven: true },
          range: () => ({ start: -2, end: 2 }),
          display: String,
          unit: "mm",
          names: { [id(2)]: "Base", [id(3)]: "Arm" },
        }}
        clearance={clearance}
        disabled={false}
        onStart={reset}
        onShow={show}
      />
    </I18nProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  operation.mockResolvedValue(result())
})
afterEach(cleanup)
describe("clearance task controls", () => {
  it("shows project tolerance, captured sampled evidence and matching preview actions", async () => {
    render(<Harness />)
    expect(
      (screen.getByRole("spinbutton", { name: "Minimum gap (mm)" }) as HTMLInputElement).value,
    ).toBe("0.35")
    fireEvent.change(screen.getByRole("spinbutton", { name: "Clearance sample count" }), {
      target: { value: "3" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Check clearance" }))
    await screen.findByText(/Smallest sampled gap: 0 mm at 0 mm; Base \/ Arm/)
    expect(operation.mock.calls[0]?.[0]).toMatchObject({
      documentId: id(1),
      revision: 7,
      actor: { type: "user", userId: null },
      start: -2,
      end: 2,
      minimumGap: 0.35,
      sampleCount: 3,
    })
    expect(screen.getByText(/positive-volume interference 2 mm³/)).toBeTruthy()
    expect(screen.getByText(/no continuous minimum or collision-free claim/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show smallest sampled gap" }))
    expect(show).toHaveBeenCalledWith(0, "b".repeat(64))
    fireEvent.click(screen.getByRole("button", { name: "Show sampled position 0 mm" }))
    expect(show).toHaveBeenCalledTimes(2)
    expect(reset).toHaveBeenCalledTimes(1)
  })
  it("announces exact phase progress, locks duplicate work, cancels and presents incomplete state", async () => {
    operation.mockImplementation(async (_input, signal, progress) => {
      progress?.({ phase: "solving-and-measuring", completed: 1, total: 3 })
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      )
      return { ...result(), status: "incomplete", reason: "cancelled" }
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Check clearance" }))
    await screen.findByText(/Solving and measuring exact solids: 1 of 3/)
    expect(screen.getByRole("button", { name: "Check clearance" }).getAttribute("aria-busy")).toBe(
      "true",
    )
    expect(
      (screen.getByRole("button", { name: "Check clearance" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Cancel clearance check" }))
    await screen.findByRole("alert")
    expect(screen.getByRole("alert").textContent).toContain("The check was cancelled")
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Check clearance" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })
  it("revokes pending work and suppresses late evidence on project/revision replacement", async () => {
    let complete!: (value: MotionClearanceResult) => void
    operation.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const view = render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Check clearance" }))
    await screen.findByText(/Preparing exact clearance inspection/)
    const signal = operation.mock.calls[0]?.[1]
    view.rerender(<Harness scope="another-project:7" />)
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      complete(result())
    })
    expect(screen.queryByText(/Smallest sampled gap/)).toBeNull()
  })
})
