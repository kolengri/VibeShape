import { describe, expect, it } from "bun:test"
import { documentIdSchema, sketchIdSchema } from "@vibeshape/domain"
import { historyRepairFixture } from "../../../../packages/domain/src/history-repair.test-fixture"
import type { DocumentControllerState } from "../document/document-controller"
import { historyCreationAfter, reconcileHistoryInsertion } from "../document/history-insertion"
import {
  effectiveHistoryBoundaryIndex,
  historyInsertionAnchor,
  historyInsertionContext,
} from "./history-insertion-context"

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

describe("Effective History boundary", () => {
  it("distinguishes full authority, explicit start, and committed sketch editing with cursor precedence", () => {
    const { snapshot, controller } = fixture()
    const firstSketch = snapshot.sketches[0]
    const later = snapshot.history[3]
    if (!firstSketch || !later) throw new Error("Expected interleaved History.")
    expect(effectiveHistoryBoundaryIndex(controller, snapshot.history)).toBeNull()
    expect(effectiveHistoryBoundaryIndex(controller, snapshot.history, firstSketch.id)).toBe(0)
    const start = {
      ...controller,
      historyInsertion: {
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        historyAfter: null,
      },
    }
    expect(effectiveHistoryBoundaryIndex(start, snapshot.history, firstSketch.id)).toBe(-1)
    expect(
      effectiveHistoryBoundaryIndex(
        { ...start, historyInsertion: { ...start.historyInsertion, historyAfter: later } },
        snapshot.history,
        firstSketch.id,
      ),
    ).toBe(3)
  })

  it("ignores stale document cursors and missing anchors while retaining a valid edited-sketch boundary", () => {
    const { snapshot, controller } = fixture()
    const edited = snapshot.sketches[0]
    if (!edited) throw new Error("Expected a committed sketch.")
    const otherDocument = {
      ...controller,
      historyInsertion: {
        documentId: documentIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2f01"),
        baseRevision: snapshot.revision,
        historyAfter: null,
      },
    }
    expect(effectiveHistoryBoundaryIndex(otherDocument, snapshot.history)).toBeNull()
    expect(effectiveHistoryBoundaryIndex(otherDocument, snapshot.history, edited.id)).toBe(0)
    const missing = sketchIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f2f02")
    const removedAnchor = {
      ...controller,
      historyInsertion: {
        documentId: snapshot.id,
        baseRevision: snapshot.revision,
        historyAfter: { kind: "sketch" as const, id: missing },
      },
    }
    expect(effectiveHistoryBoundaryIndex(removedAnchor, snapshot.history)).toBeNull()
    expect(effectiveHistoryBoundaryIndex(removedAnchor, snapshot.history, edited.id)).toBe(0)
    expect(effectiveHistoryBoundaryIndex(controller, snapshot.history, missing)).toBeNull()
  })

  it("does not invent an edit boundary for missing rows, absent reports, or a failed graph", () => {
    const { snapshot, controller } = fixture()
    const edited = snapshot.sketches[0]
    if (!edited) throw new Error("Expected a committed sketch.")
    expect(
      effectiveHistoryBoundaryIndex(
        controller,
        snapshot.history.filter((item) => item.id !== edited.id),
        edited.id,
      ),
    ).toBeNull()
    expect(
      effectiveHistoryBoundaryIndex({ ...controller, report: null }, snapshot.history, edited.id),
    ).toBeNull()
    expect(effectiveHistoryBoundaryIndex(controller, snapshot.history, edited.id, true)).toBeNull()
  })
})
