import { applyDocumentCommand } from "@vibeshape/domain/commands"
import { describe, expect, it } from "vitest"
import {
  decideUpdateActivation,
  selectSaveAsMethod,
  shouldRequestPersistentStorage,
} from "./capabilities"
import { classifyPersistenceError } from "./diagnostics"
import { sha256Text } from "./hash"
import {
  cacheIndexRecordSchema,
  localProjectSummarySchema,
  persistenceCommitInputSchema,
  projectDeleteInputSchema,
  projectRecordSchema,
} from "./schemas"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac"
const commandId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad"
const sessionId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ae"
const timestamp = "2026-08-08T00:00:00Z"

describe("persistence contracts", () => {
  it("uses deterministic SHA-256 checksums", async () => {
    await expect(sha256Text("VibeShape")).resolves.toBe(
      "1280decbc112ac499fdaba62a119900e89a454244273f2aea2c1cb0ad29ac116",
    )
  })

  it("classifies quota and abort failures without exposing browser messages", () => {
    expect(
      classifyPersistenceError(new DOMException("device detail", "QuotaExceededError")),
    ).toEqual({
      code: "quota-exceeded",
      message: "Browser storage quota was exceeded. Export a recovery file before continuing.",
      retryable: true,
    })
    expect(classifyPersistenceError(new DOMException("device detail", "AbortError"))).toMatchObject(
      {
        code: "transaction-aborted",
        retryable: true,
      },
    )
  })

  it("rejects unknown and unsafe storage record fields", () => {
    expect(
      projectRecordSchema.safeParse({
        schemaVersion: 0,
        documentId,
        name: "Bracket",
        headRevision: 1,
        latestSnapshotRevision: 1,
        cleanCloseRevision: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastExternalBackupAt: null,
        remoteSyncToken: "forbidden",
      }).success,
    ).toBe(false)
    expect(
      cacheIndexRecordSchema.safeParse({
        schemaVersion: 0,
        contentHash: "0".repeat(64),
        path: "../escape.bin",
        byteLength: 1,
        engineBuildId: "org.vibeshape.occt",
        lastAccessedAt: timestamp,
      }).success,
    ).toBe(false)
  })

  it("exposes only bounded semantic metadata in local project summaries", () => {
    expect(
      localProjectSummarySchema.safeParse({
        documentId,
        name: "Bracket",
        headRevision: 3,
        createdAt: timestamp,
        updatedAt: "2026-08-08T00:03:00Z",
        lastExternalBackupAt: null,
      }),
    ).toMatchObject({ success: true })
    expect(
      localProjectSummarySchema.safeParse({
        documentId,
        name: "Bracket",
        headRevision: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastExternalBackupAt: null,
        snapshot: { forbidden: true },
      }).success,
    ).toBe(false)
  })

  it("requires an exact project revision and bounded clock for deletion", () => {
    expect(
      projectDeleteInputSchema.safeParse({
        documentId,
        expectedHeadRevision: 3,
        nowMs: 1_786_176_000_000,
      }).success,
    ).toBe(true)
    expect(
      projectDeleteInputSchema.safeParse({
        documentId,
        expectedHeadRevision: -1,
        nowMs: 1_786_176_000_000,
      }).success,
    ).toBe(false)
  })

  it("validates a complete snapshot/event commit envelope", () => {
    const event = {
      schemaVersion: 1,
      type: "org.vibeshape.document.created",
      commandId,
      transactionId: null,
      documentId,
      baseRevision: 0,
      revision: 1,
      issuedAt: timestamp,
      actor: { type: "user", userId: null },
      name: "Bracket",
    }
    expect(
      persistenceCommitInputSchema.safeParse({
        sessionId,
        lease: null,
        storedAt: timestamp,
        baseSnapshot: null,
        event,
        snapshot: {
          schemaVersion: 0,
          id: documentId,
          revision: 1,
          name: "Bracket",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }).success,
    ).toBe(true)
  })

  it("accepts a replayable feature revision through the ordinary commit envelope", () => {
    const created = applyDocumentCommand(null, {
      kind: "org.vibeshape.document.create",
      schemaVersion: 1,
      commandId,
      documentId,
      baseRevision: 0,
      issuedAt: timestamp,
      actor: { type: "user", userId: null },
      payload: { name: "Bracket" },
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f21af",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T00:01:00Z",
      actor: { type: "user", userId: null },
      payload: {
        feature: {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f3101",
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.test",
            schemaVersion: 1,
          },
          parameters: { length: 10 },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })

    expect(added.ok).toBe(true)
    if (!added.ok) return

    expect(
      persistenceCommitInputSchema.safeParse({
        sessionId,
        lease: { epoch: 1, nowMs: 0 },
        storedAt: added.snapshot.updatedAt,
        baseSnapshot: created.snapshot,
        event: added.event,
        snapshot: added.snapshot,
      }).success,
    ).toBe(true)
  })

  it("accepts a replayable variable revision through the ordinary commit envelope", () => {
    const created = applyDocumentCommand(null, {
      kind: "org.vibeshape.document.create",
      schemaVersion: 1,
      commandId,
      documentId,
      baseRevision: 0,
      issuedAt: timestamp,
      actor: { type: "user", userId: null },
      payload: { name: "Configurable bracket" },
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const added = applyDocumentCommand(created.snapshot, {
      kind: "org.vibeshape.variable.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f21bf",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-08T00:01:00Z",
      actor: { type: "user", userId: null },
      payload: {
        variable: {
          schemaVersion: 0,
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f21cf",
          name: "wall",
          expression: "2.4 mm",
        },
      },
    })
    if (!added.ok) throw new Error(added.diagnostic.message)

    expect(
      persistenceCommitInputSchema.safeParse({
        sessionId,
        lease: { epoch: 1, nowMs: 0 },
        storedAt: added.snapshot.updatedAt,
        baseSnapshot: created.snapshot,
        event: added.event,
        snapshot: added.snapshot,
      }),
    ).toMatchObject({
      success: true,
      data: { snapshot: { variables: [{ name: "wall", expression: "2.4 mm" }] } },
    })
  })

  it("defers updates for dirty documents and keeps file picking progressive", () => {
    expect(decideUpdateActivation(1)).toBe("defer")
    expect(decideUpdateActivation(0)).toBe("activate")
    expect(selectSaveAsMethod({})).toBe("download")
    expect(selectSaveAsMethod({ showSaveFilePicker: () => undefined })).toBe("file-system-access")
    expect(shouldRequestPersistentStorage({ hasSavedProject: true, userGesture: false })).toBe(
      false,
    )
    expect(shouldRequestPersistentStorage({ hasSavedProject: true, userGesture: true })).toBe(true)
  })
})
