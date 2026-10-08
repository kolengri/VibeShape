import { describe, expect, it } from "bun:test"
import { applyDocumentV3Command } from "@vibeshape/domain"
import {
  surfaceTextureProjectFixture,
  textureFixtureEnvelope,
  textureSuccess,
} from "../../../tests/fixtures/surface-texture-project"
import {
  storeAuthorityEvent,
  storeAuthoritySnapshot,
  validAuthorityEvent,
  validAuthoritySnapshot,
} from "./authority-records"
import {
  portableProjectV3PayloadSchema,
  portableProjectV4ImportSchema,
  portableProjectV4PayloadSchema,
  projectRecordV2Schema,
  projectRecordV3Schema,
} from "./authority-schemas"

function project() {
  const fixture = surfaceTextureProjectFixture()
  const applied = textureSuccess(
    applyDocumentV3Command(fixture.snapshot, {
      ...textureFixtureEnvelope(3),
      schemaVersion: 3,
      kind: "org.vibeshape.document.metadata-command",
      payload: {
        kind: "textures.replace-layers",
        featureId: fixture.layer.featureId,
        layers: [fixture.layer],
      },
    }),
  )
  const {
    exportedAt: _exported,
    createdBy: _created,
    engine: _engine,
    ...payload
  } = fixture.portable
  return {
    ...fixture,
    applied,
    portable: {
      ...payload,
      snapshot: applied.snapshot,
      textureUpgradeRevision: 4,
      versionedEvents: [...fixture.events, applied.event],
    },
  }
}

describe("surface texture stored authority", () => {
  it("round-trips checksum-validated V3 snapshots/events and detects record corruption", async () => {
    const { applied } = project()
    const snapshot = await storeAuthoritySnapshot(applied.snapshot, applied.event.issuedAt)
    const event = await storeAuthorityEvent(applied.event, applied.event.issuedAt)
    expect(snapshot.schemaVersion).toBe(3)
    expect(await validAuthoritySnapshot(snapshot)).toEqual(applied.snapshot)
    expect(await validAuthorityEvent(event)).toEqual(applied.event)
    expect(await validAuthoritySnapshot({ ...snapshot, checksum: "0".repeat(64) })).toBeNull()
    expect(await validAuthoritySnapshot({ ...snapshot, schemaVersion: 2 })).toBeNull()
    expect(await validAuthorityEvent({ ...event, revision: event.revision + 1 })).toBeNull()
    await expect(validAuthoritySnapshot({ ...snapshot, schemaVersion: 99 })).rejects.toThrow(
      "different authority schema",
    )
  })

  it("validates V4 provenance and blocks old or checkpoint authority from writable import", () => {
    const { portable, applied } = project()
    expect(portableProjectV4PayloadSchema.safeParse(portable).success).toBe(true)
    expect(portableProjectV3PayloadSchema.safeParse(portable).success).toBe(false)
    expect(
      portableProjectV4PayloadSchema.safeParse({ ...portable, textureUpgradeRevision: 3 }).success,
    ).toBe(false)
    expect(
      portableProjectV4ImportSchema.safeParse({
        ...portable,
        exportedAt: applied.event.issuedAt,
        importedAt: applied.event.issuedAt,
      }).success,
    ).toBe(true)
    expect(
      portableProjectV4ImportSchema.safeParse({
        ...portable,
        exportedAt: applied.event.issuedAt,
        importedAt: applied.event.issuedAt,
        seed: applied.snapshot,
        versionedEvents: [],
        historyMode: "checkpoint",
        promotionRevision: 4,
        migrationDiagnostic: {
          code: "legacy-journal-unavailable",
          message: "The history is unavailable.",
        },
        unavailableRecords: ["authority-history"],
      }).success,
    ).toBe(false)
  })

  it("requires a newest-schema head before recovery may accept textured snapshots", () => {
    const { applied } = project()
    const head = {
      schemaVersion: 3,
      documentId: applied.snapshot.id,
      name: applied.snapshot.name,
      headRevision: 4,
      latestSnapshotRevision: 4,
      cleanCloseRevision: null,
      createdAt: applied.snapshot.createdAt,
      updatedAt: applied.snapshot.updatedAt,
      lastExternalBackupAt: null,
      migrationProvenance: "current",
      migrationDiagnostic: null,
      unavailableRecords: [],
      upgradeRevision: 2,
      textureUpgradeRevision: 4,
    }
    expect(projectRecordV3Schema.safeParse(head).success).toBe(true)
    expect(projectRecordV2Schema.safeParse(head).success).toBe(false)
    expect(projectRecordV3Schema.safeParse({ ...head, latestSnapshotRevision: 3 }).success).toBe(
      false,
    )
  })
})
