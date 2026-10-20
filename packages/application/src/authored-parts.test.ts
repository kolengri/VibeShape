import { describe, expect, it } from "bun:test"
import { applyVersionedDocumentCommand, projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import {
  type DocumentSnapshotV2,
  documentSnapshotV2Schema,
  projectDocumentSnapshotV2ToV1,
} from "@vibeshape/domain/document-v2"
import {
  applyDocumentV2Command,
  reduceDocumentV2Event,
} from "@vibeshape/domain/document-v2-commands"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import type { FeatureEvaluationRecord } from "@vibeshape/domain/feature-graph"
import { cylinderFeatureType } from "@vibeshape/domain/part-design"
import { unionFeatureTypeV2 } from "@vibeshape/domain/part-design-body-combination"
import { patternFeatureType, patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { splitFeatureType } from "@vibeshape/domain/part-design-split"
import { type PartAllocation, partAllocationSchema } from "@vibeshape/domain/parts"
import { createLengthQuantity, createScalarQuantity } from "@vibeshape/domain/units"
import { DOCUMENT_PROTOCOL_VERSION, featureEvaluationEngineResultSchema } from "@vibeshape/protocol"
import {
  authoredPartExportBodies,
  resolveAuthoredParts,
  visibleAuthoredBodies,
} from "./authored-parts"
import { featureGeometryRecordSchema } from "./feature-rebuild"
import type { PersistentDocumentSessionReport } from "./persistent-document-session"

const id = (suffix: number) => `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
const hash = "a".repeat(64)
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    schemaVersion: 2,
    documentId: id(1),
    commandId: id(1000 + revision),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
function body(featureId: string, outputRole: string) {
  return { schemaVersion: 0 as const, featureId, outputRole }
}
function model(
  snapshot: DocumentSnapshotV2,
  kind: string,
  payload: unknown,
  partAllocations: readonly PartAllocation[] = [],
) {
  return success(
    applyDocumentV2Command(snapshot, {
      ...envelope(snapshot.revision),
      kind: "org.vibeshape.document.model-command",
      payload: {
        command: { ...envelope(snapshot.revision), schemaVersion: 1, kind, payload },
        partAllocations,
      },
    }),
  ).snapshot
}
function pattern(count: number, version = 1, expression: string | null = null, suppressed = false) {
  return {
    schemaVersion: 0,
    id: id(4),
    type: version === 1 ? patternFeatureType.type : patternFeatureTypeV2.type,
    dependencies: [id(3)],
    references: [],
    suppressed,
    parameters: {
      kind: "linear",
      targetBody: body(id(3), "split.negative"),
      count: createScalarQuantity(count, expression),
      axis: version === 1 ? "X" : { kind: "origin-axis", axis: "X" },
      spacing: createLengthQuantity(5),
    },
  }
}
function fixture(count = 32, version = 1, expression: string | null = null) {
  const created = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Cylinder Split Pattern" },
    }),
  ).snapshot
  let snapshot = success(
    applyDocumentUpgradeV2Command(created, {
      ...envelope(created.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  ).snapshot
  const features = [
    {
      schemaVersion: 0,
      id: id(2),
      type: cylinderFeatureType.type,
      dependencies: [],
      references: [],
      suppressed: false,
      parameters: {
        radius: createLengthQuantity(10),
        height: createLengthQuantity(20),
        centered: true,
      },
    },
    {
      schemaVersion: 0,
      id: id(3),
      type: splitFeatureType.type,
      dependencies: [id(2)],
      references: [],
      suppressed: false,
      parameters: {
        targetBody: body(id(2), "result"),
        plane: "XY",
        offset: createLengthQuantity(0),
      },
    },
    pattern(count, version, expression),
  ]
  if (expression)
    snapshot = model(snapshot, "org.vibeshape.variable.add", {
      variable: { schemaVersion: 0, id: id(700), name: "copies", expression: String(count) },
    })
  for (const [index, feature] of features.entries()) {
    const roots =
      index === 0
        ? ["result"]
        : index === 1
          ? ["split.positive"]
          : Array.from({ length: count - 1 }, (_, copy) => `pattern.instance.${copy + 1}`)
    snapshot = model(
      snapshot,
      "org.vibeshape.history.insert-feature",
      { feature, historyAfter: snapshot.history.at(-1) ?? null },
      roots.map((outputRole, copy) =>
        partAllocationSchema.parse({
          id: id(index === 2 ? 101 + copy : 10 + index),
          name: index === 2 ? `Copy ${copy + 1}` : index === 0 ? "Cylinder" : "Other half",
          origin: "independent",
          body: body(feature.id, outputRole),
        }),
      ),
    )
  }
  return snapshot
}
function setCount(snapshot: DocumentSnapshotV2, count: number) {
  return model(snapshot, "org.vibeshape.feature.update", { feature: pattern(count) })
}
function restore(
  snapshot: DocumentSnapshotV2,
  target: DocumentSnapshotV2,
  direction: "undo" | "redo",
) {
  return success(
    reduceDocumentV2Event(
      snapshot,
      {
        ...envelope(snapshot.revision),
        type: "org.vibeshape.document.restored",
        transactionId: null,
        revision: snapshot.revision + 1,
        direction,
        targetRevision: target.revision,
      },
      target,
    ),
  ).snapshot
}

const shape = {
  valid: true,
  volume: 100,
  surfaceArea: 140,
  solidCount: 1,
  faceCount: 6,
  edgeCount: 12,
  bounds: { min: [0, 0, 0], max: [10, 10, 1] },
}
const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}
function geometry(featureId: string, roles: readonly string[]) {
  return featureGeometryRecordSchema.parse({
    featureId,
    contentHash: hash,
    meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
    geometry: featureEvaluationEngineResultSchema.parse({
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
      shape: { ...shape, solidCount: roles.length, volume: shape.volume * roles.length },
      mesh,
      topologyCandidates: [],
      bodies: roles.map((outputRole) => ({ outputRole, shape, mesh, topologyCandidates: [] })),
      cache: { brepHit: false },
      timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
    }),
  })
}
function report(
  authority: DocumentSnapshotV2,
  count: number,
  patternStatus: "succeeded" | "failed" | "suppressed" = "succeeded",
): PersistentDocumentSessionReport {
  const snapshot = success(
    projectDocumentSnapshotV1ToV0(projectDocumentSnapshotV2ToV1(authority)),
  ).snapshot
  const records: FeatureEvaluationRecord[] = snapshot.features.map(({ id: featureId }) =>
    featureId !== id(4) || patternStatus === "succeeded"
      ? { featureId, status: "succeeded", contentHash: hash }
      : patternStatus === "suppressed"
        ? { featureId, status: "suppressed" }
        : {
            featureId,
            status: "failed",
            diagnostics: [{ code: "org.vibeshape.geometry.operation-failed", values: {} }],
          },
  )
  return {
    snapshot,
    status: "clean",
    mode: "read-write",
    historyItems: authority.history,
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
    rebuild: {
      ok: true,
      response: {
        protocolVersion: DOCUMENT_PROTOCOL_VERSION,
        requestId: id(900),
        documentId: snapshot.id,
        revision: snapshot.revision,
        generation: 1,
        type: "documentRebuilt",
        evaluation: { records, dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
        geometry: records.flatMap((record) =>
          record.status !== "succeeded"
            ? []
            : [
                geometry(
                  record.featureId,
                  record.featureId === id(4)
                    ? Array.from({ length: count }, (_, index) => `pattern.instance.${index}`)
                    : record.featureId === id(3)
                      ? ["split.negative", "split.positive"]
                      : ["result"],
                ),
              ],
        ),
        sketches: [],
        modelReferenceEvidence: [],
      },
    },
  }
}

describe("current authored Pattern parts", () => {
  it("reuses validated topology while resolving current parts from unchanged rebuild records", () => {
    const authority = fixture(3)
    const current = report(authority, 3)
    const first = resolveAuthoredParts(authority, current)?.find(({ body }) => body)?.body
    if (!first) throw new Error("Expected an available fixture body.")
    const again = resolveAuthoredParts(authority, { ...current })?.find(({ body }) => body)?.body
    expect(again?.topologyCandidates).toBe(first.topologyCandidates)
    expect(again?.mesh).toBe(first.mesh)
  })

  it("validates replacement rebuild records instead of reusing geometry from a previous response", () => {
    const authority = fixture(3)
    const current = report(authority, 3)
    if (!current.rebuild.ok) throw new Error("Expected the report fixture to rebuild.")
    expect(resolveAuthoredParts(authority, current)).not.toBeNull()
    const invalid = {
      ...current,
      rebuild: {
        ok: true as const,
        response: {
          ...current.rebuild.response,
          generation: 2,
          geometry: current.rebuild.response.geometry.map((record) => ({
            ...record,
            contentHash: "invalid",
          })),
        },
      },
    }
    expect(resolveAuthoredParts(authority, invalid)).toBeNull()
    expect(resolveAuthoredParts(authority, current)).not.toBeNull()
  })

  it("uses replacement body geometry at the same feature identity after rebuilding", () => {
    const authority = fixture(3)
    const current = report(authority, 3)
    if (!current.rebuild.ok) throw new Error("Expected the report fixture to rebuild.")
    const before = resolveAuthoredParts(authority, current)?.find(({ body }) => body)?.body
    const rebuilt = {
      ...current,
      rebuild: {
        ok: true as const,
        response: {
          ...current.rebuild.response,
          generation: 2,
          geometry: current.rebuild.response.geometry.map((record) => ({
            ...record,
            geometry: {
              ...record.geometry,
              bodies: record.geometry.bodies?.map((body) => ({
                ...body,
                shape: { ...body.shape, volume: 200 },
              })),
            },
          })),
        },
      },
    }
    const after = resolveAuthoredParts(authority, rebuilt)?.find(({ body }) => body)?.body
    expect(before?.shape.volume).toBe(100)
    expect(after?.shape.volume).toBe(200)
    expect(after?.topologyCandidates).not.toBe(before?.topologyCandidates)
  })

  it("removes count-shrunk rows and restores captured identities and metadata on growth, Undo, Redo, and reopen", () => {
    let large = fixture()
    for (const payload of [
      { kind: "part.rename", partId: id(131), name: "Last copy" },
      { kind: "part.set-visibility", partId: id(131), visible: false },
    ])
      large = success(
        applyDocumentV2Command(large, {
          ...envelope(large.revision),
          kind: "org.vibeshape.document.metadata-command",
          payload,
        }),
      ).snapshot
    const small = setCount(large, 3)
    const original = resolveAuthoredParts(large, report(large, 32))
    const reduced = resolveAuthoredParts(small, report(small, 3))
    expect(original).toHaveLength(33)
    expect(reduced).toHaveLength(4)
    expect(reduced?.every(({ body, status }) => body && status === "available")).toBe(true)
    expect(reduced?.map(({ part }) => part.id)).toEqual<unknown>([id(10), id(11), id(101), id(102)])
    expect(small.parts).toHaveLength(33)
    expect(small.parts).toEqual(large.parts)
    const reopened = documentSnapshotV2Schema.parse(JSON.parse(JSON.stringify(small)))
    expect(resolveAuthoredParts(reopened, report(reopened, 3))).toEqual(reduced)
    const grown = setCount(reopened, 32)
    expect(resolveAuthoredParts(grown, report(grown, 32))).toEqual(original)
    const last = resolveAuthoredParts(grown, report(grown, 32))?.at(-1)
    expect(last?.part).toMatchObject({ id: id(131), name: "Last copy", visible: false })
    expect(last?.body?.outputRole).toBe("pattern.instance.31")
    const undone = restore(small, large, "undo")
    expect(resolveAuthoredParts(undone, report(undone, 32))).toEqual(original)
    const redone = restore(undone, small, "redo")
    expect(resolveAuthoredParts(redone, report(redone, 3))).toEqual(reduced)
    expect(authoredPartExportBodies(small, report(small, 3), id(131))).toBeNull()
    expect(authoredPartExportBodies(grown, report(grown, 32), id(131))).toEqual([
      { featureId: id(4), outputRole: "pattern.instance.31", name: "Last copy" },
    ])
    if (!last?.body) throw new Error("The restored hidden copy needs a current body.")
    expect(visibleAuthoredBodies([last.body], [last])).toEqual([])
  })

  it.each([1, 2])(
    "uses resolved variable count instead of the numeric fallback for Pattern v%s",
    (version) => {
      const large = fixture(6, version, "#copies")
      const small = model(large, "org.vibeshape.variable.set-expression", {
        variableId: id(700),
        expression: "2",
      })
      expect(resolveAuthoredParts(small, report(small, 2))).toHaveLength(3)
      const restored = model(small, "org.vibeshape.variable.set-expression", {
        variableId: id(700),
        expression: "6",
      })
      expect(
        resolveAuthoredParts(restored, report(restored, 6))?.map(({ part }) => part.id),
      ).toEqual(large.parts.map(({ id }) => id))
    },
  )

  it.each(["failed", "suppressed"] as const)(
    "retains actual unavailable outputs and seed fallback when Pattern is %s",
    (status) => {
      const small = setCount(fixture(6), 3)
      const authority =
        status === "suppressed"
          ? model(small, "org.vibeshape.feature.update", { feature: pattern(3, 1, null, true) })
          : small
      const parts = resolveAuthoredParts(authority, report(authority, 3, status))
      expect(parts).toHaveLength(4)
      expect(parts?.map(({ status }) => status)).toEqual([
        status === "suppressed" ? "available" : "upstream",
        "available",
        "unavailable",
        "unavailable",
      ])
      expect(parts?.[0]?.body?.outputRole).toBe("split.negative")
    },
  )

  it("preserves consumed part rows and exact sibling roles through downstream Union", () => {
    const snapshot = setCount(fixture(6), 3)
    const union = model(snapshot, "org.vibeshape.history.insert-feature", {
      historyAfter: snapshot.history.at(-1),
      feature: {
        schemaVersion: 0,
        id: id(5),
        type: unionFeatureTypeV2.type,
        parameters: {
          bodies: [body(id(4), "pattern.instance.0"), body(id(4), "pattern.instance.1")],
        },
        dependencies: [id(4)],
        references: [],
        suppressed: false,
      },
    })
    const parts = resolveAuthoredParts(union, report(union, 3))
    expect(parts).toHaveLength(4)
    expect(parts?.find(({ part }) => part.id === id(101))).toMatchObject({
      body: null,
      status: "consumed",
    })
    expect(parts?.find(({ part }) => part.id === id(10))?.body?.featureId).toEqual<unknown>(id(5))
    expect(parts?.find(({ part }) => part.id === id(102))?.body?.outputRole).toBe(
      "pattern.instance.2",
    )
  })

  it("retains real upstream statuses during History rollback and rejects a failed or stale rebuild", () => {
    const small = setCount(fixture(6), 3)
    const current = report(small, 3)
    if (!current.rebuild.ok) throw new Error("Expected the report fixture to rebuild.")
    const response = current.rebuild.response
    const rollback = {
      ...current,
      snapshot: {
        ...current.snapshot,
        features: current.snapshot.features.filter(({ id: featureId }) => featureId !== id(4)),
      },
      rebuild: {
        ok: true as const,
        response: {
          ...response,
          geometry: response.geometry.filter(({ featureId }) => featureId !== id(4)),
          evaluation: {
            ...response.evaluation,
            records: response.evaluation.records.filter(({ featureId }) => featureId !== id(4)),
          },
        },
      },
    }
    const parts = resolveAuthoredParts(small, rollback)
    expect(parts).toHaveLength(4)
    expect(parts?.map(({ status }) => status)).toEqual([
      "upstream",
      "available",
      "unavailable",
      "unavailable",
    ])
    expect(
      resolveAuthoredParts(small, {
        ...current,
        snapshot: { ...current.snapshot, revision: small.revision - 1 },
      }),
    ).toBeNull()
    expect(
      resolveAuthoredParts(small, {
        ...current,
        rebuild: {
          ok: false,
          diagnostic: {
            code: "rebuild-failed",
            message: "Worker stopped",
            retryable: true,
            sourceCode: null,
          },
        },
      }),
    ).toBeNull()
  })
})
