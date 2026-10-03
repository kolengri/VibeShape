// @vitest-environment jsdom
import { webcrypto } from "node:crypto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import { i18n } from "../../i18n"
import { authoredTreeFixture } from "../../test-support/authored-tree-fixture"
import { PlanarImportDialog } from "./import-dialog"
import { planarParserResponseSchema } from "./parser-contract"

const ports = vi.hoisted(() => ({ inspect: vi.fn(), commit: vi.fn() }))
vi.mock("./parser-client", () => ({ inspectPlanarSource: ports.inspect }))
vi.mock("../../document/document-controller", () => ({ commitAuthoredTransaction: ports.commit }))
const fixture = authoredTreeFixture()
const controller = {
  status: "ready",
  saveStatus: "saved",
  authoredSnapshot: fixture.authority,
  report: {
    mode: "read-write",
    snapshot: fixture.snapshot,
    historyItems: fixture.authority.history,
  },
} as unknown as DocumentControllerState
const inspection = planarParserResponseSchema.parse({
  schemaVersion: 0,
  ok: true,
  bounds: { min: [2, 3], max: [22, 13] },
  prepared: {
    schemaVersion: 0,
    format: "svg",
    units: { coordinateUnit: "mm", sourceUnit: "mm", millimetersPerUnit: 1, policy: "selected" },
    paths: [
      {
        sourceOrdinal: 0,
        inspectionId: "test",
        closed: true,
        segments: [
          { type: "line", start: [2, 3], end: [22, 3] },
          { type: "line", start: [22, 3], end: [22, 13] },
          { type: "line", start: [22, 13], end: [2, 13] },
          { type: "line", start: [2, 13], end: [2, 3] },
        ].map((curve, sourceOrdinal) => ({ sourceOrdinal, sourceDirection: 1, curve })),
      },
    ],
  },
})
function setup(initial = controller) {
  const View = ({ state }: { state: DocumentControllerState }) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <PlanarImportDialog controller={state} blocked={false} />
    </I18nProvider>
  )
  const view = render(<View state={initial} />)
  return {
    ...view,
    update: (state: DocumentControllerState) => view.rerender(<View state={state} />),
  }
}
async function choose() {
  await userEvent.click(screen.getByRole("button", { name: "Import sketch…" }))
  const dialog = screen.getByRole("dialog", { name: "Import sketch curves" })
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="10"/></svg>',
  )
  const file = new File([bytes], "outline.svg")
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer })
  await userEvent.upload(within(dialog).getByLabelText("Sketch source file"), file)
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Source length unit" }), {
    key: "Enter",
  })
  await userEvent.click(screen.getByRole("option", { name: "Millimeter (mm)" }))
  return dialog
}
async function inspect() {
  const dialog = await choose()
  await userEvent.click(within(dialog).getByRole("button", { name: "Inspect sketch source" }))
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Apply sketch import" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  )
  return dialog
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal("crypto", webcrypto)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  ports.inspect.mockResolvedValue(inspection)
  ports.commit.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("inspects exact curves, cancels without authority writes, and retains the ordinary preview", async () => {
  setup()
  const dialog = await inspect()
  expect(
    within(dialog)
      .getByRole("img", { name: "Imported sketch curve preview" })
      .querySelectorAll("path"),
  ).toHaveLength(4)
  expect(within(dialog).getByText("1 path · 1 closed · 4 curves")).toBeTruthy()
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  expect(ports.commit).not.toHaveBeenCalled()
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("aborts pending inspection on Cancel and ignores late results after reopening", async () => {
  let resolve: (value: unknown) => void = () => {}
  ports.inspect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  setup()
  let dialog = await choose()
  await userEvent.click(within(dialog).getByRole("button", { name: "Inspect sketch source" }))
  await waitFor(() => expect(ports.inspect).toHaveBeenCalledOnce())
  const signal = ports.inspect.mock.calls[0]?.[1] as AbortSignal
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
  expect(signal.aborted).toBe(true)
  await userEvent.click(screen.getByRole("button", { name: "Import sketch…" }))
  dialog = screen.getByRole("dialog", { name: "Import sketch curves" })
  resolve(inspection)
  await waitFor(() => expect(within(dialog).queryByRole("img")).toBeNull())
  expect(ports.commit).not.toHaveBeenCalled()
})
it("rejects stale inspected context and resets preview after unit changes", async () => {
  const view = setup()
  const dialog = await inspect()
  if (!controller.report) throw new Error("Missing fixture report.")
  view.update({
    ...controller,
    report: {
      ...controller.report,
      snapshot: {
        ...controller.report.snapshot,
        revision: controller.report.snapshot.revision + 1,
      },
    },
  })
  expect(within(dialog).getByRole("alert").textContent).toMatch(/document changed/)
  expect(
    (within(dialog).getByRole("button", { name: "Apply sketch import" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Source length unit" }), {
    key: "Enter",
  })
  await userEvent.click(screen.getByRole("option", { name: "Inch (in)" }))
  expect(within(dialog).queryByRole("img")).toBeNull()
})
it("locks duplicate Apply, preserves inspection on save rejection, and retries one atomic transaction", async () => {
  let resolve: (value: unknown) => void = () => {}
  ports.commit.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  setup()
  const dialog = await inspect()
  const apply = within(dialog).getByRole("button", { name: "Apply sketch import" })
  fireEvent.click(apply)
  fireEvent.click(apply)
  await waitFor(() => expect(ports.commit).toHaveBeenCalledOnce())
  expect(
    (within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
  ).toBe(true)
  resolve({ ok: false, diagnostic: { message: "Quota blocked source publication." } })
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/Quota/))
  expect(within(dialog).getByRole("img")).toBeTruthy()
  await userEvent.click(apply)
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(ports.commit).toHaveBeenCalledTimes(2)
  const transaction = ports.commit.mock.calls[1]?.[1]
  expect(transaction.commands.at(-1).kind).toBe("org.vibeshape.history.insert-sketch")
  expect(transaction.assetBlobs).toHaveLength(1)
})
it("surfaces parser diagnostics without allowing a partial drawing", async () => {
  ports.inspect.mockResolvedValueOnce({
    schemaVersion: 0,
    ok: false,
    diagnostic: { code: "unsupported-geometry", message: "DXF TEXT is unsupported." },
  })
  setup()
  const dialog = await choose()
  await userEvent.click(within(dialog).getByRole("button", { name: "Inspect sketch source" }))
  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toBe("DXF TEXT is unsupported."),
  )
  expect(within(dialog).queryByRole("img")).toBeNull()
  expect(
    (within(dialog).getByRole("button", { name: "Apply sketch import" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect(ports.commit).not.toHaveBeenCalled()
})
