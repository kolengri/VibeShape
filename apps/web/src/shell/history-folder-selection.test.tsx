import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { AuthoredDocumentSnapshot } from "@vibeshape/domain/document-v2"
import { documentIdSchema, historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import { i18n } from "../i18n"
import { authoredTestId, authoredTreeFixture } from "../test-support/authored-tree-fixture"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import {
  HistoryFolderSelectableRow,
  HistoryFolderSelection,
  HistoryFolderSelectionControls,
} from "./history-folder-selection"

beforeAll(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
)
afterEach(cleanup)

function selectionFixture(authority = authoredTreeFixture().authority) {
  const { rows } = authoredTreeFixture()
  const onCommit = vi.fn<AuthoredMetadataCommit>().mockResolvedValue({ ok: true })
  const onActivate = vi.fn()
  const onInsert = vi.fn<(side: "above" | "below") => Promise<boolean>>().mockResolvedValue(true)
  const content = (snapshot: AuthoredDocumentSnapshot, disabled = false) => (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <HistoryFolderSelection
          authority={snapshot}
          rows={rows}
          disabled={disabled}
          onCommit={onCommit}
        >
          <HistoryFolderSelectionControls />
          {rows.map((row) => (
            <HistoryFolderSelectableRow key={row.ref.id} row={row} onInsert={onInsert}>
              <button type="button" role="treeitem" onClick={() => onActivate(row.ref.id)}>
                {row.record.label}
              </button>
            </HistoryFolderSelectableRow>
          ))}
        </HistoryFolderSelection>
      </TooltipProvider>
    </I18nProvider>
  )
  const view = render(content(authority))
  return { authority, onCommit, onActivate, onInsert, view, content }
}

async function createSelectedFolder(name: string) {
  const dialog = screen.getByRole("dialog", { name: "New folder" })
  expect(within(dialog).queryByRole("combobox")).toBeNull()
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Folder name" }), name)
  await userEvent.click(within(dialog).getByRole("button", { name: "New folder" }))
}

describe("History folder selection", () => {
  it("keeps insertion available without an authored-folder metadata context", async () => {
    const { rows } = authoredTreeFixture()
    const row = rows[0]
    if (!row) throw new Error("The fixture requires a History row.")
    const onInsert = vi.fn<(side: "above" | "below") => Promise<boolean>>().mockResolvedValue(true)
    render(
      <I18nProvider i18n={i18n} initialLocale="en">
        <TooltipProvider>
          <HistoryFolderSelectableRow row={row} onInsert={onInsert}>
            <button type="button" role="treeitem">
              Box 1
            </button>
          </HistoryFolderSelectableRow>
        </TooltipProvider>
      </I18nProvider>,
    )
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 1" }))
    expect(screen.queryByRole("menuitem", { name: "Add selection to folder" })).toBeNull()
    await userEvent.click(screen.getByRole("menuitem", { name: "Insert above" }))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert).toHaveBeenCalledWith("above")
  })
  it("opens the shared row context menu with Shift+F10 and invokes insertion by keyboard", async () => {
    const { onInsert } = selectionFixture()
    screen.getByRole("treeitem", { name: "Box 2" }).focus()
    await userEvent.keyboard("{Shift>}{F10}{/Shift}")
    expect(screen.getByRole("menu")).toBeTruthy()
    await userEvent.keyboard("{Home}{Enter}")
    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledTimes(1)
      expect(onInsert).toHaveBeenCalledWith("above")
    })
  })
  it("shares one context menu for insertion and folders and allows save-first insertion during an edit", async () => {
    const { authority, onInsert, onCommit, view, content } = selectionFixture()
    view.rerender(content(authority, true))
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 2" }))
    expect(screen.getAllByRole("menu")).toHaveLength(1)
    expect(
      screen
        .getByRole("menuitem", { name: "Add selection to folder" })
        .getAttribute("aria-disabled"),
    ).toBe("true")
    await userEvent.click(screen.getByRole("menuitem", { name: "Insert above" }))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert).toHaveBeenCalledWith("above")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("releases insertion pending state after rejection and supports retry", async () => {
    const { onInsert } = selectionFixture()
    onInsert.mockRejectedValueOnce(new Error("Saving failed"))
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 2" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Insert below" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Could not set the insertion point/),
    )
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 2" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Insert below" }))
    expect(onInsert).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("selects by Ctrl/Cmd and Shift without activating edits, then creates the named canonical range", async () => {
    const { authority, onCommit, onActivate } = selectionFixture()
    fireEvent.click(screen.getByRole("treeitem", { name: "Box 1" }), { metaKey: true })
    fireEvent.click(screen.getByRole("treeitem", { name: "Box 3" }), { shiftKey: true })
    expect(onActivate).not.toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toBe("3 History items selected")
    for (const name of ["Box 1", "Box 2", "Box 3"])
      expect(
        screen
          .getByRole("button", { name: `Select ${name} for a folder` })
          .getAttribute("aria-pressed"),
      ).toBe("true")
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 2" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Add selection to folder" }))
    await createSelectedFolder("Housing")
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(onCommit.mock.calls[0]).toEqual([
      authority.revision,
      {
        kind: "folder.create",
        folder: {
          schemaVersion: 0,
          id: expect.any(String),
          name: "Housing",
          items: authority.history,
        },
      },
    ])
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    await userEvent.click(screen.getByRole("treeitem", { name: "Box 2" }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it("provides single-pointer selection and blocks gaps and existing-folder overlap", async () => {
    const { authority, view, content, onCommit } = selectionFixture()
    await userEvent.click(screen.getByRole("button", { name: "Select Box 1 for a folder" }))
    await userEvent.click(screen.getByRole("button", { name: "Select Box 3 for a folder" }))
    expect(
      (screen.getByRole("button", { name: "Add selection to folder" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByRole("status").textContent).toMatch(/contiguous range/)
    await userEvent.click(screen.getByRole("button", { name: "Select Box 3 for a folder" }))
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: authority.history.slice(0, 1),
    }
    view.rerender(content({ ...authority, folders: [folder] }))
    expect(
      (screen.getByRole("button", { name: "Add selection to folder" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("focuses the name field and returns to the source History row after cancellation", async () => {
    const { onCommit } = selectionFixture()
    const row = screen.getByRole("treeitem", { name: "Box 2" })
    fireEvent.contextMenu(row)
    await userEvent.click(screen.getByRole("menuitem", { name: "Add selection to folder" }))
    const dialog = screen.getByRole("dialog", { name: "New folder" })
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("textbox", { name: "Folder name" }),
      ),
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(document.activeElement).toBe(row))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("context-selects an unselected row and adds adjacent members to an existing folder in one command", async () => {
    const original = authoredTreeFixture().authority
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: original.history.slice(0, 2),
    }
    const { authority, onCommit } = selectionFixture({ ...original, folders: [folder] })
    const selectThird = screen.getByRole("button", { name: "Select Box 3 for a folder" })
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 3" }))
    expect(selectThird.getAttribute("aria-pressed")).toBe("true")
    await userEvent.click(screen.getByRole("menuitem", { name: "Add to Housing" }))
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1)
      expect(onCommit).toHaveBeenCalledWith(authority.revision, {
        kind: "folder.set-items",
        folderId: folder.id,
        items: authority.history,
      })
    })
  })

  it("preserves selected rows and reports a failed append without issuing a second command", async () => {
    const original = authoredTreeFixture().authority
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: original.history.slice(0, 2),
    }
    const { onCommit } = selectionFixture({ ...original, folders: [folder] })
    onCommit.mockRejectedValue(new Error("Storage unavailable"))
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 3" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Add to Housing" }))
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Could not update the folder/),
    )
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(
      screen
        .getByRole("button", { name: "Select Box 3 for a folder" })
        .getAttribute("aria-pressed"),
    ).toBe("true")
  })

  it("blocks a stale open context menu before appending membership", async () => {
    const original = authoredTreeFixture().authority
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: original.history.slice(0, 2),
    }
    const { authority, view, content, onCommit } = selectionFixture({
      ...original,
      folders: [folder],
    })
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 3" }))
    view.rerender(content({ ...authority, revision: authority.revision + 1 }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Add to Housing" }))
    expect(screen.getByRole("alert").textContent).toMatch(/document changed/)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("locks metadata actions until an append settles and then releases the lock", async () => {
    const original = authoredTreeFixture().authority
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: original.history.slice(0, 2),
    }
    const { onCommit } = selectionFixture({ ...original, folders: [folder] })
    let resolveCommit: ((value: { ok: true }) => void) | undefined
    onCommit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommit = resolve
        }),
    )
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 3" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Add to Housing" }))
    expect((screen.getByRole("button", { name: "New folder" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Box 3" }))
    const action = screen.getByRole("menuitem", { name: "Add to Housing" })
    expect(action.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(action)
    expect(onCommit).toHaveBeenCalledTimes(1)
    await act(async () => resolveCommit?.({ ok: true }))
    await userEvent.keyboard("{Escape}")
    expect((screen.getByRole("button", { name: "New folder" }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it("rejects a stale creation and retains the folder name without writing", async () => {
    const { authority, onCommit, view, content } = selectionFixture()
    await userEvent.click(screen.getByRole("button", { name: "Select Box 2 for a folder" }))
    await userEvent.click(screen.getByRole("button", { name: "Add selection to folder" }))
    const dialog = screen.getByRole("dialog", { name: "New folder" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Folder name" }), "Housing")
    view.rerender(content({ ...authority, revision: authority.revision + 1 }))
    await userEvent.click(within(dialog).getByRole("button", { name: "New folder" }))
    expect(within(dialog).getByRole("alert").textContent).toMatch(/document changed/)
    expect(
      (within(dialog).getByRole("textbox", { name: "Folder name" }) as HTMLInputElement).value,
    ).toBe("Housing")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("blocks a form opened before editing starts and clears selection on a document switch", async () => {
    const { authority, onCommit, view, content } = selectionFixture()
    await userEvent.click(screen.getByRole("button", { name: "Select Box 1 for a folder" }))
    await userEvent.click(screen.getByRole("button", { name: "Add selection to folder" }))
    const dialog = screen.getByRole("dialog", { name: "New folder" })
    view.rerender(content(authority, true))
    expect(
      (within(dialog).getByRole("button", { name: "New folder" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.submit(within(dialog).getByRole("form"))
    expect(onCommit).not.toHaveBeenCalled()
    view.rerender(
      content({
        ...authority,
        id: documentIdSchema.parse(authoredTestId(2)),
      }),
    )
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(
      screen
        .getByRole("button", { name: "Select Box 1 for a folder" })
        .getAttribute("aria-pressed"),
    ).toBe("false")
  })
})
