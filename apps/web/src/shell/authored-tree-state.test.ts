import { describe, expect, it } from "bun:test"
import { type HistoryFolder, historyItemKey } from "@vibeshape/domain/history-folders"
import { featureIdSchema, historyFolderIdSchema } from "@vibeshape/domain/identifiers"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import type { DocumentControllerState } from "../document/document-controller"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../test-support/authored-tree-fixture"
import {
  authoredBodyKeys,
  currentAuthoredParts,
  folderItemsWithSelection,
  folderRangeItems,
  groupFolderHistory,
  selectedAuthoredBody,
  selectedFolderItems,
} from "./authored-tree-state"
import { historyInsertionContext } from "./history-insertion-context"

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

function projectionFixture() {
  const { authority, snapshot } = authoredTreeFixture()
  const sample = authoredTestBody(requireAuthoredFixture(authority.parts[0]))
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "authored-tree-projection-test",
    documentId: authority.id,
    revision: authority.revision,
    generation: 1,
    evaluation: {
      records: authority.features.map(({ id }) => ({
        featureId: id,
        status: "succeeded",
        contentHash: sample.contentHash,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [],
      reusedFeatureIds: [],
    },
    geometry: authority.features.map(({ id }) => ({
      featureId: id,
      contentHash: sample.contentHash,
      meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
      geometry: {
        engine: {
          adapter: "replicad",
          adapterVersion: "test-build",
          replicadVersion: "0.23.1",
          opencascadePackageVersion: "0.23.0",
          opencascadeSourceRevision: null,
          wasmBytes: 1,
          initializedInMs: 1,
          featureContentEnvironment: {
            schemaVersion: 0,
            hostApiVersion: "0.1.0",
            geometry: {
              adapterId: "org.vibeshape.geometry.replicad",
              adapterVersion: "test-build",
              kernelId: "org.opencascade.occt",
              kernelVersion: "7.9.2",
              kernelSourceRevision: null,
            },
            modelingTolerancePolicyVersion: 1,
            provider: { kind: "built-in" },
          },
        },
        shape: sample.shape,
        mesh: sample.mesh,
        topologyCandidates: [],
        bodies: [
          { outputRole: "result", shape: sample.shape, mesh: sample.mesh, topologyCandidates: [] },
        ],
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
      },
    })),
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Expected rebuild fixture.")
  const geometry = response.geometry
  let geometryReads = 0
  const report: NonNullable<DocumentControllerState["report"]> = {
    status: "clean",
    mode: "read-write",
    snapshot,
    historyItems: authority.history,
    rebuild: {
      ok: true,
      response: {
        ...response,
        get geometry() {
          geometryReads += 1
          return geometry
        },
      },
    },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  }
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    report,
    authoredSnapshot: authority,
  }
  return {
    authority,
    report,
    response,
    controller,
    get geometryReads() {
      return geometryReads
    },
  }
}

describe("shared immutable authored part projection", () => {
  it("resolves once for 69 History rows and controller-only hover updates", () => {
    const state = projectionFixture()
    const first = currentAuthoredParts(state.controller)
    expect(first.map(({ status }) => status)).toEqual(["available", "available", "available"])
    for (let row = 0; row < 69; row += 1) {
      expect(currentAuthoredParts({ ...state.controller, saveStatus: "saving" })).toBe(first)
    }
    expect(state.geometryReads).toBe(1)
  })

  it("invalidates for metadata-only authority changes at the same document/revision and can restore the old snapshot", () => {
    const { controller, authority } = projectionFixture()
    const first = currentAuthoredParts(controller)
    const renamed = {
      ...authority,
      parts: authority.parts.map((part, index) =>
        index === 0 ? { ...part, name: "Renamed housing", visible: false } : part,
      ),
    }
    const next = currentAuthoredParts({ ...controller, authoredSnapshot: renamed })
    expect(next).not.toBe(first)
    expect(next[0]?.part.name).toBe("Renamed housing")
    expect(next[0]?.part.visible).toBe(false)
    expect(selectedAuthoredBody(next, authority.parts[0]?.id ?? null)).toBeNull()
    expect(first[0]?.part.name).toBe("Part 1")
    expect(currentAuthoredParts(controller)).toBe(first)
    expect(
      currentAuthoredParts({
        ...controller,
        authoredSnapshot: { ...authority, variables: [...authority.variables] },
      }),
    ).not.toBe(first)
  })

  it("invalidates for replacement geometry/evaluation reports even at identical IDs and revision", () => {
    const { controller, report, response } = projectionFixture()
    const first = currentAuthoredParts(controller)
    const rebuilt = {
      ...report,
      rebuild: {
        ok: true as const,
        response: {
          ...response,
          generation: 2,
          geometry: response.geometry.map((record) => ({
            ...record,
            geometry: {
              ...record.geometry,
              shape: { ...record.geometry.shape, volume: 100 },
              bodies: record.geometry.bodies?.map((body) => ({
                ...body,
                shape: { ...body.shape, volume: 100 },
              })),
            },
          })),
        },
      },
    }
    const next = currentAuthoredParts({ ...controller, report: rebuilt })
    expect(next).not.toBe(first)
    expect(next[0]?.body?.shape.volume).toBe(100)
    expect(first[0]?.body?.shape.volume).toBe(24000)
    expect(currentAuthoredParts(controller)).toBe(first)
    const failed = currentAuthoredParts({
      ...controller,
      report: {
        ...report,
        rebuild: {
          ok: true,
          response: {
            ...response,
            evaluation: {
              ...response.evaluation,
              records: response.evaluation.records.map((record) => ({
                featureId: record.featureId,
                status: "suppressed" as const,
              })),
            },
            geometry: [],
          },
        },
      },
    })
    expect(failed.map(({ status, body }) => [status, body])).toEqual([
      ["unavailable", null],
      ["unavailable", null],
      ["unavailable", null],
    ])
  })

  it("separates Before reports from full authority and restores the full projection", () => {
    const { controller, authority } = projectionFixture()
    const full = currentAuthoredParts(controller)
    const beforeController = historyInsertionContext({
      ...controller,
      historyInsertion: {
        documentId: authority.id,
        baseRevision: authority.revision,
        historyAfter: requireAuthoredFixture(authority.history[0]),
      },
    })
    const before = currentAuthoredParts(beforeController)
    expect(before).not.toBe(full)
    expect(before.map(({ status }) => status)).toEqual(["available", "unavailable", "unavailable"])
    expect(currentAuthoredParts({ ...beforeController })).toBe(before)
    const beginning = historyInsertionContext({
      ...controller,
      historyInsertion: {
        documentId: authority.id,
        baseRevision: authority.revision,
        historyAfter: null,
      },
    })
    expect(currentAuthoredParts(beginning).every(({ body }) => body === null)).toBe(true)
    expect(currentAuthoredParts(controller)).toBe(full)
  })

  it("caches unavailable/consumed fallback without confusing it with recovery or output roles", () => {
    const { controller, report, response, authority } = projectionFixture()
    const consumed = {
      ...authority,
      parts: authority.parts.map((part, index) =>
        index === 0
          ? { ...part, consumedBy: requireAuthoredFixture(authority.features[1]).id }
          : part,
      ),
    }
    const invalid = {
      ...report,
      rebuild: { ok: true as const, response: { ...response, geometry: [] } },
    }
    const unavailable = currentAuthoredParts({
      ...controller,
      authoredSnapshot: consumed,
      report: invalid,
    })
    expect(unavailable.map(({ status }) => status)).toEqual([
      "consumed",
      "unavailable",
      "unavailable",
    ])
    expect(
      currentAuthoredParts({ ...controller, authoredSnapshot: consumed, report: invalid }),
    ).toBe(unavailable)
    expect(currentAuthoredParts(controller)[0]?.status).toBe("available")
    const ambiguous = {
      ...report,
      rebuild: {
        ok: true as const,
        response: {
          ...response,
          geometry: [...response.geometry, requireAuthoredFixture(response.geometry[0])],
        },
      },
    }
    expect(
      currentAuthoredParts({ ...controller, report: ambiguous }).every(({ body }) => body === null),
    ).toBe(true)
    const wrongRole = {
      ...report,
      rebuild: {
        ok: true as const,
        response: {
          ...response,
          geometry: response.geometry.map((record) => ({
            ...record,
            geometry: {
              ...record.geometry,
              bodies: record.geometry.bodies?.map((body) => ({ ...body, outputRole: "other" })),
            },
          })),
        },
      },
    }
    expect(
      currentAuthoredParts({ ...controller, report: wrongRole }).every(({ body }) => body === null),
    ).toBe(true)
    expect(currentAuthoredParts({ ...controller, report: null })).toEqual([])
    expect(currentAuthoredParts({ ...controller, authoredSnapshot: null })).toEqual([])
    expect(
      currentAuthoredParts({
        ...controller,
        authoredSnapshot: { ...authority, revision: authority.revision + 1 },
      }),
    ).toEqual([])
  })
})

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
