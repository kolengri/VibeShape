import { describe, expect, it } from "bun:test"
import { historyRepairFixture } from "../../../../packages/domain/src/history-repair.test-fixture"
import type { DocumentControllerState } from "../document/document-controller"
import { historyCreationAfter, reconcileHistoryInsertion } from "../document/history-insertion"
import { historyInsertionAnchor, historyInsertionContext } from "./history-insertion-context"

function fixture() {
  const snapshot = historyRepairFixture()
  const report = {
    snapshot,
    historyItems: snapshot.history,
    rebuild: {
      ok: false,
      diagnostic: {
        code: "rebuild-failed",
        message: "Fixture",
        retryable: false,
        sourceCode: null,
      },
    },
  }
  return { snapshot, controller: { report } as unknown as DocumentControllerState }
}
describe("History insertion input boundary", () => {
  it("keeps full authority but excludes later inputs, including the beginning boundary", () => {
    const { snapshot, controller } = fixture()
    const first = snapshot.history[0]
    if (!first) throw new Error("Missing first fixture item")
    const limited = historyInsertionContext({
      ...controller,
      historyInsertion: {
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        historyAfter: first,
      },
    })
    expect(limited.report?.historyItems).toEqual([first])
    expect(limited.report?.snapshot.features.map((item) => item.id)).toEqual(
      first.kind === "feature" ? [first.id] : [],
    )
    expect(limited.report?.snapshot.sketches.map((item) => item.id)).toEqual(
      first.kind === "sketch" ? [first.id] : [],
    )
    expect(controller.report?.snapshot).toBe<unknown>(snapshot)
    const start = historyInsertionContext({
      ...controller,
      historyInsertion: {
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        historyAfter: null,
      },
    })
    expect(start.report?.snapshot.features).toEqual([])
    expect(start.report?.snapshot.sketches).toEqual([])
  })
  it("resolves above/below from the current interleaved order and rejects absent anchors", () => {
    const { snapshot, controller } = fixture()
    const first = snapshot.history[0]
    if (!first) throw new Error("Missing first fixture item")
    const second = snapshot.history[1]
    if (!second) throw new Error("Missing second fixture item")
    expect(historyInsertionAnchor(controller, first, "above")).toEqual({
      found: true,
      anchor: null,
    })
    expect(historyInsertionAnchor(controller, second, "above")).toEqual({
      found: true,
      anchor: first,
    })
    expect(historyInsertionAnchor(controller, second, "below")).toEqual({
      found: true,
      anchor: second,
    })
    expect(historyInsertionAnchor({ ...controller, report: null }, first, "below")).toEqual({
      found: false,
    })
  })
  it("captures import anchors and rebases only explicit new History insertion", () => {
    const { snapshot, controller } = fixture()
    const first = snapshot.history[0]
    const second = snapshot.history[1]
    if (!first || !second || !controller.report) throw new Error("Missing fixture History")
    const before = {
      ...controller,
      report: { ...controller.report, historyItems: [first] },
      historyInsertion: {
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        historyAfter: first,
      },
    }
    expect(historyCreationAfter(before)).toEqual(first)
    const after = {
      ...before,
      report: {
        ...controller.report,
        snapshot: { ...controller.report.snapshot, revision: snapshot.revision + 1 },
        historyItems: [first, second],
      },
    }
    expect(reconcileHistoryInsertion(before, after, true)).toMatchObject({
      baseRevision: snapshot.revision + 1,
      historyAfter: second,
    })
    expect(reconcileHistoryInsertion(before, after)).toMatchObject({ historyAfter: first })
    const removed = { ...after, report: { ...after.report, historyItems: [second] } }
    expect(reconcileHistoryInsertion(before, removed)).toBeNull()
    expect(
      historyCreationAfter({
        ...before,
        historyInsertion: { ...before.historyInsertion, historyAfter: null },
      }),
    ).toBeNull()
  })
})
