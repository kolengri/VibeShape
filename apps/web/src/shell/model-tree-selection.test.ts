import { describe, expect, it } from "bun:test"
import { partIdSchema } from "@vibeshape/domain/identifiers"
import {
  authoredTestBody,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import {
  extendModelTreeSelection,
  type ModelTreeSelection,
  modelTreeSelectionKey,
  partForModelBody,
} from "./model-tree-selection"

function selectedPart(index: number): ModelTreeSelection {
  return {
    kind: "part",
    id: partIdSchema.parse(`0195b5ac-b220-7a2c-8c33-${String(index).padStart(12, "0")}`),
  }
}
const first = selectedPart(1)
const second = selectedPart(2)
const third = selectedPart(3)
const items = [first, second, third]
const plain = { shiftKey: false, ctrlKey: false, metaKey: false }

describe("Model tree selection", () => {
  it("replaces, toggles with Ctrl or Command, and extends a visible range from its anchor", () => {
    expect(extendModelTreeSelection([first], items, second, null, plain)).toEqual([second])
    expect(
      extendModelTreeSelection([first], items, third, null, { ...plain, ctrlKey: true }),
    ).toEqual([first, third])
    expect(
      extendModelTreeSelection([first, third], items, first, null, { ...plain, metaKey: true }),
    ).toEqual([third])
    expect(
      extendModelTreeSelection([first], items, third, modelTreeSelectionKey(first), {
        ...plain,
        shiftKey: true,
      }),
    ).toEqual(items)
    expect(
      extendModelTreeSelection([third], items, first, modelTreeSelectionKey(third), {
        ...plain,
        shiftKey: true,
      }),
    ).toEqual(items)
  })

  it("maps only a unique exact current body to its authored part", () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const body = authoredTestBody(part)
    const resolved = { part, body, status: "available" as const }
    expect(partForModelBody([resolved], body)?.part.id).toBe(part.id)
    expect(partForModelBody([resolved], { ...body, outputRole: "other" })).toBeUndefined()
    expect(partForModelBody([resolved, resolved], body)).toBeUndefined()
  })

  it("indexes each current projection independently and preserves missing and ambiguous ownership", () => {
    const { authority } = authoredTreeFixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const body = authoredTestBody(part)
    const resolved = { part, body, status: "available" as const }
    const current = [resolved]
    expect(partForModelBody(current, body)).toBe(resolved)
    expect(partForModelBody(current, body)).toBe(resolved)
    expect(partForModelBody([{ ...resolved, body: null }], body)).toBeUndefined()
    expect(partForModelBody([resolved, { ...resolved }], body)).toBeUndefined()
    expect(partForModelBody(current, body)).toBe(resolved)
  })
})
