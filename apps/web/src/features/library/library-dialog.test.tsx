import "../../../../../tests/unit/support/dom"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { vi } from "../../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../../document/document-controller"

const ports = (() => ({
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  metadata: vi.fn(),
  insert: vi.fn(),
  relink: vi.fn(),
  detach: vi.fn(),
}))()
mock.module("../../document/library-controller", () => ({
  listLocalLibraryItems: ports.list,
  readLocalLibraryVersion: ports.read,
  saveActiveLibraryDefinition: ports.save,
  updateLocalLibraryMetadata: ports.metadata,
  insertLocalLibraryVersion: ports.insert,
  relinkActiveLibraryDefinition: ports.relink,
  detachActiveLibraryDefinition: ports.detach,
}))

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
)
const { default: userEvent } = await import("@testing-library/user-event")
const { I18nProvider } = await import("@vibeshape/i18n/provider")
const { i18n } = await import("../../i18n")
const { default: messages } = await import("../../i18n/messages/en.json")
const { LibraryDialog } = await import("./library-dialog")
const { libraryController, libraryItem, libraryRead, librarySourcePartId } = await import(
  "./library-test-fixtures"
)
function setup(initial = libraryController(), blocked = false) {
  const tree = (controller: DocumentControllerState) => (
    <I18nProvider i18n={i18n}>
      <LibraryDialog controller={controller} blocked={blocked} />
    </I18nProvider>
  )
  const view = render(tree(initial))
  return { update: (controller: DocumentControllerState) => view.rerender(tree(controller)) }
}
async function openLibrary(select = true) {
  await userEvent.click(screen.getByRole("button", { name: "Library…" }))
  const dialog = screen.getByRole("dialog", { name: "Local component library" })
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Select library item Bracket" }),
    ).toBeTruthy(),
  )
  if (select) {
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Select library item Bracket" }),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole("form", { name: "Insert into the assembly" })).toBeTruthy(),
    )
  }
  return dialog
}
async function choose(label: string, option: string) {
  const field = screen.getByRole("combobox", { name: label })
  await act(async () => {
    field.focus()
  })
  await userEvent.keyboard("{Enter}")
  await userEvent.click(screen.getByRole("option", { name: option }))
}
beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset()
  ports.list.mockResolvedValue({ ok: true, value: [libraryItem] })
  ports.read.mockImplementation(async (_id: string, version?: number) => ({
    ok: true,
    value: libraryRead(version ?? 2),
  }))
  ports.save.mockResolvedValue({ ok: true, value: libraryRead() })
  ports.metadata.mockResolvedValue({ ok: true, value: { ...libraryItem, metadataRevision: 4 } })
  for (const port of [ports.insert, ports.relink, ports.detach])
    port.mockResolvedValue({ ok: true })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("local component library dialog", () => {
  it.each([1, 2])(
    "keeps insertion and metadata form identities distinct when both counters equal %s",
    async (version) => {
      const item = { ...libraryItem, headVersion: version, metadataRevision: version }
      ports.read.mockResolvedValueOnce({ ok: true, value: { ...libraryRead(version), item } })
      ports.metadata.mockResolvedValueOnce({
        ok: true,
        value: { ...item, name: "Saved metadata", metadataRevision: version + 1 },
      })
      const errors = vi.spyOn(console, "error")
      try {
        setup()
        const dialog = await openLibrary()
        const insertion = within(dialog).getByRole("form", { name: "Insert into the assembly" })
        const metadata = within(dialog).getByRole("form", { name: "Library item metadata" })
        fireEvent.change(within(insertion).getByRole("textbox", { name: "Definition name" }), {
          target: { value: "Insertion draft" },
        })
        fireEvent.change(within(metadata).getByRole("textbox", { name: "Component name" }), {
          target: { value: "Metadata draft" },
        })
        await userEvent.click(within(metadata).getByRole("button", { name: "Save name and tags" }))
        const updated = within(dialog).getByRole("form", { name: "Library item metadata" })
        expect(
          (within(updated).getByRole("textbox", { name: "Component name" }) as HTMLInputElement)
            .value,
        ).toBe("Saved metadata")
        const preservedInsertion = within(dialog).getByRole("form", {
          name: "Insert into the assembly",
        })
        expect(
          (
            within(preservedInsertion).getByRole("textbox", {
              name: "Definition name",
            }) as HTMLInputElement
          ).value,
        ).toBe("Insertion draft")
        expect(
          within(dialog).getAllByRole("form", { name: "Insert into the assembly" }),
        ).toHaveLength(1)
        expect(within(dialog).getAllByRole("form", { name: "Library item metadata" })).toHaveLength(
          1,
        )
        expect(errors).not.toHaveBeenCalled()
      } finally {
        cleanup()
        errors.mockRestore()
      }
    },
  )
  it("searches local names/tags, reads an explicit historical version and inserts copy or pinned reference", async () => {
    setup()
    const dialog = await openLibrary()
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search names and tags" }), {
      target: { value: "Mount" },
    })
    await waitFor(() => expect(ports.list).toHaveBeenLastCalledWith("Mount"))
    await choose("Library version", "Version 1")
    await waitFor(() => expect(ports.read).toHaveBeenLastCalledWith(libraryItem.id, 1))
    let form = within(dialog).getByRole("form", { name: "Insert into the assembly" })
    fireEvent.change(within(form).getByRole("textbox", { name: "Definition name" }), {
      target: { value: "Mount copy" },
    })
    fireEvent.change(within(form).getByRole("textbox", { name: "Occurrence name" }), {
      target: { value: "Mount occurrence" },
    })
    await userEvent.click(within(form).getByRole("button", { name: "Insert copy" }))
    expect(ports.insert).toHaveBeenLastCalledWith({
      itemId: libraryItem.id,
      version: 1,
      mode: "copy",
      definitionName: "Mount copy",
      instanceName: "Mount occurrence",
    })
    await choose("Insertion mode", "Pinned library reference")
    form = within(dialog).getByRole("form", { name: "Insert into the assembly" })
    await userEvent.click(within(form).getByRole("button", { name: "Insert pinned reference" }))
    expect(ports.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemId: libraryItem.id, version: 1, mode: "reference" }),
    )
    expect(ports.relink).not.toHaveBeenCalled()
  })
  it("saves exact source identity, explicitly publishes a version and revision-checks metadata changes", async () => {
    const controller = libraryController()
    setup(controller)
    const dialog = await openLibrary()
    const save = within(dialog).getByRole("form", { name: "Save a frozen component" })
    fireEvent.change(within(save).getByRole("textbox", { name: "Component name" }), {
      target: { value: "Reusable mount" },
    })
    fireEvent.change(within(save).getByRole("textbox", { name: "Tags" }), {
      target: { value: "Print, Fixture" },
    })
    await userEvent.click(within(save).getByRole("button", { name: "Save library item" }))
    expect(ports.save).toHaveBeenLastCalledWith({
      source: { kind: "part", id: librarySourcePartId },
      expectedMetadataRevision: null,
      name: "Reusable mount",
      tags: ["Print", "Fixture"],
    })
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Publish a version of the selected item" }),
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish new version" }))
    expect(ports.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        itemId: libraryItem.id,
        expectedMetadataRevision: 3,
        name: "Bracket",
      }),
    )
    const metadata = within(dialog).getByRole("form", { name: "Library item metadata" })
    fireEvent.change(within(metadata).getByRole("textbox", { name: "Component name" }), {
      target: { value: "Renamed mount" },
    })
    await userEvent.click(within(metadata).getByRole("button", { name: "Save name and tags" }))
    expect(ports.metadata).toHaveBeenLastCalledWith({
      itemId: libraryItem.id,
      expectedMetadataRevision: 3,
      name: "Renamed mount",
      tags: libraryItem.tags,
    })
  })
  it("locks duplicate publication and dismissal, then exposes failures and releases the action for retry", async () => {
    setup()
    let reject: ((reason: Error) => void) | undefined
    ports.save.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail
        }),
    )
    const dialog = await openLibrary(false)
    const form = within(dialog).getByRole("form", { name: "Save a frozen component" })
    await act(async () => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(ports.save).toHaveBeenCalledTimes(1)
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(
      (within(dialog).getByRole("button", { name: "Close library" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await act(async () => reject?.(new Error("Storage offline")))
    expect(within(dialog).getByRole("alert").textContent).toContain(
      messages.app.library.operationFailed,
    )
    await userEvent.click(within(form).getByRole("button", { name: "Save library item" }))
    expect(ports.save).toHaveBeenCalledTimes(2)
    const close = within(dialog).getAllByRole("button", { name: "Close library" })[0]
    if (!close) throw new Error("The library requires an accessible close action.")
    await userEvent.click(close)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it.each([
    ["Save a frozen component", "save"],
    ["Library item metadata", "metadata"],
    ["Insert into the assembly", "insert"],
  ] as const)("does not mutate from %s after dismissal during validation", async (label, port) => {
    setup()
    const dialog = await openLibrary()
    const form = within(dialog).getByRole("form", { name: label })
    const close = within(dialog).getAllByRole("button", { name: "Close library" })[0]
    if (!close) throw new Error("The library requires an accessible close action.")
    await act(async () => {
      fireEvent.submit(form)
      fireEvent.click(close)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(ports[port]).not.toHaveBeenCalled()
  })
  it("resets metadata for a new source or publication target while retaining drafts across unrelated reads", async () => {
    setup()
    const dialog = await openLibrary()
    const form = within(dialog).getByRole("form", { name: "Save a frozen component" })
    const name = within(form).getByRole("textbox", { name: "Component name" }) as HTMLInputElement
    const tags = within(form).getByRole("textbox", { name: "Tags" }) as HTMLInputElement
    fireEvent.change(name, { target: { value: "First source draft" } })
    fireEvent.change(tags, { target: { value: "Custom" } })
    await choose("Source component", "Part · Part 2")
    expect(name.value).toBe("Part 2")
    expect(tags.value).toBe("")
    fireEvent.change(name, { target: { value: "Second source draft" } })
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search names and tags" }), {
      target: { value: "Bracket" },
    })
    await waitFor(() => expect(ports.list).toHaveBeenLastCalledWith("Bracket"))
    expect(name.value).toBe("Second source draft")
    await userEvent.click(
      within(form).getByRole("radio", { name: "Publish a version of the selected item" }),
    )
    expect(name.value).toBe("Bracket")
    expect(tags.value).toBe("Print, Mount")
    fireEvent.change(name, { target: { value: "Publication draft" } })
    await choose("Library version", "Version 1")
    await waitFor(() => expect(ports.read).toHaveBeenLastCalledWith(libraryItem.id, 1))
    expect(name.value).toBe("Bracket")
    const metadata = within(dialog).getByRole("form", { name: "Library item metadata" })
    ports.metadata.mockResolvedValueOnce({
      ok: true,
      value: { ...libraryItem, name: "Renamed bracket", metadataRevision: 4 },
    })
    await userEvent.click(within(metadata).getByRole("button", { name: "Save name and tags" }))
    await waitFor(() => expect(name.value).toBe("Renamed bracket"))
    expect(
      (
        within(form).getByRole("radio", {
          name: "Publish a version of the selected item",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
    expect(within(form).getByRole("combobox", { name: "Source component" }).textContent).toContain(
      "Part 2",
    )
    await userEvent.click(within(form).getByRole("radio", { name: "Create a new item" }))
    expect(name.value).toBe("Part 2")
    expect(tags.value).toBe("")
  })
  it("requires explicit reference update or detach and never relinks on a library read", async () => {
    setup(libraryController(true))
    const dialog = await openLibrary()
    expect(ports.relink).not.toHaveBeenCalled()
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Update reference to selected version" }),
    )
    expect(ports.relink).toHaveBeenCalledTimes(1)
    expect(ports.relink).toHaveBeenCalledWith({
      definitionId: libraryRead().version.definition.id,
      itemId: libraryItem.id,
      version: 2,
    })
    await userEvent.click(within(dialog).getByRole("button", { name: "Detach library reference" }))
    expect(ports.detach).toHaveBeenCalledTimes(1)
    expect(ports.detach).toHaveBeenCalledWith(libraryRead().version.definition.id)
  })
  it("shows corrupt/missing version diagnostics and never inserts a fallback version", async () => {
    setup()
    const dialog = await openLibrary()
    ports.read.mockResolvedValueOnce({
      ok: false,
      diagnostic: {
        code: "corrupt-history",
        message: "The library source bytes are missing or corrupt.",
        retryable: false,
      },
    })
    await choose("Library version", "Version 1")
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain("missing or corrupt"),
    )
    expect(within(dialog).queryByRole("form", { name: "Insert into the assembly" })).toBeNull()
    expect(ports.insert).not.toHaveBeenCalled()
  })
  it("allows blocked browsing but disables authoring and rejects invalid metadata before a port call", async () => {
    setup(libraryController(), true)
    const dialog = await openLibrary()
    expect(within(dialog).getByRole("button", { name: "Insert copy" }).matches(":disabled")).toBe(
      true,
    )
    expect(
      within(dialog).getByRole("button", { name: "Save library item" }).matches(":disabled"),
    ).toBe(true)
    expect(ports.insert).not.toHaveBeenCalled()
    cleanup()
    setup()
    const writable = await openLibrary(false)
    const form = within(writable).getByRole("form", { name: "Save a frozen component" })
    fireEvent.change(within(form).getByRole("textbox", { name: "Tags" }), {
      target: { value: "Print, print" },
    })
    await userEvent.click(within(form).getByRole("button", { name: "Save library item" }))
    expect(within(writable).getByRole("alert").textContent).toContain(
      messages.app.library.invalidMetadata,
    )
    expect(ports.save).not.toHaveBeenCalled()
    const tags = within(form).getByRole("textbox", { name: "Tags" })
    expect(tags.getAttribute("aria-invalid")).toBe("true")
    expect(document.activeElement).toBe(tags)
    fireEvent.change(tags, { target: { value: " Print, Fixture " } })
    await userEvent.click(within(form).getByRole("button", { name: "Save library item" }))
    expect(ports.save).toHaveBeenCalledWith(expect.objectContaining({ tags: ["Print", "Fixture"] }))
  })
  it("discards stale document results instead of publishing them into another scope", async () => {
    const controller = libraryController()
    const view = setup(controller)
    const dialog = await openLibrary()
    let finish: ((value: { ok: true; value: typeof libraryItem }) => void) | undefined
    ports.metadata.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    await userEvent.click(within(dialog).getByRole("button", { name: "Save name and tags" }))
    const authority = controller.authoredSnapshot
    if (!authority) throw new Error("The test requires document authority.")
    view.update({
      ...controller,
      authoredSnapshot: { ...authority, revision: authority.revision + 1 },
    })
    await act(async () =>
      finish?.({ ok: true, value: { ...libraryItem, name: "Late name", metadataRevision: 4 } }),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        messages.app.library.staleDocument,
      ),
    )
    expect(within(dialog).queryByText("Late name", { exact: true })).toBeNull()
  })
  it("discards out-of-order reads and never replaces a newer item selection with an older response", async () => {
    const alternate = {
      ...libraryItem,
      id: "0195b5ac-b220-7a2c-8c33-000000000999",
      name: "Alternate",
    }
    ports.list.mockResolvedValue({ ok: true, value: [libraryItem, alternate] })
    let finish: ((value: { ok: true; value: ReturnType<typeof libraryRead> }) => void) | undefined
    ports.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    setup()
    const dialog = await openLibrary(false)
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Select library item Bracket" }),
    )
    ports.read.mockResolvedValueOnce({ ok: true, value: { ...libraryRead(), item: alternate } })
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Select library item Alternate" }),
    )
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("textbox", { name: "Definition name" }) as HTMLInputElement)
          .value,
      ).toBe("Alternate"),
    )
    await act(async () => finish?.({ ok: true, value: libraryRead() }))
    expect(
      (within(dialog).getByRole("textbox", { name: "Definition name" }) as HTMLInputElement).value,
    ).toBe("Alternate")
  })
  it("accepts the revision advance of its own CAD insertion without reporting a stale metadata result", async () => {
    const controller = libraryController()
    const view = setup(controller)
    let finish: ((value: { ok: true }) => void) | undefined
    ports.insert.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    const dialog = await openLibrary()
    await userEvent.click(within(dialog).getByRole("button", { name: "Insert copy" }))
    const authority = controller.authoredSnapshot
    if (!authority) throw new Error("The test requires authored authority.")
    view.update({
      ...controller,
      authoredSnapshot: { ...authority, revision: authority.revision + 1 },
    })
    await act(async () => finish?.({ ok: true }))
    expect(within(dialog).getByText(messages.app.library.inserted)).toBeTruthy()
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })
})
