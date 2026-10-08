import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

const ports = (() => ({ inspect: vi.fn(), inspectMesh: vi.fn(), apply: vi.fn() }))()
mock.module("../../document/document-controller", () => ({
  inspectGeometrySource: ports.inspect,
  inspectTriangleMeshSource: ports.inspectMesh,
  commitAuthoredTransaction: ports.apply,
}))
const mockDependency1 = await import("react")
mock.module("./import-preview", () => {
  const { useEffect } = mockDependency1
  return {
    ImportPreview: ({ label, onReady }: { label: string; onReady: (ready: boolean) => void }) => {
      useEffect(() => {
        onReady(true)
        return () => onReady(false)
      }, [onReady])
      return <div role="img" aria-label={label} />
    },
  }
})

const { webcrypto } = await import("node:crypto")
const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { documentSnapshotV5Schema } = await import("@vibeshape/domain/document-v5")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { default: messages } = await import("../../i18n/messages/en.json")
const { authoredTreeFixture } = await import("../../test-support/authored-tree-fixture")
const { ImportDialog } = await import("./import-dialog")
const { inspection, meshInspection } = await import("./import-test-fixtures")
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
const report = controller.report
if (!report) throw new Error("The import controller fixture requires a report.")
const source = (name = "Original.step") => {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "application/step" })
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  })
  return file
}
function setup(initial = controller, blocked = false) {
  const View = ({ state }: { state: DocumentControllerState }) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <ImportDialog controller={state} blocked={blocked} />
    </I18nProvider>
  )
  const view = render(<View state={initial} />)
  return {
    ...view,
    update: (state: DocumentControllerState) => view.rerender(<View state={state} />),
  }
}
async function chooseSource(name = "Original.step", selectUnits = true) {
  await userEvent.click(screen.getByRole("button", { name: "Import…" }))
  const dialog = screen.getByRole("dialog", { name: "Import geometry" })
  await userEvent.upload(within(dialog).getByLabelText("Source file"), source(name))
  if (!selectUnits) return dialog
  fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Source unit metadata" }), {
    key: "Enter",
  })
  await userEvent.click(screen.getByRole("option", { name: "Millimeter (mm)" }))
  return dialog
}
async function inspectSource() {
  const dialog = await chooseSource()
  await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
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
  ports.inspectMesh.mockResolvedValue(meshInspection)
  ports.apply.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe("exact source Import workflow", () => {
  it("keeps source import available on V5 authority", async () => {
    const authority = documentSnapshotV5Schema.parse({
      ...fixture.authority,
      schemaVersion: 5,
      surfaceTextures: [],
      assets: [],
      repairIntents: [],
      suspendedParts: [],
    })
    setup({ ...controller, authoredSnapshot: authority })
    await userEvent.click(screen.getByRole("button", { name: "Import…" }))
    expect(screen.getByRole("dialog", { name: "Import geometry" })).toBeDefined()
  })

  it("locks inspection against duplicate activation and discards a late result after Cancel", async () => {
    let finish: ((value: typeof inspection) => void) | undefined
    ports.inspect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    setup()
    const dialog = await chooseSource()
    const inspect = within(dialog).getByRole("button", {
      name: "Inspect source",
    }) as HTMLButtonElement
    await userEvent.dblClick(inspect)
    await waitFor(() => expect(ports.inspect).toHaveBeenCalledTimes(1))
    expect(inspect.disabled).toBe(true)
    expect(within(dialog).getByText(messages.app.import.inspecting)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    finish?.(inspection)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Import…" }))
    expect(screen.queryByRole("img", { name: "Read-only import preview" })).toBeNull()
    expect(
      (screen.getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
  it("requires explicit units, displays truthful unit evidence and cancels without publishing authority", async () => {
    setup()
    await userEvent.click(screen.getByRole("button", { name: "Import…" }))
    const dialog = screen.getByRole("dialog", { name: "Import geometry" })
    await userEvent.upload(within(dialog).getByLabelText("Source file"), source())
    expect(
      (within(dialog).getByRole("button", { name: "Inspect source" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Source unit metadata" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Inch (in)" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Read-only import preview" })).toBeTruthy(),
    )
    expect(screen.getByText(messages.app.import.explicitUnitEvidence)).toBeTruthy()
    expect(ports.inspect).toHaveBeenCalledTimes(1)
    expect(ports.inspect.mock.calls[0]?.[0]).toMatchObject({
      source: {
        format: "step",
        normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4 },
        unitPolicy: "step-system-mm",
      },
      bytes: new Uint8Array([1, 2, 3]),
    })
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("publishes one whole transaction, blocks duplicate activation/dismissal and releases rejected saves for retry", async () => {
    let reject: ((error: Error) => void) | undefined
    ports.apply.mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        }),
    )
    const view = setup()
    const dialog = await inspectSource()
    const apply = within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement
    await userEvent.dblClick(apply)
    expect(ports.apply).toHaveBeenCalledTimes(1)
    expect(apply.disabled).toBe(true)
    expect(
      (within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeTruthy()
    reject?.(new Error("Persistence unavailable"))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(messages.app.import.saveFailed),
    )
    view.update({ ...controller, saveStatus: "save-error" })
    expect(apply.disabled).toBe(false)
    ports.apply.mockResolvedValue({ ok: true })
    await userEvent.click(apply)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    const [revision, transaction] = ports.apply.mock.calls[1] ?? []
    expect(revision).toBe(fixture.snapshot.revision)
    expect(transaction.commands.map(({ kind }: { kind: string }) => kind)).toEqual([
      "org.vibeshape.document.upgrade-v3",
      "org.vibeshape.document.upgrade-v4",
      "org.vibeshape.document.add-source-assets",
      "org.vibeshape.history.insert-feature",
    ])
    expect(transaction.assetBlobs).toHaveLength(1)
  })
  it("rejects stale inspection and requires a fresh revision before Apply", async () => {
    const view = setup()
    const dialog = await inspectSource()
    view.update({
      ...controller,
      report: {
        ...report,
        snapshot: { ...fixture.snapshot, revision: fixture.snapshot.revision + 1 },
      },
    })
    expect(screen.getByRole("alert").textContent).toBe(messages.app.import.staleRevision)
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply import" }))
    expect(ports.apply.mock.calls[0]?.[0]).toBe(fixture.snapshot.revision + 1)
  })
  it("shows inspection failure and permits a clean retry without publishing bytes", async () => {
    ports.inspect.mockRejectedValueOnce(new Error("The source contains an open shell."))
    setup()
    const dialog = await chooseSource()
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("The source contains an open shell."),
    )
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
  })
  it("does not accept a malformed empty native inspection as ready", async () => {
    ports.inspect.mockResolvedValue({ ...inspection, outputs: [] })
    setup()
    const dialog = await chooseSource()
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it.each([{ blocked: true }, { readOnly: true }])(
    "keeps import unavailable during existing project work or read-only authority %j",
    ({ blocked, readOnly }) => {
      setup(
        readOnly ? { ...controller, report: { ...report, mode: "read-only" } } : controller,
        blocked,
      )
      expect((screen.getByRole("button", { name: "Import…" }) as HTMLButtonElement).disabled).toBe(
        true,
      )
    },
  )
})

describe("triangle-mesh Import workflow", () => {
  it("requires STL units and routes inspection to the mesh port without exact-solid claims", async () => {
    setup()
    const dialog = await chooseSource("Original.stl", false)
    expect(
      (within(dialog).getByRole("button", { name: "Inspect source" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(within(dialog).getByText(messages.app.import.stlUnitDescription)).toBeTruthy()
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Source unit metadata" }), {
      key: "Enter",
    })
    await userEvent.click(screen.getByRole("option", { name: "Inch (in)" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() => expect(ports.inspectMesh).toHaveBeenCalledTimes(1))
    expect(ports.inspectMesh.mock.calls[0]?.[0]).toMatchObject({ format: "stl", units: "in" })
    expect(ports.inspect).not.toHaveBeenCalled()
    expect(within(dialog).getByText("1 triangle mesh is ready for import.")).toBeTruthy()
    expect(within(dialog).getByText(messages.app.import.meshRepresentation)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("uses declared 3MF units without exposing an override, preserves warnings and captures node identities", async () => {
    ports.inspectMesh.mockResolvedValue({
      ...meshInspection,
      normalization: { sourceUnit: "inch", scaleToMillimeters: 25.4, normalizedUnit: "millimeter" },
      warnings: [{ code: "degenerate-triangles", count: 2 }],
    })
    setup()
    const dialog = await chooseSource("Original.3mf", false)
    expect(within(dialog).queryByRole("combobox", { name: "Source unit metadata" })).toBeNull()
    expect(within(dialog).getByText(messages.app.import.declaredUnits)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(within(dialog).getByText("2 degenerate triangles were omitted.")).toBeTruthy(),
    )
    expect(ports.inspectMesh.mock.calls[0]?.[0]).not.toHaveProperty("units")
    expect(
      within(dialog).getByText(
        "Declared source units: Inch (in). Coordinates are normalized to millimeters.",
      ),
    ).toBeTruthy()
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Apply import" }))
    expect(ports.apply).toHaveBeenCalledTimes(1)
    const transaction = ports.apply.mock.calls[0]?.[1]
    const feature = transaction.commands.find(
      ({ kind }: { kind: string }) => kind === "org.vibeshape.history.insert-feature",
    ).payload.feature
    expect(feature.type.typeId).toBe("org.vibeshape.feature.part-design.imported-mesh")
    expect(feature.parameters.outputs[0]).toMatchObject({ nodeKey: "build-node-1" })
    expect(feature.parameters.outputs[0]).not.toHaveProperty("signature")
  })
  it("blocks Apply when the mesh inspection claims invalid geometry", async () => {
    const first = meshInspection.outputs[0]
    if (!first) throw new Error("The mesh fixture requires an output.")
    ports.inspectMesh.mockResolvedValue({
      ...meshInspection,
      outputs: [{ ...first, shape: { ...first.shape, valid: false } }],
    })
    setup()
    const dialog = await chooseSource("Original.3mf", false)
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(messages.app.import.inspectFailed),
    )
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(ports.apply).not.toHaveBeenCalled()
  })
  it("resets the inspected capture when source format changes and requires fresh STL unit intent", async () => {
    setup()
    const dialog = await chooseSource("Original.3mf", false)
    await userEvent.click(within(dialog).getByRole("button", { name: "Inspect source" }))
    await waitFor(() =>
      expect(within(dialog).getByText("1 triangle mesh is ready for import.")).toBeTruthy(),
    )
    await userEvent.upload(within(dialog).getByLabelText("Source file"), source("Replacement.stl"))
    expect(
      (within(dialog).getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (within(dialog).getByRole("button", { name: "Inspect source" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(within(dialog).queryByText("1 triangle mesh is ready for import.")).toBeNull()
  })
})
