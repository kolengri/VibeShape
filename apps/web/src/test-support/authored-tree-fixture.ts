import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import {
  applyVersionedDocumentCommand,
  boxFeatureType,
  createLengthQuantity,
  projectDocumentSnapshotV1ToV0,
} from "@vibeshape/domain"
import {
  type DocumentSnapshotV2,
  projectDocumentSnapshotV2ToV1,
} from "@vibeshape/domain/document-v2"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import type { PartRecord } from "@vibeshape/domain/parts"
import { selectModelTreeHistory } from "../shell/model-tree-history"

export const authoredTestId = (suffix: number) =>
  `0195b5ac-b220-7a2c-8c33-${suffix.toString(16).padStart(12, "0")}`
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function envelope(revision: number) {
  return {
    schemaVersion: 2,
    commandId: authoredTestId(revision + 10),
    documentId: authoredTestId(1),
    baseRevision: revision,
    issuedAt: "2026-10-03T00:00:00Z",
    actor: { type: "user", userId: null },
  }
}
export function authoredTreeFixture() {
  const legacy = success(
    applyVersionedDocumentCommand(null, {
      ...envelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Parts" },
    }),
  ).snapshot
  let authority: DocumentSnapshotV2 = success(
    applyDocumentUpgradeV2Command(legacy, {
      ...envelope(legacy.revision),
      kind: "org.vibeshape.document.upgrade-v2",
      payload: { partAllocations: [] },
    }),
  ).snapshot
  for (const index of [0, 1, 2]) {
    const featureId = authoredTestId(100 + index)
    const command = {
      ...envelope(authority.revision),
      schemaVersion: 1,
      kind: "org.vibeshape.history.insert-feature",
      payload: {
        historyAfter: authority.history.at(-1) ?? null,
        feature: {
          schemaVersion: 0,
          id: featureId,
          type: boxFeatureType.type,
          label: `Box ${index + 1}`,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(30),
            height: createLengthQuantity(40),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    }
    authority = success(
      applyDocumentV2Command(authority, {
        ...envelope(authority.revision),
        kind: "org.vibeshape.document.model-command",
        payload: {
          command,
          partAllocations: [
            {
              id: authoredTestId(200 + index),
              name: `Part ${index + 1}`,
              origin: "independent",
              body: { schemaVersion: 0, featureId, outputRole: "result" },
            },
          ],
        },
      }),
    ).snapshot
  }
  const snapshot = success(
    projectDocumentSnapshotV1ToV0(projectDocumentSnapshotV2ToV1(authority)),
  ).snapshot
  return {
    authority,
    snapshot,
    rows: selectModelTreeHistory(snapshot, undefined, undefined, authority.history).rows,
  }
}
export function authoredTestBody(part: PartRecord): ModelBodyGeometry {
  const binding = part.bodyHistory.at(-1)
  if (!binding) throw new Error("A part fixture needs a body binding.")
  return {
    featureId: binding.featureId,
    outputRole: binding.outputRole,
    contentHash: "a".repeat(64),
    shape: {
      valid: true,
      volume: 24000,
      surfaceArea: 5200,
      solidCount: 1,
      faceCount: 6,
      edgeCount: 12,
      bounds: { min: [0, 0, 0], max: [20, 30, 40] },
    },
    mesh: {
      positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 30, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      triangleFaceIds: new Uint32Array([1]),
    },
    topologyCandidates: [],
  }
}

export function requireAuthoredFixture<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The authored fixture is missing a required item.")
  return value
}
