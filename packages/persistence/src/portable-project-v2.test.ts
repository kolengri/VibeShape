import { describe, expect, it } from "vitest"
import { portableProjectV2CopySchema, portableProjectV2ImportSchema } from "./schemas"

const timestamp = "2026-08-08T00:00:00Z"
const snapshot = {
  schemaVersion: 1 as const,
  id: "0195b5ac-b220-7a2c-8c33-67a36a7f21ac",
  revision: 1,
  name: "Bracket",
  displayUnits: { length: "mm", angle: "deg" },
  variables: [],
  sketches: [],
  features: [],
  history: [],
  createdAt: timestamp,
  updatedAt: timestamp,
}
const event = {
  schemaVersion: 1 as const,
  type: "org.vibeshape.document.created" as const,
  commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f21ad",
  transactionId: null,
  documentId: snapshot.id,
  baseRevision: 0,
  revision: 1,
  issuedAt: timestamp,
  actor: { type: "user" as const, userId: null },
  name: snapshot.name,
}

describe("portable v2 persistence contracts", () => {
  it("accepts native complete history", () => {
    expect(
      portableProjectV2ImportSchema.safeParse({
        snapshot,
        seed: null,
        legacyEvents: [],
        versionedEvents: [event],
        historyMode: "complete",
        promotionRevision: 0,
        migrationDiagnostic: null,
        unavailableRecords: [],
        importedAt: timestamp,
        exportedAt: timestamp,
      }).success,
    ).toBe(true)
  })

  it("keeps evidenced checkpoints out of writable import and copy", () => {
    const checkpoint = {
      snapshot,
      seed: snapshot,
      legacyEvents: [],
      versionedEvents: [],
      historyMode: "checkpoint",
      promotionRevision: 1,
      migrationDiagnostic: {
        code: "legacy-journal-unavailable",
        message: "The legacy prefix is unavailable.",
      },
      unavailableRecords: ["event:1"],
      copiedAt: timestamp,
    }
    expect(portableProjectV2CopySchema.safeParse(checkpoint).success).toBe(false)
    const { copiedAt: _copiedAt, ...checkpointPayload } = checkpoint
    expect(
      portableProjectV2ImportSchema.safeParse({
        ...checkpointPayload,
        importedAt: timestamp,
        exportedAt: timestamp,
      }).success,
    ).toBe(false)
    expect(
      portableProjectV2CopySchema.safeParse({
        ...checkpoint,
        migrationDiagnostic: null,
        unavailableRecords: [],
      }).success,
    ).toBe(false)
  })
})
