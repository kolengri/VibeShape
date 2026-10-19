import "../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { projectAuthoredDocumentSnapshotToV1 } from "@vibeshape/domain/document-v2"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { featureIdSchema, partIdSchema } from "@vibeshape/domain/identifiers"
import {
  patternFeatureType,
  patternInstanceOutputRole,
} from "@vibeshape/domain/part-design-pattern"
import { createLengthQuantity, createScalarQuantity } from "@vibeshape/domain/units"
import {
  historyRepairFixture,
  repairId,
} from "../../../../packages/domain/src/history-repair.test-fixture"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"

const remove = vi.fn()
let activeWork: string | null = null
const original = { ...(await import("../document/document-controller")) }
mock.module("../document/document-controller", () => ({
  ...original,
  removeHistoryItems: remove,
  getProjectActiveWorkBlock: () => activeWork,
}))
const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../i18n")
const { useHistorySelectionDelete } = await import("./history-selection-delete")
type Target = import("./history-selection-delete").HistorySelectionDeleteTarget

const deleted = vi.fn()
function state(authority: AuthoredDocumentSnapshot): DocumentControllerState {
  return {
    status: "ready",
    saveStatus: "saved",
    authoredSnapshot: authority,
    report: { mode: "read-write", snapshot: projectAuthoredDocumentSnapshotToV1(authority) },
  } as unknown as DocumentControllerState
}
function Harness({
  controller,
  targets,
  disabled = false,
}: {
  controller: DocumentControllerState
  targets: readonly Target[]
  disabled?: boolean
}) {
  const deletion = useHistorySelectionDelete({ controller, targets, disabled, onDeleted: deleted })
  return (
    <>
      <div role="tree" aria-label="Selection" onKeyDown={deletion.onKeyDown}>
        <button type="button" role="treeitem">
          Selected row
        </button>
        <input aria-label="Rename" />
        <button type="button">Row action</button>
      </div>
      {deletion.confirmation}
    </>
  )
}
function setup(
  targets: readonly Target[],
  authority: AuthoredDocumentSnapshot = historyRepairFixture(),
  controller = state(authority),
) {
  const content = (next: DocumentControllerState) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <Harness controller={next} targets={targets} />
    </I18nProvider>
  )
  const result = render(content(controller))
  return {
    ...result,
    authority,
    rerenderState: (next: DocumentControllerState) => result.rerender(content(next)),
    row: screen.getByRole("treeitem", { name: "Selected row" }),
  }
}
beforeEach(() => {
  activeWork = null
  remove.mockReset().mockResolvedValue({ ok: true })
  deleted.mockClear()
})
afterEach(cleanup)

