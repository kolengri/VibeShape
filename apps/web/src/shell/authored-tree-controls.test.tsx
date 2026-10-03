// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import type { ReactNode } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { i18n } from "../i18n"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
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

describe("authored tree controls", () => {
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
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(authority.revision, {
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
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce())
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
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(authority.revision, {
      kind: "folder.remove",
      folderId: folder.id,
    })
  })
})

describe("authored part operations", () => {
  it("starts Placement from the selected stable PartId and blocks upstream fallbacks", async () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const onPlace = vi.fn()
    const props = {
      revision: authority.revision,
      selectedPartId: part.id,
      disabled: false,
      onSelect: vi.fn(),
      onPlace,
      onCommit: commit(),
    }
    const { rerender } = render(
      providers(
        <AuthoredPartsGroup
          {...props}
          parts={[{ part, body: authoredTestBody(part), status: "available" }]}
        />,
      ),
    )
    await userEvent.click(screen.getByRole("button", { name: "Place part Part 1" }))
    expect(onPlace).toHaveBeenCalledExactlyOnceWith(part.id)
    rerender(
      providers(
        <AuthoredPartsGroup
          {...props}
          parts={[{ part, body: authoredTestBody(part), status: "upstream" }]}
        />,
      ),
    )
    expect(screen.getByRole("button", { name: "Place part Part 1" }).hasAttribute("disabled")).toBe(
      true,
    )
  })
  it("keeps Compound and Union explicit for distinct sibling bodies and rejects duplicate body selections", async () => {
    const { authority } = authoredTreeFixture()
    const parts = authority.parts
      .slice(0, 2)
      .map((part) => ({ part, body: authoredTestBody(part), status: "available" as const }))
    const onCombine = vi.fn()
    const props = {
      revision: authority.revision,
      selectedPartId: null,
      disabled: false,
      onSelect: vi.fn(),
      onCombine,
      onCommit: commit(),
    }
    const { rerender } = render(providers(<AuthoredPartsGroup {...props} parts={parts} />))
    await userEvent.click(screen.getByRole("button", { name: "Compound" }))
    await userEvent.click(screen.getByRole("button", { name: "Union" }))
    expect(onCombine.mock.calls).toEqual([["compound"], ["union"]])
    const first = requireAuthoredFixture(parts[0])
    const second = requireAuthoredFixture(parts[1])
    rerender(
      providers(
        <AuthoredPartsGroup
          {...props}
          parts={[first, { ...second, body: { ...first.body, outputRole: "body.second" } }]}
        />,
      ),
    )
    expect(screen.getByRole("button", { name: "Compound" }).hasAttribute("disabled")).toBe(false)
    expect(screen.getByRole("button", { name: "Union" }).hasAttribute("disabled")).toBe(false)
    rerender(
      providers(<AuthoredPartsGroup {...props} parts={[first, { ...second, body: first.body }]} />),
    )
    expect(screen.getByRole("button", { name: "Compound" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Union" }).hasAttribute("disabled")).toBe(true)
  })
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
      } else
        expect(onSurfaceTexture).toHaveBeenCalledExactlyOnceWith(body.featureId, body.outputRole)
    },
  )
})
