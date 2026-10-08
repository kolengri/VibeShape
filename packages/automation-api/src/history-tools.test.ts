import { describe, expect, it } from "bun:test"
import {
  historyCommitViewSchema,
  historyOperationSchema,
  historyResultContextMatches,
} from "./history-tools"
import { localToolAnnotations } from "./tool-metadata"

const id = (n: number) => `0195b5ac-b260-7a2c-8c33-${String(n).padStart(12, "0")}`
const operation = {
  tool: "undo_model",
  arguments: { documentId: id(1), baseRevision: 4, commandId: id(2) },
}
const value = {
  documentId: id(1),
  baseRevision: 4,
  revision: 5,
  commandId: id(2),
  direction: "undo",
  targetRevision: 2,
}
describe("closed-world history contracts", () => {
  it("requires document/base/command context and rejects caller authority", () => {
    expect(historyOperationSchema.safeParse(operation).success).toBe(true)
    for (const extra of [
      { approved: true },
      { targetRevision: 2 },
      { snapshot: {} },
      { script: "undo()" },
    ]) {
      expect(
        historyOperationSchema.safeParse({
          ...operation,
          arguments: { ...operation.arguments, ...extra },
        }).success,
      ).toBe(false)
    }
    expect(
      historyOperationSchema.safeParse({
        ...operation,
        arguments: { baseRevision: 4, commandId: id(2) },
      }).success,
    ).toBe(false)
    expect(historyCommitViewSchema.safeParse({ ...value, revision: 4 }).success).toBe(false)
    expect(historyCommitViewSchema.safeParse({ ...value, targetRevision: 6 }).success).toBe(false)
  })
  it("correlates state and save results against requested identity on both transports", () => {
    expect(historyResultContextMatches(operation, { ok: true, value })).toBe(true)
    expect(historyResultContextMatches(operation, { ok: true, value }, id(3))).toBe(false)
    for (const changed of [
      { ...value, documentId: id(3) },
      { ...value, baseRevision: 3, revision: 4 },
      { ...value, commandId: id(3) },
      { ...value, direction: "redo" },
      { ...value, revision: 6 },
    ]) {
      expect(historyResultContextMatches(operation, { ok: true, value: changed })).toBe(false)
    }
    const read = { tool: "model_history_state", arguments: { documentId: id(1), revision: 4 } }
    expect(
      historyResultContextMatches(read, {
        ok: true,
        value: { documentId: id(1), revision: 4, canUndo: true, canRedo: false },
      }),
    ).toBe(true)
    expect(
      historyResultContextMatches(read, {
        ok: true,
        value: { documentId: id(2), revision: 4, canUndo: true, canRedo: false },
      }),
    ).toBe(false)
  })
  it("advertises availability as read-only and navigation as reviewed non-idempotent writes", () => {
    expect(localToolAnnotations("model_history_state")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    })
    for (const name of ["undo_model", "redo_model"] as const)
      expect(localToolAnnotations(name)).toMatchObject({
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
      })
  })
})