describe("History selection keyboard deletion", () => {
  it("confirms mixed authored targets, deduplicates part owners, and retains named dependent impact", async () => {
    const { row, authority } = setup([
      { kind: "part", id: partIdSchema.parse(repairId(100)) },
      { kind: "feature", id: featureIdSchema.parse(repairId(3)) },
      { kind: "sketch", id: authoritySketchId() },
    ])
    row.focus()
    await userEvent.keyboard("{Backspace}")
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Housing")).toBeTruthy()
    expect(
      within(dialog).getByRole("heading", { name: "History features owning the selected parts" }),
    ).toBeTruthy()
    expect(within(dialog).getByText("Fillet 4")).toBeTruthy()
    expect(within(dialog).getByText("Fillet 5")).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete selection" }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(
      authority.revision,
      [
        { kind: "feature", id: repairId(3) },
        { kind: "sketch", id: repairId(1) },
      ],
      authority.id,
    )
    expect(deleted).toHaveBeenCalledTimes(1)
  })

  it("deletes the selected noncontiguous History rows through the scoped selection owner", async () => {
    const { authoredTreeFixture } = await import("../test-support/authored-tree-fixture")
    const { HistoryFolderSelection, HistoryFolderSelectableRow } = await import(
      "./history-folder-selection"
    )
    const { TooltipProvider } = await import("@vibeshape/ui/components/tooltip")
    const { authority, rows } = authoredTreeFixture()
    const first = rows[0]
    const last = rows[2]
    if (!first?.record.label || !last?.record.label)
      throw new Error("Three named History rows are required")
    const firstName = first.record.label
    const lastName = last.record.label
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <HistoryFolderSelection
            controller={state(authority)}
            authority={authority}
            rows={rows}
            disabled={false}
            onCommit={vi.fn().mockResolvedValue({ ok: true })}
          >
            <div role="tree" aria-label="History">
              {rows.map((row) => (
                <HistoryFolderSelectableRow key={row.ref.id} row={row}>
                  <button type="button" role="treeitem">
                    {row.record.label}
                  </button>
                </HistoryFolderSelectableRow>
              ))}
            </div>
          </HistoryFolderSelection>
        </TooltipProvider>
      </I18nProvider>,
    )
    const firstRow = screen.getByRole("treeitem", { name: firstName })
    const lastRow = screen.getByRole("treeitem", { name: lastName })
    fireEvent.click(firstRow, { ctrlKey: true })
    fireEvent.click(lastRow, { metaKey: true })
    lastRow.focus()
    await userEvent.keyboard("{Delete}")
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(firstName)).toBeTruthy()
    expect(within(dialog).getByText(lastName)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete selection" }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(authority.revision, [first.ref, last.ref], authority.id)
  })

  it("blocks a subset of multi-output siblings and permits all sibling parts", async () => {
    const multi = multiOutputFixture()
    const first = multi.parts.find((part) => part.name === "Copy 1")
    const sibling = multi.parts.find((part) => part.name === "Copy 2")
    if (!first || !sibling) throw new Error("Pattern parts unavailable")
    const authority = multi
    const firstView = setup([{ kind: "part", id: first.id }], multi)
    firstView.row.focus()
    await userEvent.keyboard("{Delete}")
    expect(screen.getByRole("alert").textContent).toContain("Copy 2")
    expect(
      (screen.getByRole("button", { name: "Delete selection" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Keep selection" }))
    cleanup()
    const all = setup(
      [
        { kind: "part", id: first.id },
        { kind: "part", id: sibling.id },
      ],
      multi,
    )
    all.row.focus()
    await userEvent.keyboard("{Delete}")
    expect(screen.queryByRole("alert")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Delete selection" }))
    expect(remove).toHaveBeenCalledWith(
      authority.revision,
      [{ kind: "feature", id: repairId(7) }],
      authority.id,
    )
  })

  it("ignores editing, modified, repeated, composing, unfocused, modal, and active-task key presses", async () => {
    const { row } = setup([{ kind: "feature", id: featureIdSchema.parse(repairId(6)) }])
    row.focus()
    for (const option of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
    ]) {
      fireEvent.keyDown(row, { key: "Delete", ...option })
    }
    const input = screen.getByRole("textbox", { name: "Rename" })
    input.focus()
    fireEvent.keyDown(input, { key: "Backspace" })
    row.setAttribute("contenteditable", "true")
    row.focus()
    fireEvent.keyDown(row, { key: "Delete" })
    row.removeAttribute("contenteditable")
    const action = screen.getByRole("button", { name: "Row action" })
    action.focus()
    fireEvent.keyDown(action, { key: "Delete" })
    fireEvent.keyDown(row, { key: "Delete" })
    row.focus()
    activeWork = "editor-draft"
    fireEvent.keyDown(row, { key: "Delete" })
    activeWork = null
    const modal = document.createElement("div")
    modal.setAttribute("role", "dialog")
    document.body.append(modal)
    fireEvent.keyDown(row, { key: "Delete" })
    modal.remove()
    expect(screen.queryByRole("alertdialog") === null).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  })

  it("keeps deletion revision-bound and single-flight while displaying a failed transaction", async () => {
    let reject!: (reason: Error) => void
    remove.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const { row, authority, rerenderState } = setup([
      { kind: "feature", id: featureIdSchema.parse(repairId(6)) },
    ])
    row.focus()
    await userEvent.keyboard("{Delete}")
    const confirm = screen.getByRole("button", { name: "Delete selection" })
    await userEvent.dblClick(confirm)
    expect(remove).toHaveBeenCalledTimes(1)
    reject(new Error("Storage failed"))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("could not be deleted"),
    )
    expect(deleted).not.toHaveBeenCalled()
    expect(confirm.getAttribute("aria-busy")).not.toBe("true")
    rerenderState(state({ ...authority, revision: authority.revision + 1 }))
    expect(
      screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("document changed")),
    ).toBe(true)
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Keep selection" }))
    expect(document.activeElement).toBe(row)
  })
})

function authoritySketchId() {
  const sketch = historyRepairFixture().sketches[0]
  if (!sketch) throw new Error("Sketch fixture unavailable")
  return sketch.id
}

function multiOutputFixture() {
  const base = historyRepairFixture()
  const envelope = {
    commandId: repairId(300),
    documentId: base.id,
    baseRevision: base.revision,
    issuedAt: "2026-10-19T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const result = applyDocumentV2Command(base, {
    ...envelope,
    schemaVersion: 2,
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: {
        ...envelope,
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: {
          historyAfter: base.history.at(-1),
          feature: {
            schemaVersion: 0,
            id: repairId(7),
            label: "Pattern",
            type: patternFeatureType.type,
            dependencies: [repairId(6)],
            references: [],
            suppressed: false,
            parameters: {
              kind: "linear",
              targetBody: { schemaVersion: 0, featureId: repairId(6), outputRole: "result" },
              count: createScalarQuantity(3),
              axis: "X",
              spacing: createLengthQuantity(5),
            },
          },
        },
      },
      partAllocations: [1, 2].map((index) => ({
        id: repairId(101 + index),
        name: `Copy ${index}`,
        origin: "independent",
        body: {
          schemaVersion: 0,
          featureId: repairId(7),
          outputRole: patternInstanceOutputRole(index),
        },
      })),
    },
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.snapshot
}
