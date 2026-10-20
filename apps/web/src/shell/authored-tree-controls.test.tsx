import "../../../../tests/unit/support/dom"
import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentMutationResult } from "../document/document-controller"
import { EditorSessionProvider, useEditorSession } from "../editor-session/editor-session-provider"
import { i18n } from "../i18n"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import { ApplicationNoticesProvider } from "./application-notices"
import type { AuthoredMetadataCommit } from "./authored-item-rename"
import { AuthoredPartsGroup } from "./authored-parts-group"
import { HistoryFolderDialog } from "./history-folder-dialog"
import { HistoryFolderGroup } from "./history-folder-group"

function providers(children: ReactNode) {
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  )
}
const commit = () => vi.fn<AuthoredMetadataCommit>().mockResolvedValue({ ok: true })
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(cleanup)

describe("authored tree controls", () => {
  it("counts terminal parts and collapses consumed construction identities without a document write", async () => {
    const { authority } = authoredTreeFixture()
    const [body, lid, cutter] = authority.parts
    if (!body || !lid || !cutter) throw new Error("Three authored parts are required.")
    const onCommit = commit()
    render(
      providers(
        <AuthoredPartsGroup
          parts={[
            { part: body, body: authoredTestBody(body), status: "available" },
            { part: lid, body: null, status: "unavailable" },
            { part: cutter, body: null, status: "consumed" },
          ]}
          revision={authority.revision}
          selectedPartId={null}
          highlightedPartIds={[cutter.id]}
          disabled={false}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      ),
    )
    const parts = screen.getByRole("treeitem", { name: "Parts" })
    expect(within(parts).getByText("2")).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Part Part 1" })).toBeTruthy()
    expect(screen.getByRole("treeitem", { name: "Part Part 2" })).toBeTruthy()
    expect(screen.queryByRole("treeitem", { name: "Part Part 3" })).toBeNull()
    const consumed = screen.getByRole("treeitem", { name: "Consumed parts" })
    expect(consumed.getAttribute("aria-expanded")).toBe("false")
    expect(consumed.getAttribute("data-highlighted")).toBe("true")
    expect(within(consumed).getByText("1")).toBeTruthy()
    await userEvent.click(consumed)
    expect(screen.getByRole("treeitem", { name: "Part Part 3" })).toBeTruthy()
    await userEvent.click(consumed)
    expect(screen.queryByRole("treeitem", { name: "Part Part 3" })).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("toggles Part presentation during a draft while rename and durable metadata remain blocked", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const onCommit = commit()
    function DraftParts() {
      const overrides = useEditorSession((state) => state.partVisibilityOverrides)
      const actions = useEditorSession((state) => state.actions)
      return (
        <AuthoredPartsGroup
          parts={[{ part, body: authoredTestBody(part), status: "available" }]}
          revision={authority.revision}
          selectedPartId={null}
          disabled
          presentationOnlyVisibility
          visibilityDisabled={false}
          visibility={{
            overrides,
            setOverride: actions.setPartVisibilityOverride,
            clearOverride: actions.clearPartVisibilityOverride,
          }}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />
      )
    }
    render(
      providers(
        <EditorSessionProvider>
          <DraftParts />
        </EditorSessionProvider>,
      ),
    )
    expect(
      (screen.getByRole("button", { name: "Rename part Part 1" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(
      screen.getByRole("button", { name: "Show part Part 1" }).getAttribute("aria-pressed"),
    ).toBe("false")
    await userEvent.click(screen.getByRole("button", { name: "Show part Part 1" }))
    expect(
      screen.getByRole("button", { name: "Hide part Part 1" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(onCommit).not.toHaveBeenCalled()
    expect(authority.parts[0]).toBe(part)
  })

  it("clears only a successfully committed idle override and retains it on rejection", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const clearOverride = vi.fn()
    const onCommit = commit().mockRejectedValueOnce(new Error("Storage unavailable"))
    render(
      providers(
        <AuthoredPartsGroup
          parts={[{ part, body: authoredTestBody(part), status: "available" }]}
          revision={authority.revision}
          selectedPartId={null}
          disabled={false}
          visibility={{ overrides: { [part.id]: true }, setOverride: vi.fn(), clearOverride }}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(clearOverride).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").classList.contains("fixed")).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(onCommit).toHaveBeenLastCalledWith(authority.revision, {
      kind: "part.set-visibility",
      partId: part.id,
      visible: false,
    })
    expect(clearOverride).toHaveBeenCalledTimes(1)
    expect(clearOverride).toHaveBeenCalledWith(part.id)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each([
    ["automation-busy", "Wait for the AI operation or review to finish"],
    ["editor-draft", "Finish or cancel the active edit"],
    ["surface-texture-draft", "Finish or cancel the active edit"],
    ["save-in-progress", "Wait for saving to finish"],
    ["read-only", "Open the document with write access"],
    ["document-unavailable", "Reopen the project"],
  ])(
    "reports the precise %s guard without pretending visibility changed",
    async (sourceCode, message) => {
      const { authority } = authoredTreeFixture()
      const part = requireAuthoredFixture(authority.parts[0])
      const onCommit = commit().mockResolvedValue({
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "Guard rejected.",
          retryable: true,
          sourceCode,
        },
      })
      render(
        providers(
          <AuthoredPartsGroup
            parts={[{ part, body: null, status: "unavailable" }]}
            revision={authority.revision}
            selectedPartId={null}
            disabled={false}
            onSelect={vi.fn()}
            onCommit={onCommit}
          />,
        ),
      )
      await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
      expect(screen.getByRole("alert").textContent).toContain(message)
      expect(
        screen.getByRole("button", { name: "Hide part Part 1" }).getAttribute("aria-pressed"),
      ).toBe("true")
      expect(screen.queryByRole("status")).toBeNull()
    },
  )

  it("never converts a real persistence failure to a temporary override", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const setOverride = vi.fn()
    const clearOverride = vi.fn()
    const onCommit = commit().mockResolvedValue({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        message: "Storage rejected.",
        retryable: true,
        sourceCode: "automation-busy",
      },
    })
    render(
      providers(
        <AuthoredPartsGroup
          parts={[{ part, body: null, status: "unavailable" }]}
          revision={authority.revision}
          selectedPartId={null}
          disabled={false}
          visibility={{ overrides: {}, setOverride, clearOverride }}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(screen.getByRole("alert").textContent).toContain("could not be saved")
    expect(setOverride).not.toHaveBeenCalled()
    expect(clearOverride).not.toHaveBeenCalled()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("compares override cancellation against the current rendered authority", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const clearOverride = vi.fn()
    const setOverride = vi.fn()
    const onCommit = commit()
    const content = (visible: boolean, revision: number) =>
      providers(
        <AuthoredPartsGroup
          parts={[{ part: { ...part, visible }, body: null, status: "unavailable" }]}
          revision={revision}
          selectedPartId={null}
          disabled={false}
          visibility={{ overrides: { [part.id]: false }, setOverride, clearOverride }}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      )
    const view = render(content(true, authority.revision))
    view.rerender(content(false, authority.revision + 1))
    await userEvent.click(screen.getByRole("button", { name: "Show part Part 1" }))
    expect(onCommit).toHaveBeenCalledWith(authority.revision + 1, {
      kind: "part.set-visibility",
      partId: part.id,
      visible: true,
    })
    expect(clearOverride).toHaveBeenCalledWith(part.id)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it.each(["part", "owner", "authority", "override"])(
    "discards a delayed busy rejection after the %s changes",
    async (changed) => {
      const { authority } = authoredTreeFixture()
      const part = requireAuthoredFixture(authority.parts[0])
      const other = requireAuthoredFixture(authority.parts[1])
      let settle!: (result: DocumentMutationResult) => void
      const onCommit = vi.fn<AuthoredMetadataCommit>(
        () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      )
      const setOverride = vi.fn()
      const clearOverride = vi.fn()
      const content = (updated: boolean) =>
        providers(
          <AuthoredPartsGroup
            parts={[
              {
                part: updated && changed === "part" ? other : part,
                body: null,
                status: "unavailable",
              },
            ]}
            revision={authority.revision + (updated && changed === "authority" ? 1 : 0)}
            selectedPartId={null}
            disabled={false}
            visibility={{
              overrides: updated && changed === "override" ? { [part.id]: true } : {},
              setOverride,
              clearOverride,
            }}
            onSelect={vi.fn()}
            onCommit={updated && changed === "owner" ? commit() : onCommit}
          />,
        )
      const view = render(content(false))
      await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
      view.rerender(content(true))
      await act(async () => {
        settle({
          ok: false,
          diagnostic: {
            code: "command-rejected",
            message: "Busy.",
            retryable: true,
            sourceCode: "automation-busy",
          },
        })
      })
      expect(setOverride).not.toHaveBeenCalled()
      expect(clearOverride).not.toHaveBeenCalled()
      expect(screen.queryByRole("status")).toBeNull()
      expect(screen.queryByRole("alert")).toBeNull()
    },
  )

  it("does not clear a newer override after an old durable commit completes", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    let settle!: (result: DocumentMutationResult) => void
    const onCommit = vi.fn<AuthoredMetadataCommit>(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    const setOverride = vi.fn()
    const clearOverride = vi.fn()
    const content = (revision: number) =>
      providers(
        <AuthoredPartsGroup
          parts={[{ part, body: null, status: "unavailable" }]}
          revision={revision}
          selectedPartId={null}
          disabled={false}
          visibility={{ overrides: { [part.id]: true }, setOverride, clearOverride }}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      )
    const view = render(content(authority.revision))
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    view.rerender(content(authority.revision + 2))
    await act(async () => {
      settle({ ok: true })
    })
    expect(clearOverride).not.toHaveBeenCalled()
    expect(setOverride).not.toHaveBeenCalled()
  })

  it("reports visibility failures outside part rows and resurfaces a dismissed failure on retry", async () => {
    const { authority } = authoredTreeFixture()
    const parts = authority.parts.slice(0, 2).map((part) => ({
      part,
      body: authoredTestBody(part),
      status: "available" as const,
    }))
    const onCommit = commit()
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockResolvedValueOnce({
        ok: false,
        diagnostic: {
          code: "command-rejected",
          message: "Stale revision",
          retryable: true,
          sourceCode: "stale-revision",
        },
      })
    const view = render(
      providers(
        <ApplicationNoticesProvider>
          <AuthoredPartsGroup
            parts={parts}
            revision={authority.revision}
            selectedPartId={null}
            disabled={false}
            onSelect={vi.fn()}
            onCommit={onCommit}
          />
        </ApplicationNoticesProvider>,
      ),
    )
    const rows = [...view.container.querySelectorAll("[data-part-id]")]
    const markup = rows.map((row) => row.innerHTML)
    const toggle = screen.getByRole("button", { name: "Hide part Part 1" })
    await userEvent.click(toggle)
    expect(screen.getByRole("alert").textContent).toContain(
      "Visibility for Part 1 could not be saved. Try again.",
    )
    expect(rows.map((row) => row.innerHTML)).toEqual(markup)
    for (const row of rows) expect(within(row as HTMLElement).queryByRole("alert")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByRole("alert")).toBeNull()
    await userEvent.click(toggle)
    expect(screen.getByRole("alert").textContent).toContain("Visibility for Part 1")
    await userEvent.click(toggle)
    expect(screen.getByRole("alert").textContent).toContain(
      "The document changed. Check the current visibility for Part 1 and try again.",
    )
    await userEvent.click(toggle)
    expect(onCommit).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("selects stable parts and persists visibility independently of geometry", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const onCommit = commit()
    const onSelect = vi.fn()
    const parts = [{ part, body: authoredTestBody(part), status: "available" as const }]
    render(
      providers(
        <AuthoredPartsGroup
          parts={parts}
          revision={authority.revision}
          selectedPartId={null}
          disabled={false}
          onSelect={onSelect}
          onCommit={onCommit}
        />,
      ),
    )
    await userEvent.click(screen.getByRole("treeitem", { name: "Part Part 1" }))
    expect(onSelect).toHaveBeenCalledWith(part.id)
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(authority.revision, {
      kind: "part.set-visibility",
      partId: part.id,
      visible: false,
    })
  })
  it("captures the revision when rename opens and retains input after a failed save", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const onCommit = commit().mockRejectedValue(new Error("Storage unavailable"))
    const content = (revision: number) =>
      providers(
        <AuthoredPartsGroup
          parts={[{ part, body: null, status: "unavailable" }]}
          revision={revision}
          selectedPartId={part.id}
          disabled={false}
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      )
    const view = render(content(authority.revision))
    expect(screen.getByText("No current body; inspect History.")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Rename part Part 1" }))
    const dialog = screen.getByRole("dialog", { name: "Rename item" })
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Name" }))
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Housing")
    view.rerender(content(authority.revision + 1))
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }))
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy())
    expect(onCommit).toHaveBeenCalledWith(authority.revision, {
      kind: "part.rename",
      partId: part.id,
      name: "Housing",
    })
    expect((within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe(
      "Housing",
    )
  })
  it("shows consumed identity while blocking writes during another edit", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const onCommit = commit()
    render(
      providers(
        <AuthoredPartsGroup
          parts={[{ part, body: null, status: "consumed" }]}
          revision={authority.revision}
          selectedPartId={null}
          disabled
          onSelect={vi.fn()}
          onCommit={onCommit}
        />,
      ),
    )
    expect(screen.queryByText("Consumed by a later operation")).toBeNull()
    await userEvent.click(screen.getByRole("treeitem", { name: "Consumed parts" }))
    expect(screen.getByText("Consumed by a later operation")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Rename part Part 1" }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "Hide part Part 1" }))
    expect(onCommit).not.toHaveBeenCalled()
  })
  it("creates an explicitly named history range in one metadata command", async () => {
    const { authority, rows } = authoredTreeFixture()
    const onCommit = commit()
    render(
      providers(
        <HistoryFolderDialog
          authority={authority}
          rows={rows}
          disabled={false}
          onCommit={onCommit}
        />,
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "New folder" }))
    const dialog = screen.getByRole("dialog", { name: "New folder" })
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Folder name" }), "Housing")
    await userEvent.click(within(dialog).getByRole("button", { name: "New folder" }))
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(onCommit.mock.calls[0]).toEqual([
      authority.revision,
      {
        kind: "folder.create",
        folder: {
          schemaVersion: 0,
          id: expect.any(String),
          name: "Housing",
          items: authority.history.slice(0, 1),
        },
      },
    ])
  })
  it("collapses without a write and ungroups without deleting history", async () => {
    const { authority, rows } = authoredTreeFixture()
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: authority.history.slice(0, 2),
    }
    const onCommit = commit()
    render(
      providers(
        <HistoryFolderGroup
          authority={{ ...authority, folders: [folder] }}
          folder={folder}
          rows={rows}
          disabled={false}
          onCommit={onCommit}
        >
          <span>Original history children</span>
        </HistoryFolderGroup>,
      ),
    )
    await userEvent.click(screen.getByRole("treeitem", { name: "Folder Housing" }))
    expect(screen.queryByText("Original history children")).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Remove folder Housing" }))
    const dialog = screen.getByRole("alertdialog")
    expect(
      within(dialog).getByText(/All sketches, features, and their order stay unchanged/),
    ).toBeTruthy()
    await userEvent.click(within(dialog).getByRole("button", { name: "Ungroup" }))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(authority.revision, {
      kind: "folder.remove",
      folderId: folder.id,
    })
  })
  it("renames a History folder through metadata while preserving its members", async () => {
    const { authority, rows } = authoredTreeFixture()
    const folder = {
      schemaVersion: 0 as const,
      id: historyFolderIdSchema.parse(authoredTestId(300)),
      name: "Housing",
      items: authority.history.slice(0, 2),
    }
    const onCommit = commit()
    render(
      providers(
        <HistoryFolderGroup
          authority={{ ...authority, folders: [folder] }}
          folder={folder}
          rows={rows}
          disabled={false}
          onCommit={onCommit}
        >
          <span>Original history children</span>
        </HistoryFolderGroup>,
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Rename folder Housing" }))
    const dialog = screen.getByRole("dialog", { name: "Rename item" })
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Name" }))
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Outer shell")
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }))
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1)
      expect(onCommit).toHaveBeenCalledWith(authority.revision, {
        kind: "folder.rename",
        folderId: folder.id,
        name: "Outer shell",
      })
    })
    expect(screen.getByText("Original history children")).toBeTruthy()
    expect(folder.items).toEqual(authority.history.slice(0, 2))
  })
})

it("keeps selected Part rows focused on selection and metadata", () => {
  const { authority } = authoredTreeFixture()
  const part = requireAuthoredFixture(authority.parts[0])
  render(
    providers(
      <AuthoredPartsGroup
        revision={authority.revision}
        selectedPartId={part.id}
        disabled={false}
        onSelect={vi.fn()}
        onCommit={commit()}
        parts={[{ part, body: authoredTestBody(part), status: "available" }]}
      />,
    ),
  )
  expect(screen.getByRole("treeitem", { name: "Part Part 1" })).toBeTruthy()
  expect(
    screen.queryByRole("button", {
      name: /Place|Mirror|Shell|Split|Pattern|Thread|Compound|Union/,
    }),
  ).toBeNull()
})

describe("surface texture source eligibility", () => {
  it.each(["exact", "triangle-mesh"] as const)(
    "requires exact source geometry for %s Part texture actions",
    async (representation) => {
      const { authority } = authoredTreeFixture()
      const part = requireAuthoredFixture(authority.parts[0])
      const body = authoredTestBody(part)
      const onSurfaceTexture = vi.fn()
      render(
        providers(
          <AuthoredPartsGroup
            parts={[
              {
                part,
                body: representation === "triangle-mesh" ? { ...body, representation } : body,
                status: "available",
              },
            ]}
            revision={authority.revision}
            selectedPartId={part.id}
            disabled={false}
            onSelect={vi.fn()}
            onCommit={commit()}
            onSurfaceTexture={onSurfaceTexture}
          />,
        ),
      )
      fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Part Part 1" }))
      const action = screen.getByRole("menuitem", { name: "Surface texture" })
      expect(action.getAttribute("aria-disabled")).toBe(
        representation === "triangle-mesh" ? "true" : null,
      )
      await userEvent.click(action)
      if (representation === "triangle-mesh") {
        expect(onSurfaceTexture).not.toHaveBeenCalled()
        expect(screen.getByText(/Triangle mesh/)).toBeTruthy()
      } else {
        expect(onSurfaceTexture).toHaveBeenCalledTimes(1)
        expect(onSurfaceTexture).toHaveBeenCalledWith(body.featureId, body.outputRole)
      }
    },
  )
})
