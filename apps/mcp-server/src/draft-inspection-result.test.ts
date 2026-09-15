import {
  type LocalDraftInspectionOperation,
  localOperationSchema,
} from "@vibeshape/automation-api/local-tools"
import { describe, expect, it } from "vitest"
import { draftInspectionMatches } from "./draft-inspection-result"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const draftSeed = localOperationSchema.parse({
  tool: "draft_tree",
  arguments: { draftId: "0195b5ac-b216-7a2c-bc33-67a36a7f21ac", revision: 4 },
})
if (draftSeed.tool !== "draft_tree") throw new Error("Invalid draft fixture")
const draftId = draftSeed.arguments.draftId
const featureSeed = localOperationSchema.parse({
  tool: "draft_edges",
  arguments: {
    draftId: "0195b5ac-b216-7a2c-bc33-67a36a7f21ac",
    revision: 4,
    featureId: "0195b5ac-b217-7a2c-8c33-67a36a7f21ac",
  },
})
if (featureSeed.tool !== "draft_edges") throw new Error("Invalid feature fixture")
const featureId = featureSeed.arguments.featureId
const otherFeatureSeed = localOperationSchema.parse({
  tool: "draft_edges",
  arguments: {
    draftId: "0195b5ac-b216-7a2c-bc33-67a36a7f21ac",
    revision: 4,
    featureId: "0195b5ac-b219-7a2c-8c33-67a36a7f21ac",
  },
})
if (otherFeatureSeed.tool !== "draft_edges") throw new Error("Invalid feature fixture")
const otherFeatureId = otherFeatureSeed.arguments.featureId

const draft = {
  schemaVersion: 1 as const,
  draftId,
  documentId,
  baseRevision: 3,
  revision: 4,
  commandCount: 1,
  expiresAt: "2026-09-07T12:05:00.000Z",
}

function operation<T extends LocalDraftInspectionOperation>(operation: T) {
  return operation
}

const treeOperation = operation({
  tool: "draft_tree",
  arguments: { draftId, revision: 4, cursor: null, limit: 10 },
})
const variablesOperation = operation({
  tool: "draft_variables",
  arguments: { draftId, revision: 4, cursor: null, limit: 10 },
})
const entityOperation = operation({
  tool: "draft_entity",
  arguments: { draftId, revision: 4, entity: { kind: "feature", id: featureId } },
})
const edgeOperation = operation({
  tool: "draft_edges",
  arguments: { draftId, revision: 4, featureId, cursor: null, limit: 10 },
})

function result(view: Record<string, unknown>) {
  return { schemaVersion: 1, draft, view }
}

function treeResult(items: unknown[] = []) {
  return result({
    kind: "org.vibeshape.cad.inspection.list",
    schemaVersion: 1,
    documentId,
    revision: 4,
    classification: "semantic",
    nextCursor: null,
    data: { items, total: items.length },
  })
}

function variablesResult(variables: unknown[] = []) {
  return result({
    kind: "org.vibeshape.variable.list",
    schemaVersion: 1,
    documentId,
    revision: 4,
    classification: "semantic",
    nextCursor: null,
    data: { variables },
  })
}

const edgeResult = result({
  kind: "org.vibeshape.model.edges",
  schemaVersion: 1,
  documentId,
  revision: 4,
  generation: 1,
  rebuildId: "rebuild-1",
  featureId,
  contentHash: "0".repeat(64),
  classification: "derived",
  nextCursor: null,
  data: { edges: [], total: 0 },
})

const treeItem = {
  kind: "feature" as const,
  id: featureId,
  type: "org.vibeshape.test.box",
  version: 1,
  dependencies: [],
}

const featureRecord = {
  schemaVersion: 0 as const,
  id: featureId,
  type: {
    moduleId: "org.vibeshape.test",
    moduleVersion: "1.0.0",
    typeId: "org.vibeshape.test.box",
    schemaVersion: 1,
  },
  parameters: {},
  dependencies: [],
  references: [],
  suppressed: false,
}

describe("draft inspection result correlation", () => {
  it.each([
    ["tree", treeOperation, treeResult()],
    ["variables", variablesOperation, variablesResult()],
    [
      "entity",
      entityOperation,
      result({
        kind: "org.vibeshape.cad.inspection.detail",
        schemaVersion: 1,
        documentId,
        revision: 4,
        classification: "semantic",
        data: { entityKind: "feature", record: featureRecord },
      }),
    ],
    ["edges", edgeOperation, edgeResult],
  ] as const)("accepts a paired %s result", (_name, operation_, value) => {
    expect(draftInspectionMatches(operation_, value, documentId)).toBe(true)
  })

  it("rejects mismatched document, draft, revision, kind, entity, feature, and page size", () => {
    expect(draftInspectionMatches(treeOperation, treeResult(), otherFeatureId)).toBe(false)
    expect(
      draftInspectionMatches(
        treeOperation,
        { ...treeResult(), draft: { ...draft, draftId: otherFeatureId } },
        documentId,
      ),
    ).toBe(false)
    expect(() =>
      draftInspectionMatches(
        variablesOperation,
        { ...variablesResult(), draft: { ...draft, revision: 3 } },
        documentId,
      ),
    ).toThrow()
    expect(draftInspectionMatches(treeOperation, variablesResult(), documentId)).toBe(false)
    expect(
      draftInspectionMatches(
        entityOperation,
        result({
          kind: "org.vibeshape.cad.inspection.detail",
          schemaVersion: 1,
          documentId,
          revision: 4,
          classification: "semantic",
          data: { entityKind: "feature", record: { ...featureRecord, id: otherFeatureId } },
        }),
        documentId,
      ),
    ).toBe(false)
    expect(
      draftInspectionMatches(
        edgeOperation,
        result({ ...edgeResult.view, featureId: otherFeatureId }),
        documentId,
      ),
    ).toBe(false)
    expect(
      draftInspectionMatches(
        treeOperation,
        treeResult(Array.from({ length: 11 }, () => treeItem)),
        documentId,
      ),
    ).toBe(false)
  })

  it("requires a matching rebuild and feature for a non-null edge cursor", () => {
    const pagedOperation = operation({
      tool: "draft_edges",
      arguments: {
        draftId,
        revision: 4,
        featureId,
        cursor: { rebuildId: "rebuild-1", featureId, offset: 1 },
        limit: 10,
      },
    })
    expect(draftInspectionMatches(pagedOperation, edgeResult, documentId)).toBe(true)
    expect(
      draftInspectionMatches(
        pagedOperation,
        result({
          ...edgeResult.view,
          rebuildId: "rebuild-1",
          nextCursor: { rebuildId: "rebuild-1", featureId, offset: 2 },
          data: { edges: [], total: 3 },
        }),
        documentId,
      ),
    ).toBe(true)
    expect(
      draftInspectionMatches(
        pagedOperation,
        result({ ...edgeResult.view, rebuildId: "other-rebuild", nextCursor: null }),
        documentId,
      ),
    ).toBe(false)
  })
})
