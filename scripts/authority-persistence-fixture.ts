import {
  applyDocumentUpgradeV2Command,
  applyDocumentV2Command,
  applyVersionedDocumentCommand,
  boxFeatureType,
  createLengthQuantity,
} from "../packages/domain/src/index"

export const authorityId = (n: number) =>
  `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
export const authorityTimestamp = "2026-10-03T00:00:00Z"
export function evidenceValue<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
export function authorityEnvelope(revision: number) {
  return {
    commandId: authorityId(revision + 10),
    documentId: authorityId(1),
    baseRevision: revision,
    issuedAt: authorityTimestamp,
    actor: { type: "user", userId: null },
  }
}
export function authorityFixture() {
  const created = evidenceValue(
    applyVersionedDocumentCommand(null, {
      ...authorityEnvelope(0),
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      payload: { name: "Assembly" },
    }),
  )
  const added = evidenceValue(
    applyVersionedDocumentCommand(created.snapshot, {
      ...authorityEnvelope(1),
      schemaVersion: 1,
      kind: "org.vibeshape.history.insert-feature",
      payload: {
        historyAfter: null,
        feature: {
          schemaVersion: 0,
          id: authorityId(200),
          type: boxFeatureType.type,
          label: "Housing",
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
    }),
  )
  const upgraded = evidenceValue(
    applyDocumentUpgradeV2Command(added.snapshot, {
      ...authorityEnvelope(2),
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: {
        partAllocations: [
          {
            id: authorityId(100),
            name: "Housing",
            origin: "independent",
            body: { schemaVersion: 0, featureId: authorityId(200), outputRole: "result" },
          },
        ],
      },
    }),
  )
  const renamed = evidenceValue(
    applyDocumentV2Command(upgraded.snapshot, {
      ...authorityEnvelope(3),
      schemaVersion: 2,
      kind: "org.vibeshape.document.metadata-command",
      payload: { kind: "part.rename", partId: authorityId(100), name: "Cover" },
    }),
  )
  return { created, upgraded, added, renamed }
}
