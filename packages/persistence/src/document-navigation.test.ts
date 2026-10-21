import { expect, it } from "bun:test"
import {
  applyVersionedDocumentCommand,
  type DocumentSnapshotV1,
  type VersionedDocumentEvent,
} from "@vibeshape/domain"
import { projectAuthorityRecordSchema } from "./authority-schemas"
import { nextDocumentNavigation } from "./document-navigation"
import { documentNavigationSchema, projectRecordV1Schema } from "./schemas"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const at = "2026-10-21T00:00:00Z"
const created = applyVersionedDocumentCommand(null, {
  schemaVersion: 1,
  kind: "org.vibeshape.document.create",
  documentId: id(1),
  commandId: id(2),
  baseRevision: 0,
  issuedAt: at,
  actor: { type: "user", userId: null },
  payload: { name: "Original" },
})
if (!created.ok) throw new Error(created.diagnostic.message)
const first = created.snapshot
const snapshot = (revision: number, name = `Revision ${revision}`): DocumentSnapshotV1 => ({
  ...first,
  revision,
  name,
})
const restore = (direction: "undo" | "redo", targetRevision: number): VersionedDocumentEvent => ({
  ...created.event,
  type: "org.vibeshape.document.restored",
  direction,
  targetRevision,
  baseRevision: 10,
  revision: 11,
})
const project = {
  schemaVersion: 1,
  documentId: first.id,
  name: first.name,
  headRevision: 20,
  latestSnapshotRevision: 20,
  cleanCloseRevision: null,
  createdAt: at,
  updatedAt: at,
  lastExternalBackupAt: null,
  migrationProvenance: "current",
  migrationDiagnostic: null,
  unavailableRecords: [],
}
function authorityProject(schemaVersion: number) {
  return {
    ...project,
    schemaVersion,
    ...(schemaVersion >= 2 ? { upgradeRevision: 2 } : {}),
    ...(schemaVersion >= 3 ? { textureUpgradeRevision: 3 } : {}),
    ...(schemaVersion >= 4 ? { sourceUpgradeRevision: 4 } : {}),
    ...(schemaVersion >= 5 ? { repairUpgradeRevision: 5 } : {}),
  }
}

it("retains arbitrarily many compact publication boundaries and atomically plans multi-step navigation", () => {
  let state = nextDocumentNavigation(undefined, null, first, [created.event])
  for (let revision = 2; revision <= 1001; revision++)
    state = nextDocumentNavigation(state, snapshot(revision - 1), snapshot(revision), [])
  expect(state.undo).toHaveLength(1000)
  const saved = structuredClone(state)
  const undone = nextDocumentNavigation(state, snapshot(1001), snapshot(1002, "Revision 1"), [
    restore("undo", 1),
  ])
  expect(state).toEqual(saved)
  expect(undone.undo).toEqual([])
  expect(undone.redo).toHaveLength(1000)
  const redone = nextDocumentNavigation(undone, snapshot(1002), snapshot(1003), [
    restore("redo", 1001),
  ])
  expect(redone.undo).toEqual(saved.undo)
  expect(redone.redo).toEqual([])
})

it("keeps redo on semantic no-ops and truncates it on a successful authored publication", () => {
  const previous = { schemaVersion: 1 as const, undo: [], redo: [{ before: 1, after: 2 }] }
  expect(nextDocumentNavigation(previous, snapshot(3), snapshot(5, "Revision 3"), []).redo).toEqual(
    previous.redo,
  )
  const next = nextDocumentNavigation(previous, snapshot(3), snapshot(4), [])
  expect(next).toEqual({ schemaVersion: 1, undo: [{ before: 3, after: 4 }], redo: [] })
  expect(previous.redo).toHaveLength(1)
})

it("starts legacy and imported journals with an empty baseline without reconstructing ambiguous ownership", () => {
  expect(
    nextDocumentNavigation(undefined, snapshot(10), snapshot(11), [restore("undo", 1)]),
  ).toEqual({ schemaVersion: 1, undo: [], redo: [] })
  expect(nextDocumentNavigation(undefined, snapshot(10), snapshot(11), []).undo).toEqual([
    { before: 10, after: 11 },
  ])
  expect(() =>
    nextDocumentNavigation({ schemaVersion: 1, undo: [], redo: [] }, snapshot(10), snapshot(11), [
      restore("undo", 1),
    ]),
  ).toThrow("not in the saved navigation stack")
})

