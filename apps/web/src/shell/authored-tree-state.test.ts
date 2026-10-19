import { describe, expect, it } from "bun:test"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { featureIdSchema, historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import {
  authoredBodyKeys,
  folderItemsWithSelection,
  folderRangeItems,
  groupFolderHistory,
  selectedAuthoredBody,
  selectedFolderItems,
} from "./authored-tree-state"

function fixture() {
  const result = authoredTreeFixture()
  const folder: HistoryFolder = {
    schemaVersion: 0,
    id: historyFolderIdSchema.parse(authoredTestId(300)),
    name: "Housing",
    items: result.authority.history.slice(0, 2),
  }
  return { ...result, folder, authority: { ...result.authority, folders: [folder] } }
}

describe("authored tree projection", () => {
  it("validates selection in canonical order without filling gaps or accepting occupied members", () => {
    const { authority, folder } = fixture()
    const keys = authority.history.map(historyItemKey)
    const first = requireAuthoredFixture(keys[0])
    const second = requireAuthoredFixture(keys[1])
    const third = requireAuthoredFixture(keys[2])
    const ungrouped = { ...authority, folders: [] }
    expect(selectedFolderItems(ungrouped, [second, first])).toEqual(authority.history.slice(0, 2))
    expect(selectedFolderItems(ungrouped, [first, third])).toBeNull()
    expect(selectedFolderItems(ungrouped, [first, "missing"])).toBeNull()
    expect(selectedFolderItems(ungrouped, [])).toBeNull()
    expect(selectedFolderItems(authority, [first, second])).toBeNull()
    expect(selectedFolderItems(authority, [first, second], folder.id)).toEqual(folder.items)
    expect(selectedFolderItems(authority, [third])).toEqual(authority.history.slice(2))
  })
  it("adds only adjacent ungrouped members to an existing folder without changing History", () => {
    const { authority, folder } = fixture()
    const keys = authority.history.map(historyItemKey)
    const third = requireAuthoredFixture(keys[2])
    expect(folderItemsWithSelection(authority, folder, [third])).toEqual(authority.history)
    expect(folderItemsWithSelection(authority, folder, folder.items.map(historyItemKey))).toBeNull()
    const single = { ...folder, items: authority.history.slice(0, 1) }
    expect(
      folderItemsWithSelection({ ...authority, folders: [single] }, single, [third]),
    ).toBeNull()
    const other = {
      ...folder,
      id: historyFolderIdSchema.parse(authoredTestId(301)),
      items: authority.history.slice(2),
    }
    expect(
      folderItemsWithSelection({ ...authority, folders: [folder, other] }, folder, [third]),
    ).toBeNull()
    expect(authority.history.map(historyItemKey)).toEqual(keys)
  })
  it("groups only canonical adjacent history and retains original reorder indices", () => {
    const { authority, rows, folder } = fixture()
    const grouped = groupFolderHistory(rows, authority.folders)
    expect(
      grouped.map(({ folder, rows }) => [folder?.name ?? null, rows.map(({ index }) => index)]),
    ).toEqual([
      ["Housing", [0, 1]],
      [null, [2]],
    ])
    expect(grouped.flatMap(({ rows }) => rows.map(({ row }) => row.ref))).toEqual(authority.history)
    expect(
      groupFolderHistory(rows, [
        {
          ...folder,
          items: [
            requireAuthoredFixture(authority.history[0]),
            requireAuthoredFixture(authority.history[2]),
          ],
        },
      ]),
    ).toHaveLength(3)
  })
  it("rejects reversed, missing, or overlapping ranges and allows editing the same folder", () => {
    const { authority, folder } = fixture()
    const keys = authority.history.map(historyItemKey)
    expect(
      folderRangeItems(authority, requireAuthoredFixture(keys[0]), requireAuthoredFixture(keys[2])),
    ).toBeNull()
    expect(
      folderRangeItems(authority, requireAuthoredFixture(keys[2]), requireAuthoredFixture(keys[0])),
    ).toBeNull()
    expect(folderRangeItems(authority, "missing", requireAuthoredFixture(keys[2]))).toBeNull()
    expect(
      folderRangeItems(
        authority,
        requireAuthoredFixture(keys[0]),
        requireAuthoredFixture(keys[2]),
        folder.id,
      ),
    ).toEqual(authority.history)
    expect(
      folderRangeItems(authority, requireAuthoredFixture(keys[2]), requireAuthoredFixture(keys[2])),
    ).toEqual<unknown>([authority.history[2]])
  })
  it("keeps a stable selected PartId while its exact current body advances", () => {
    const { authority } = fixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const body = authoredTestBody(part)
    const current = { part, body, status: "available" as const }
    expect(selectedAuthoredBody([current], part.id)).toEqual({
      featureId: body.featureId,
      outputRole: "result",
    })
    const advanced = {
      ...body,
      featureId: featureIdSchema.parse(authoredTestId(400)),
      outputRole: "profile:2",
    }
    expect(selectedAuthoredBody([{ ...current, body: advanced }], part.id)).toEqual({
      featureId: advanced.featureId,
      outputRole: "profile:2",
    })
    expect(
      selectedAuthoredBody([{ ...current, part: { ...part, visible: false } }], part.id),
    ).toBeNull()
    expect(
      selectedAuthoredBody([{ ...current, body: null, status: "consumed" }], part.id),
    ).toBeNull()
  })
  it("hides the complete authored lineage during rollback without hiding other roles or parts", () => {
    const { authority } = fixture()
    const part = requireAuthoredFixture(authority.parts[0])
    const first = requireAuthoredFixture(part.bodyHistory[0])
    const advanced = {
      ...first,
      featureId: featureIdSchema.parse(authoredTestId(400)),
      outputRole: "profile:2",
    }
    const hidden = authoredBodyKeys(
      {
        ...authority,
        parts: [
          { ...part, visible: false, bodyHistory: [first, advanced] },
          ...authority.parts.slice(1),
        ],
      },
      true,
    )
    expect([...hidden]).toEqual([`${first.featureId}:result`, `${advanced.featureId}:profile:2`])
    expect(hidden.has(`${advanced.featureId}:profile:1`)).toBe(false)
    expect(hidden.has(`${authority.parts[1]?.bodyHistory[0]?.featureId}:result`)).toBe(false)
  })
  it("applies per-Part overrides to every binding while retaining another Part from the same producer", () => {
    const { authority } = fixture()
    const first = requireAuthoredFixture(authority.parts[0])
    const second = requireAuthoredFixture(authority.parts[1])
    const old = requireAuthoredFixture(first.bodyHistory[0])
    const producer = featureIdSchema.parse(authoredTestId(400))
    const left = { ...old, featureId: producer, outputRole: "left" }
    const right = { ...old, featureId: producer, outputRole: "right" }
    const authored = {
      ...authority,
      parts: [
        { ...first, bodyHistory: [old, left] },
        { ...second, bodyHistory: [right] },
      ],
    }
    expect([...authoredBodyKeys(authored, true, { [first.id]: false })]).toEqual([
      `${old.featureId}:result`,
      `${producer}:left`,
    ])
    expect(authoredBodyKeys(authored, true, { [first.id]: false }).has(`${producer}:right`)).toBe(
      false,
    )
    const resolved = {
      part: { ...first, visible: false },
      body: authoredTestBody({ ...first, bodyHistory: [left] }),
      status: "available" as const,
    }
    expect(selectedAuthoredBody([resolved], first.id, { [first.id]: true })).toEqual({
      featureId: producer,
      outputRole: "left",
    })
    expect(selectedAuthoredBody([resolved], first.id, { [first.id]: false })).toBeNull()
  })
})
