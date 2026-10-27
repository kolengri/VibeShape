import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createEmptySketch, historyFolderSchema, sketchIdSchema } from "@vibeshape/domain"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import {
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import { HistoryNavigationProvider } from "./history-navigation"
import type { HistoryRevealRequest } from "./history-reveal-request"
import { HistoryVirtualTrack } from "./history-virtual-track"
import type { HistoryViewRow } from "./model-tree-history"

const fixture = authoredTreeFixture()
const controller = {
  status: "ready",
  saveStatus: "saved",
  historyInsertion: null,
  report: {
    mode: "read-write",
    snapshot: fixture.snapshot,
    historyItems: fixture.authority.history,
    rebuild: { ok: false },
  },
} as unknown as DocumentControllerState
const onCommit = vi.fn(async () => ({ ok: true as const }))
function Harness({
  rows,
  revealRequest = null,
  foldered = false,
}: {
  rows: readonly HistoryViewRow[]
  revealRequest?: HistoryRevealRequest | null
  foldered?: boolean
}) {
  const folder = foldered
    ? historyFolderSchema.parse({
        schemaVersion: 0,
        id: authoredTestId(990),
        name: "Saved operations",
        items: rows.map((row) => row.ref),
      })
    : null
  return (
    <I18nProvider i18n={i18n} initialLocale="en">
      <TooltipProvider>
        <HistoryNavigationProvider
          controller={controller}
          orderedRefs={rows.map((row) => row.ref)}
          onInsert={undefined}
          onReturnToEnd={undefined}
        >
          <HistoryVirtualTrack
            groups={
              folder
                ? [{ folder, rows: rows.map((row, index) => ({ row, index })) }]
                : rows.map((row, index) => ({ folder: null, rows: [{ row, index }] }))
            }
            authority={folder ? fixture.authority : null}
            onCommit={folder ? onCommit : undefined}
            disabled={false}
            detailed={false}
            dragSourceKey={null}
            revealRequest={revealRequest}
            selectedId={null}
            empty={null}
            renderRow={(row) => (
              <div data-history-id={row.ref.id}>
                <button type="button" role="treeitem" tabIndex={-1}>
                  {row.record.label}
                </button>
              </div>
            )}
          />
        </HistoryNavigationProvider>
      </TooltipProvider>
    </I18nProvider>
  )
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(cleanup)
afterAll(() => vi.unstubAllGlobals())
it("keeps a History tab stop after its focused operation disappears and another render commits", () => {
  const view = render(<Harness rows={fixture.rows} />)
  act(() => screen.getByRole("treeitem", { name: "Box 2" }).focus())
  const remaining = fixture.rows.filter((row) => row.record.label !== "Box 2")
  view.rerender(<Harness rows={remaining} />)
  expect(screen.getByRole("treeitem", { name: "Box 1" }).tabIndex).toBe(0)
  view.rerender(<Harness rows={[...remaining]} />)
  expect(screen.getAllByRole("treeitem").filter((item) => item.tabIndex === 0)).toHaveLength(1)
})

it("expands a collapsed History folder and focuses a saved item without writing folder metadata", async () => {
  const view = render(<Harness rows={fixture.rows} foldered />)
  const folder = screen.getByRole("treeitem", { name: "Folder Saved operations" })
  fireEvent.click(folder)
  expect(folder.getAttribute("aria-expanded")).toBe("false")
  expect(screen.queryByRole("treeitem", { name: "Box 2" })).toBeNull()
  const target = requireAuthoredFixture(fixture.rows[1]).ref
  view.rerender(
    <Harness
      rows={fixture.rows}
      foldered
      revealRequest={{ historyItem: target, destination: "timeline", sequence: 1 }}
    />,
  )
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Box 2" })),
  )
  expect(folder.getAttribute("aria-expanded")).toBe("true")
  expect(onCommit).not.toHaveBeenCalled()
})

it("reveals the exact sketch kind when feature and sketch IDs overlap", async () => {
  const feature = requireAuthoredFixture(fixture.rows[0])
  const sketch = createEmptySketch({
    id: sketchIdSchema.parse(feature.ref.id),
    label: "Related sketch",
    plane: "xy",
  })
  const row: HistoryViewRow = {
    ...feature,
    kind: "sketch",
    ref: { kind: "sketch", id: sketch.id },
    record: sketch,
  }
  render(
    <Harness
      rows={[feature, row]}
      revealRequest={{ historyItem: row.ref, destination: "timeline", sequence: 1 }}
    />,
  )
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Related sketch" })),
  )
})