it("publishes an internal checkpoint as one redoable range while retaining preceding ordinary history", () => {
  const previous = {
    schemaVersion: 1 as const,
    undo: [
      { before: 1, after: 2 },
      { before: 2, after: 4 },
      { before: 4, after: 7 },
    ],
    redo: [],
  }
  expect(
    nextDocumentNavigation(previous, snapshot(7), snapshot(8), [restore("undo", 2)], true),
  ).toEqual({ schemaVersion: 1, undo: [{ before: 1, after: 2 }], redo: [{ before: 2, after: 7 }] })
  expect(() =>
    nextDocumentNavigation(previous, snapshot(7), snapshot(8), [restore("redo", 2)], true),
  ).toThrow("must restore Undo")
})

it("rejects malformed navigation and future revision references while accepting legacy project records", () => {
  expect(
    documentNavigationSchema.safeParse({
      schemaVersion: 1,
      undo: [{ before: 2, after: 1 }],
      redo: [],
    }).success,
  ).toBe(false)
  expect(projectRecordV1Schema.safeParse(project).success).toBe(true)
  expect(
    projectRecordV1Schema.safeParse({
      ...project,
      navigation: { schemaVersion: 1, undo: [{ before: 1, after: 21 }], redo: [] },
    }).success,
  ).toBe(false)
})

it.each([
  {
    undo: [
      { before: 2, after: 3 },
      { before: 1, after: 2 },
    ],
    redo: [],
  },
  {
    undo: [],
    redo: [
      { before: 1, after: 2 },
      { before: 2, after: 3 },
    ],
  },
  {
    undo: [
      { before: 1, after: 2 },
      { before: 1, after: 2 },
    ],
    redo: [],
  },
  {
    undo: [],
    redo: [
      { before: 1, after: 2 },
      { before: 1, after: 2 },
    ],
  },
  {
    undo: [
      { before: 1, after: 4 },
      { before: 3, after: 5 },
    ],
    redo: [],
  },
  {
    undo: [],
    redo: [
      { before: 3, after: 5 },
      { before: 1, after: 4 },
    ],
  },
  { undo: [{ before: 1, after: 4 }], redo: [{ before: 3, after: 5 }] },
  { undo: [{ before: 1, after: 2 }], redo: [{ before: 1, after: 2 }] },
])("rejects reordered, duplicated or overlapping saved navigation: %j", (stacks) => {
  const navigation = { schemaVersion: 1, ...stacks }
  expect(documentNavigationSchema.safeParse(navigation).success).toBe(false)
  for (const schemaVersion of [1, 2, 3, 4, 5])
    expect(
      projectAuthorityRecordSchema.safeParse({
        ...authorityProject(schemaVersion),
        navigation,
      }).success,
    ).toBe(false)
})

it("accepts saved navigation gaps from restores, no-ops, grouped edits and internal checkpoint ranges", () => {
  const navigation = {
    schemaVersion: 1 as const,
    undo: [
      { before: 1, after: 2 },
      { before: 5, after: 7 },
    ],
    redo: [
      { before: 12, after: 15 },
      { before: 7, after: 10 },
    ],
  }
  expect(documentNavigationSchema.parse(navigation)).toEqual(navigation)
  for (const schemaVersion of [1, 2, 3, 4, 5])
    expect(
      projectAuthorityRecordSchema.safeParse({ ...authorityProject(schemaVersion), navigation })
        .success,
    ).toBe(true)
})

it("moves a range beyond the JavaScript call-argument limit without imposing an implicit step cap", () => {
  const previous = {
    schemaVersion: 1 as const,
    undo: Array.from({ length: 150000 }, (_, index) => ({ before: index + 1, after: index + 2 })),
    redo: [],
  }
  const next = nextDocumentNavigation(previous, snapshot(150001), snapshot(150002), [
    restore("undo", 1),
  ])
  expect(next.undo).toHaveLength(0)
  expect(next.redo).toHaveLength(150000)
  expect(next.redo.at(-1)).toEqual({ before: 1, after: 2 })
  expect(documentNavigationSchema.safeParse(next).success).toBe(true)
})
