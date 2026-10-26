import "../../../../tests/unit/support/dom"
import { afterAll, afterEach, beforeEach, expect, it } from "bun:test"
import { act, cleanup, render, screen } from "@testing-library/react"
import { I18nProvider } from "@vibeshape/i18n/provider"
import { TooltipProvider } from "@vibeshape/ui/components/tooltip"
import { vi } from "../../../../tests/unit/support/bun-test"
import type { DocumentControllerState } from "../document/document-controller"
import { i18n } from "../i18n"
import { authoredTreeFixture } from "../test-support/authored-tree-fixture"
import { HistoryNavigationProvider } from "./history-navigation"
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
function Harness({ rows }: { rows: readonly HistoryViewRow[] }) {
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
            groups={rows.map((row, index) => ({ folder: null, rows: [{ row, index }] }))}
            authority={null}
            onCommit={undefined}
            disabled={false}
            detailed={false}
            dragSourceKey={null}
            revealRequest={null}
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
