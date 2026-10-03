import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { featureIdSchema, historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { describe, expect, it } from "vitest"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import {
  authoredBodyKeys,
  folderRangeItems,
  groupFolderHistory,
  selectedAuthoredBody,
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
    ).toEqual([authority.history[2]])
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
})
