import { describe, expect, it } from "bun:test"
import {
  historyMoveCommitViewSchema,
  historyMoveOperationSchema,
  historyMoveResultContextMatches,
} from "./history-move-tools"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const operation = {
  tool: "move_history_item",
  arguments: {
    documentId: id(1),
    baseRevision: 4,
    commandId: id(2),
    item: { kind: "feature", id: id(3) },
    historyAfter: { kind: "sketch", id: id(4) },
  },
}

describe("named semantic History move contract", () => {
  it("accepts stable typed anchors including the start of History", () => {
    expect(historyMoveOperationSchema.safeParse(operation).success).toBe(true)
    expect(
      historyMoveOperationSchema.safeParse({
        ...operation,
        arguments: { ...operation.arguments, historyAfter: null },
      }).success,
    ).toBe(true)
  })
  it.each([
    { history: [operation.arguments.item] },
    { authority: {} },
    { actor: { type: "system" } },
    { item: { kind: "folder", id: id(3) } },
    { historyAfter: undefined },
    { item: { kind: "feature", id: id(3), ordinal: 1 } },
  ])("rejects non-semantic or injected authority fields: %j", (fields) => {
    expect(
      historyMoveOperationSchema.safeParse({
        ...operation,
        arguments: { ...operation.arguments, ...fields },
      }).success,
    ).toBe(false)
  })
  it("binds the result to the document, revision, command, item and anchor", () => {
    const result = { ok: true, value: { ...operation.arguments, revision: 5 } }
    expect(historyMoveResultContextMatches(operation, result, id(1))).toBe(true)
    for (const fields of [
      { documentId: id(9) },
      { commandId: id(9) },
      { baseRevision: 3, revision: 4 },
      { revision: 6 },
      { item: { kind: "sketch", id: id(3) } },
      { historyAfter: null },
    ])
      expect(
        historyMoveResultContextMatches(operation, {
          ...result,
          value: { ...result.value, ...fields },
        }),
      ).toBe(false)
    expect(historyMoveResultContextMatches(operation, result, id(9))).toBe(false)
    expect(historyMoveCommitViewSchema.safeParse({ ...result.value, history: [] }).success).toBe(
      false,
    )
    expect(historyMoveResultContextMatches({ tool: "undo_model" }, result)).toBeNull()
  })
})
