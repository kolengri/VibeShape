import { describe, expect, it } from "bun:test"
import { applyDocumentUpgradeV2Command, applyVersionedDocumentCommand } from "@vibeshape/domain"
import {
  parseAuthorityProject,
  storeAuthoritySnapshot,
  validAuthoritySnapshot,
} from "./authority-records"
import {
  portableProjectV3ImportSchema,
  portableProjectV3PayloadSchema,
  projectRecordV2Schema,
} from "./authority-schemas"
import { projectRecordV1Schema } from "./schemas"
import { serializeStoredRecord } from "./stored-record-codec"

const timestamp = "2026-10-03T00:00:00Z"
const documentId = "0195b5ac-b220-7a2c-8c33-000000000001"
function fixture() {
  const envelope = { documentId, issuedAt: timestamp, actor: { type: "user", userId: null } }
  const created = applyVersionedDocumentCommand(null, {
    ...envelope,
    schemaVersion: 1,
    commandId: "0195b5ac-b220-7a2c-8c33-000000000002",
    baseRevision: 0,
    kind: "org.vibeshape.document.create",
    payload: { name: "Parts" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const upgraded = applyDocumentUpgradeV2Command(created.snapshot, {
    ...envelope,
    schemaVersion: 2,
    commandId: "0195b5ac-b220-7a2c-8c33-000000000003",
    baseRevision: 1,
    kind: "org.vibeshape.document.upgrade-v2",
    payload: { partAllocations: [] },
  })
  if (!upgraded.ok) throw new Error(upgraded.diagnostic.message)
  return { created, upgraded }
}
function head() {
  return {
    schemaVersion: 2,
    documentId,
    name: "Parts",
    headRevision: 2,
    latestSnapshotRevision: 2,
    cleanCloseRevision: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastExternalBackupAt: null,
    migrationProvenance: "current",
    migrationDiagnostic: null,
    unavailableRecords: [],
    upgradeRevision: 2,
  }
}
describe("same-store authored authority boundaries", () => {
  it("requires an explicit upgrade boundary and keeps old parsers strict", () => {
    expect(projectRecordV2Schema.safeParse(head()).success).toBe(true)
    expect(projectRecordV1Schema.safeParse(head()).success).toBe(false)
    expect(projectRecordV2Schema.safeParse({ ...head(), upgradeRevision: 3 }).success).toBe(false)
    expect(() => parseAuthorityProject({ ...head(), schemaVersion: 99 })).toThrow(
      "different authority schema",
    )
  })
  it("distinguishes corrupt records from unsupported payload authority", async () => {
    const { upgraded } = fixture()
    const record = await storeAuthoritySnapshot(upgraded.snapshot, timestamp)
    expect(await validAuthoritySnapshot(record)).toEqual(upgraded.snapshot)
    expect(await validAuthoritySnapshot({ ...record, checksum: "0".repeat(64) })).toBeNull()
    const future = await serializeStoredRecord({ ...upgraded.snapshot, schemaVersion: 99 })
    await expect(validAuthoritySnapshot({ ...record, ...future })).rejects.toThrow(
      "different authority schema",
    )
    expect(await validAuthoritySnapshot({ ...record, schemaVersion: 1 })).toBeNull()
  })
  it("permits complete mixed history but cannot publish an evidenced checkpoint", () => {
    const { created, upgraded } = fixture()
    const complete = {
      snapshot: upgraded.snapshot,
      seed: null,
      legacyEvents: [],
      versionedEvents: [created.event, upgraded.event],
      historyMode: "complete",
      promotionRevision: 0,
      upgradeRevision: 2,
      migrationDiagnostic: null,
      unavailableRecords: [],
    }
    expect(
      portableProjectV3ImportSchema.safeParse({
        ...complete,
        importedAt: timestamp,
        exportedAt: timestamp,
      }).success,
    ).toBe(true)
    const checkpoint = {
      ...complete,
      seed: upgraded.snapshot,
      versionedEvents: [],
      historyMode: "checkpoint",
      promotionRevision: 2,
      migrationDiagnostic: { code: "legacy-journal-unavailable", message: "Missing journal." },
      unavailableRecords: ["event-authority:1"],
    }
    expect(portableProjectV3PayloadSchema.safeParse(checkpoint).success).toBe(true)
    expect(
      portableProjectV3ImportSchema.safeParse({
        ...checkpoint,
        importedAt: timestamp,
        exportedAt: timestamp,
      }).success,
    ).toBe(false)
  })
})
