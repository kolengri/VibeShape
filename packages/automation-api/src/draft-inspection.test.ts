import { modelEdgeEvidenceSchema } from "@vibeshape/domain/model-edges"
import { describe, expect, it } from "vitest"
import {
  automationDraftEdgeEvidenceSchema,
  automationDraftInspectionRequestSchema,
  automationDraftInspectionViewSchema,
} from "./draft-inspection"
import { localOperationSchema } from "./local-tools"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftId = "0195b5ac-b216-7a2c-bc33-67a36a7f21ac"
const featureId = "0195b5ac-b217-7a2c-8c33-67a36a7f21ac"

const draft = {
  schemaVersion: 1 as const,
  draftId,
  documentId,
  baseRevision: 3,
  revision: 4,
  commandCount: 1,
  expiresAt: "2026-09-07T12:05:00.000Z",
}

const listQuery = {
  kind: "org.vibeshape.cad.inspection.list" as const,
  schemaVersion: 1 as const,
  documentId,
  revision: 4,
  cursor: null,
  limit: 10,
}

const edgeSignature = {
  kind: "edge" as const,
  geometryClass: "LINE",
  measure: 1,
  centroid: [0, 0, 0] as [number, number, number],
  bounds: {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 0, 0] as [number, number, number],
  },
  direction: [1, 0, 0] as [number, number, number],
  directionMode: "oriented" as const,
  boundaryCount: 2,
  adjacentGeometryClasses: [],
}

function edgeEvidence(candidateCount: number, candidateIdLength = 8) {
  return {
    schemaVersion: 1 as const,
    documentId,
    revision: 4,
    generation: 1,
    rebuildId: "rebuild-1",
    featureId,
    contentHash: "0".repeat(64),
    candidates: Array.from({ length: candidateCount }, (_, index) => ({
      candidateId: `${String(index).padStart(5, "0")}${"x".repeat(candidateIdLength)}`,
      kind: "edge" as const,
      lineageTokens: [],
      signature: edgeSignature,
    })),
  }
}

describe("draft inspection contracts", () => {
  it("accepts an exact request envelope and rejects unknown or mismatched fields", () => {
    expect(
      automationDraftInspectionRequestSchema.safeParse({
        schemaVersion: 1,
        draftId,
        query: listQuery,
      }).success,
    ).toBe(true)
    expect(
      automationDraftInspectionRequestSchema.safeParse({
        schemaVersion: 1,
        draftId,
        query: { ...listQuery, hiddenState: true },
      }).success,
    ).toBe(false)
    expect(
      automationDraftInspectionRequestSchema.safeParse({
        schemaVersion: 1,
        draftId,
        query: { ...listQuery, revision: 3 },
      }).success,
    ).toBe(true)
    expect(
      automationDraftInspectionRequestSchema.safeParse({
        schemaVersion: 1,
        draftId,
        query: { ...listQuery, revision: Number.NaN },
      }).success,
    ).toBe(false)
  })

  it("requires result views to repeat the exact document and revision", () => {
    const view = {
      schemaVersion: 1 as const,
      draft,
      view: {
        kind: listQuery.kind,
        schemaVersion: 1 as const,
        documentId,
        revision: 4,
        classification: "semantic" as const,
        nextCursor: null,
        data: { items: [], total: 0 },
      },
    }
    expect(automationDraftInspectionViewSchema.safeParse(view).success).toBe(true)
    expect(
      automationDraftInspectionViewSchema.safeParse({
        ...view,
        view: { ...view.view, revision: 3 },
      }).success,
    ).toBe(false)
    expect(
      automationDraftInspectionViewSchema.safeParse({
        ...view,
        draft: { ...draft, documentId: "0195b5ac-b218-7a2c-8c33-67a36a7f21ac" },
      }).success,
    ).toBe(false)
  })

  it("enforces the detached edge evidence budget at the schema boundary", () => {
    expect(automationDraftEdgeEvidenceSchema.safeParse(edgeEvidence(1)).success).toBe(true)
    const oversized = edgeEvidence(10_000, 251)
    expect(modelEdgeEvidenceSchema.safeParse(oversized).success).toBe(true)
    const bounded = automationDraftEdgeEvidenceSchema.safeParse(oversized)
    expect(bounded.success).toBe(false)
    if (!bounded.success)
      expect(bounded.error.issues).toEqual([
        expect.objectContaining({
          message: "Draft edge evidence exceeds the 4 MiB catalog limit.",
        }),
      ])
  })

  it.each([
    ["draft_tree", { draftId, revision: 4 }],
    ["draft_variables", { draftId, revision: 4 }],
    ["draft_edges", { draftId, revision: 4, featureId }],
  ] as const)("applies named tool defaults for %s", (tool, arguments_) => {
    const result = localOperationSchema.parse({ tool, arguments: arguments_ })
    expect(result.arguments).toMatchObject({
      cursor: null,
      limit: tool === "draft_edges" ? 20 : 100,
    })
  })

  it("keeps draft entity inputs strict and requires a typed entity", () => {
    expect(
      localOperationSchema.safeParse({
        tool: "draft_entity",
        arguments: { draftId, revision: 4, entity: { kind: "feature", id: featureId } },
      }).success,
    ).toBe(true)
    expect(
      localOperationSchema.safeParse({
        tool: "draft_entity",
        arguments: { draftId, revision: 4, entity: { kind: "feature", id: featureId }, limit: 10 },
      }).success,
    ).toBe(false)
  })
})
