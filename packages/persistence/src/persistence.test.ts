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
  persistenceCommitInputSchema,
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
