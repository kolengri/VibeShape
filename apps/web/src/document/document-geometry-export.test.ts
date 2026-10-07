import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { projectAuthoredDocumentSnapshotToV1 } from "@vibeshape/domain/document-v2"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { applyHistoryRemoveRetainingDependentsCommand } from "@vibeshape/domain/document-v5-commands"
import {
  createDefaultSurfaceTextureLayer,
  surfaceTextureLayerIdSchema,
} from "@vibeshape/domain/surface-textures"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  historyRepairFixture,
  repairId,
  repairRemovalCommand,
} from "../../../../packages/domain/src/history-repair.test-fixture"
import { authoredTestBody } from "../test-support/authored-tree-fixture"
import { prepareDocumentGeometryExport } from "./document-geometry-export"

function fixture() {
  const before = historyRepairFixture()
  const feature = before.features[3]
  if (!feature) throw new Error("Missing independent feature fixture.")
  const layer = createDefaultSurfaceTextureLayer(
    feature.id,
    "result",
    surfaceTextureLayerIdSchema.parse(repairId(550)),
  )
  const removed = applyHistoryRemoveRetainingDependentsCommand(
    documentSnapshotV4Schema.parse({
      ...before,
      schemaVersion: 4,
      surfaceTextures: [layer],
      assets: [],
    }),
    repairRemovalCommand(before.revision),
  )
  if (!removed.ok) throw new Error(removed.diagnostic.message)
  const authority = removed.snapshot
  const projected = projectDocumentSnapshotV1ToV0(projectAuthoredDocumentSnapshotToV1(authority))
  if (!projected.ok) throw new Error(projected.diagnostic.message)
  const part = authority.parts[0]
  if (!part) throw new Error("Missing independent Part fixture.")
  const body = authoredTestBody(part)
  const response = documentWorkerResponseSchema.parse({
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: repairId(551),
    type: "documentRebuilt",
    documentId: authority.id,
    revision: authority.revision,
    generation: 1,
    evaluation: {
      records: [
        {
          featureId: repairId(3),
          status: "failed",
          diagnostics: [{ code: "org.vibeshape.feature.missing-input", values: {} }],
        },
        { featureId: repairId(4), status: "blocked", blockedBy: [repairId(3)] },
        { featureId: repairId(5), status: "blocked", blockedBy: [repairId(3)] },
        { featureId: feature.id, status: "succeeded", contentHash: body.contentHash },
      ],
      dirtyFeatureIds: [],
      evaluatedFeatureIds: [feature.id],
      reusedFeatureIds: [],
    },
    geometry: [
      {
        featureId: feature.id,
        contentHash: body.contentHash,
        meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
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
          shape: body.shape,
          mesh: body.mesh,
          topologyCandidates: [],
          bodies: [
            { outputRole: "result", shape: body.shape, mesh: body.mesh, topologyCandidates: [] },
          ],
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      },
    ],
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Unexpected fixture response.")
  const report: PersistentDocumentSessionReport = {
    status: "clean",
    mode: "read-write",
    snapshot: projected.snapshot,
    historyItems: authority.history,
    rebuild: { ok: true, response },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  }
  return { authority, report, layer, part }
}

describe("V5 independent textured export", () => {
  it.each(["stl", "3mf"] as const)(
    "includes authored relief in %s after retained History deletion",
    (format) => {
      const f = fixture()
      expect(f.authority.repairIntents).toHaveLength(3)
      const plan = prepareDocumentGeometryExport(f.authority, f.report, format, f.part.id)
      if (!plan.ok) throw new Error(plan.diagnostic.message)
      expect(plan.options.bodies).toEqual([
        { featureId: repairId(6), outputRole: "result", name: "Box" },
      ])
      expect(plan.options.surfaceTextures).toMatchObject([
        {
          featureId: repairId(6),
          outputRole: "result",
          layers: [{ id: f.layer.id, enabled: true }],
        },
      ])
      expect(prepareDocumentGeometryExport(f.authority, f.report, "step", f.part.id)).toMatchObject(
        { ok: true, options: { bodies: plan.options.bodies } },
      )
    },
  )
})
