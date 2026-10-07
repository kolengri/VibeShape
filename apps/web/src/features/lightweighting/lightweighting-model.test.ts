import {
  createAngleQuantity,
  createLengthQuantity,
  documentIdSchema,
  featureIdSchema,
  projectDocumentSnapshotV1ToV0,
} from "@vibeshape/domain"
import type { HistoryItemRef } from "@vibeshape/domain/document-node"
import { projectDocumentSnapshotV2ToV1 } from "@vibeshape/domain/document-v2"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import type { DocumentControllerState } from "../../document/document-controller"
import {
  authoredTestBody,
  authoredTestId,
  authoredTreeFixture,
  requireAuthoredFixture,
} from "../../test-support/authored-tree-fixture"
import {
  availableLightweightingParts,
  lightweightingSource,
  sameLightweightingSource,
} from "./lightweighting-model"

function placementFixture(failed = false) {
  const base = authoredTreeFixture().authority
  const box = requireAuthoredFixture(base.features[0])
  const placementId = featureIdSchema.parse(authoredTestId(910))
  const envelope = {
    schemaVersion: 2,
    commandId: authoredTestId(900),
    documentId: base.id,
    baseRevision: base.revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
  const inserted = applyDocumentV2Command(base, {
    ...envelope,
    kind: "org.vibeshape.document.model-command",
    payload: {
      command: {
        ...envelope,
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: {
          historyAfter: base.history[0],
          feature: {
            schemaVersion: 0,
            id: placementId,
            type: placementFeatureType.type,
            parameters: {
              targetBody: { schemaVersion: 0, featureId: box.id, outputRole: "result" },
              translation: {
                x: createLengthQuantity(10),
                y: createLengthQuantity(0),
                z: createLengthQuantity(0),
              },
              rotation: {
                x: createAngleQuantity(0),
                y: createAngleQuantity(0),
                z: createAngleQuantity(0),
              },
            },
            dependencies: [box.id],
            references: [],
            suppressed: false,
          },
        },
      },
      partAllocations: [],
    },
  })
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.diagnostic))
  const authority = inserted.snapshot
  const part = requireAuthoredFixture(authority.parts[0])
  const sample = authoredTestBody(part)
  const projected = projectDocumentSnapshotV1ToV0(projectDocumentSnapshotV2ToV1(authority))
  if (!projected.ok) throw new Error(JSON.stringify(projected.diagnostic))
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: "lightweighting-cursor-test",
    documentId: authority.id,
    revision: authority.revision,
    generation: 1,
    evaluation: {
      records: authority.features.map(({ id }) =>
        failed && id === placementId
          ? {
              featureId: id,
              status: "failed",
              diagnostics: [{ code: "org.vibeshape.test.placement-failed", values: {} }],
            }
          : { featureId: id, status: "succeeded", contentHash: sample.contentHash },
      ),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: authority.features.map(({ id }) => id),
      reusedFeatureIds: [],
    },
    geometry: authority.features
      .filter(({ id }) => !failed || id !== placementId)
      .map(({ id }) => ({
        featureId: id,
        contentHash: sample.contentHash,
        meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
        geometry: {
          engine: {
            adapter: "replicad",
            adapterVersion: "test",
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
                adapterVersion: "test",
                kernelId: "org.opencascade.occt",
                kernelVersion: "0.23.0",
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
            {
              outputRole: "result",
              shape: sample.shape,
              mesh: sample.mesh,
              topologyCandidates: [],
            },
          ],
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      })),
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("The fixture requires rebuild evidence.")
  const controller: DocumentControllerState = {
    status: "ready",
    saveStatus: "saved",
    diagnostic: null,
    authoredSnapshot: authority,
    report: {
      status: "created",
      mode: "read-write",
      snapshot: projected.snapshot,
      historyItems: authority.history,
      rebuild: { ok: true, response },
      lostRevisionCount: 0,
      corruptRecords: [],
      migration: null,
      writeAccessDiagnostic: null,
    },
  }
  const at = (historyAfter: HistoryItemRef | null): DocumentControllerState => ({
    ...controller,
    historyInsertion: {
      documentId: authority.id,
      baseRevision: authority.revision,
      historyAfter,
    },
  })
  return { authority, controller, at, part, box, placementId }
}

describe("Lightweighting insertion source boundary", () => {
  it("uses the earlier successful binding before Placement and excludes later Parts", () => {
    const { authority, controller, at, part, box, placementId } = placementFixture()
    const anchor = requireAuthoredFixture(authority.history[0])
    const scoped = at(anchor)
    expect(availableLightweightingParts(scoped).map(({ part }) => part.id)).toEqual([part.id])
    expect(lightweightingSource(scoped, part.id)).toMatchObject({
      featureId: box.id,
      context: { historyAfter: anchor },
    })
    expect(lightweightingSource(scoped, requireAuthoredFixture(authority.parts[1]).id)).toBeNull()
    expect(lightweightingSource(scoped, part.id, "full")).toMatchObject({
      featureId: placementId,
      context: { historyAfter: authority.history.at(-1) },
    })
    expect(availableLightweightingParts(scoped, "full")).toEqual(
      availableLightweightingParts(controller),
    )
    expect(availableLightweightingParts(at(null))).toEqual([])
  })

  it("rejects an earlier fallback when the last binding inside the prefix failed", () => {
    const { authority, at, part } = placementFixture(true)
    expect(
      lightweightingSource(at(requireAuthoredFixture(authority.history[0])), part.id),
    ).not.toBeNull()
    const afterPlacement = at(requireAuthoredFixture(authority.history[1]))
    expect(lightweightingSource(afterPlacement, part.id)).toBeNull()
    expect(lightweightingSource(afterPlacement, part.id, "full")).toBeNull()
  })

  it("invalidates the same body when the insertion anchor moves at the same revision", () => {
    const { authority, at, part } = placementFixture()
    const source = requireAuthoredFixture(
      lightweightingSource(at(requireAuthoredFixture(authority.history[1])), part.id) ?? undefined,
    )
    const unchanged = lightweightingSource(
      at({ ...requireAuthoredFixture(authority.history[1]) }),
      part.id,
    )
    const moved = lightweightingSource(at(requireAuthoredFixture(authority.history[2])), part.id)
    expect(moved?.featureId).toBe(source.featureId)
    expect(moved?.contentHash).toBe(source.contentHash)
    expect(sameLightweightingSource(unchanged, source)).toBe(true)
    expect(sameLightweightingSource(moved, source)).toBe(false)
    expect(sameLightweightingSource(null, source)).toBe(false)
  })

  it("uses full History after an invalid cursor without capturing a stale anchor", () => {
    const { controller, at, part, box } = placementFixture()
    const stale = at({ kind: "feature", id: featureIdSchema.parse(authoredTestId(999)) })
    const differentDocument = {
      ...at({ kind: "feature", id: box.id }),
      historyInsertion: {
        documentId: documentIdSchema.parse(authoredTestId(998)),
        baseRevision: 0,
        historyAfter: null,
      },
    }
    expect(lightweightingSource(stale, part.id)).toEqual(lightweightingSource(controller, part.id))
    expect(lightweightingSource(differentDocument, part.id)).toEqual(
      lightweightingSource(controller, part.id),
    )
  })
})
