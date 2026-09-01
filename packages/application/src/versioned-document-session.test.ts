import {
  applyDocumentCommand,
  type DocumentId,
  type DocumentSnapshot,
  migrateDocumentSnapshot,
  type SessionId,
} from "@vibeshape/domain"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import type {
  DocumentLeasePort,
  DocumentRebuildPort,
  PersistentDocumentRepositoryPort,
} from "./persistent-document-session"
import {
  type MigratedLegacyRecoveryReport,
  openVersionedDocumentSession,
  type VersionedDocumentSessionDependencies,
} from "./versioned-document-session"
import type {
  VersionedDocumentRepositoryPort,
  VersionedRecoveryReport,
} from "./versioned-persistence-adapter"

const documentId = "0195b5ac-b250-7a2c-8c33-000000000201" as DocumentId
const sessionId = "0195b5ac-b250-7a2c-8c33-000000000202" as SessionId
const timestamp = "2026-09-01T13:00:00.000Z"
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

function legacyDocument() {
  const created = applyDocumentCommand(null, {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b250-7a2c-8c33-000000000203",
    documentId,
    baseRevision: 0,
    issuedAt: timestamp,
    actor: { type: "user", userId: null },
    payload: { name: "Versioned session" },
  })
  if (!created.ok) throw new Error(created.diagnostic.message)
  const migrated = migrateDocumentSnapshot(created.snapshot, [created.event])
  if (!migrated.ok) throw new Error(migrated.diagnostic.message)
  return { created, migrated }
}

function failure(code: string, retryable = false) {
  return { ok: false as const, diagnostic: { code, message: code, retryable } }
}

function recovery(
  status: MigratedLegacyRecoveryReport["status"] = "clean",
): MigratedLegacyRecoveryReport {
  const { migrated } = legacyDocument()
  const lostRevisionCount = status === "recovered-with-loss" ? 1 : 0
  return {
    status,
    snapshot: migrated.snapshot,
    headRevision: migrated.snapshot.revision + lostRevisionCount,
    recoveredRevision: migrated.snapshot.revision,
    lostRevisionCount,
    corruptRecords: lostRevisionCount ? ["event:2"] : [],
    migration: {
      provenance: migrated.provenance,
      diagnostic: migrated.diagnostic ?? null,
      unavailableRecords: [],
    },
  }
}

class RebuildPort implements DocumentRebuildPort {
  async rebuild(input: Parameters<DocumentRebuildPort["rebuild"]>[0]) {
    return {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "0195b5ac-b250-7a2c-8c33-000000000204",
      documentId: input.document.id,
      revision: input.document.revision,
      generation: 1,
      type: "documentRebuilt" as const,
      evaluation: {
        records: [],
        dirtyFeatureIds: [],
        evaluatedFeatureIds: [],
        reusedFeatureIds: [],
      },
      geometry: [],
      sketches: [],
      modelReferenceEvidence: [],
    }
  }

  async exportDocument(): Promise<never> {
    throw new Error("Not used")
  }

  async solveSketch(): Promise<never> {
    throw new Error("Not used")
  }

  async dispose() {}

  terminate() {}
}

class Leases implements DocumentLeasePort {
  acquireCount = 0
  releaseCount = 0
  held = false

  async acquire(input: Parameters<DocumentLeasePort["acquire"]>[0]) {
    this.acquireCount += 1
    return this.held
      ? failure("lease-held", true)
      : {
          ok: true as const,
          value: { lease: { epoch: 1, expiresAt: input.nowMs + input.durationMs } },
        }
  }

  async release() {
    this.releaseCount += 1
    return { ok: true as const, value: undefined }
  }
}

function dependencies(options: {
  versioned?: VersionedRecoveryReport
  legacy?: MigratedLegacyRecoveryReport
  leaseHeld?: boolean
  promotionFails?: boolean
}) {
  const legacySnapshot = legacyDocument().created.snapshot
  const leases = new Leases()
  leases.held = options.leaseHeld ?? false
  let promoteCount = 0
  let legacyRecoveryCount = 0
  let closeReceiverCorrect = false
  const legacyRepository: PersistentDocumentRepositoryPort &
    VersionedDocumentSessionDependencies["legacyRepository"] = {
    async commit() {
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return legacyPortRecovery(legacySnapshot)
    },
    async recoverMigrated() {
      legacyRecoveryCount += 1
      return { ok: true, value: options.legacy ?? recovery() }
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
  }
  const versionedRepository: VersionedDocumentRepositoryPort &
    VersionedDocumentSessionDependencies["versionedRepository"] = {
    async commit() {
      return { ok: true, value: undefined }
    },
    async commitDraft() {
      return { ok: true, value: undefined }
    },
    async recover() {
      return options.versioned
        ? { ok: true, value: options.versioned }
        : failure("document-not-found")
    },
    async promote() {
      promoteCount += 1
      return options.promotionFails
        ? failure("quota-exceeded", true)
        : { ok: true, value: undefined }
    },
    async closeCleanly() {
      closeReceiverCorrect = this === versionedRepository
      return { ok: true, value: undefined }
    },
  }
  return {
    dependencies: {
      legacyRepository,
      versionedRepository,
      leases,
      commandDispatcher: { dispatch: () => failure("not-used") as never },
      createRebuildPort: () => new RebuildPort(),
      now: () => 1_000,
    },
    leases,
    counts: {
      get promote() {
        return promoteCount
      },
      get legacyRecovery() {
        return legacyRecoveryCount
      },
      get closeReceiverCorrect() {
        return closeReceiverCorrect
      },
    },
  }
}

function legacyPortRecovery(snapshot: DocumentSnapshot) {
  return {
    ok: true as const,
    value: {
      status: "clean" as const,
      snapshot,
      headRevision: snapshot.revision,
      recoveredRevision: snapshot.revision,
      lostRevisionCount: 0,
      corruptRecords: [],
    },
  }
}

function input() {
  return { documentId, sessionId, mesh, storedAt: timestamp }
}

describe("versioned document session orchestration", () => {
  it("opens existing v1 authority without recovering or promoting legacy state", async () => {
    const migrated = recovery()
    const fixture = dependencies({
      versioned: {
        ...migrated,
        migration: {
          migrationProvenance: migrated.migration.provenance,
          migrationDiagnostic: migrated.migration.diagnostic,
          unavailableRecords: migrated.migration.unavailableRecords,
        },
      },
    })
    const opened = await openVersionedDocumentSession(fixture.dependencies, input())
    if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostic))
    expect(opened).toMatchObject({ ok: true, report: { mode: "read-write" } })
    expect(await opened.session.close()).toMatchObject({ ok: true })
    expect(fixture.counts).toMatchObject({ legacyRecovery: 0, promote: 0 })
    expect(fixture.counts.closeReceiverCorrect).toBe(true)
  })

  it("promotes complete legacy recovery before opening writable v1 authority", async () => {
    const fixture = dependencies({})
    const opened = await openVersionedDocumentSession(fixture.dependencies, input())
    if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostic))
    expect(opened).toMatchObject({
      ok: true,
      report: { mode: "read-write", migration: { provenance: "journal-derived" } },
    })
    expect(fixture.counts).toMatchObject({ legacyRecovery: 1, promote: 1 })
    expect(fixture.leases.acquireCount).toBe(2)
  })

  it.each([
    ["lease contention", { leaseHeld: true }],
    ["lossy recovery", { legacy: recovery("recovered-with-loss") }],
    ["promotion failure", { promotionFails: true }],
  ])("keeps legacy recovery read-only after %s", async (_name, options) => {
    const fixture = dependencies(options)
    const opened = await openVersionedDocumentSession(fixture.dependencies, input())
    if (!opened.ok) throw new Error(JSON.stringify(opened.diagnostic))
    expect(opened).toMatchObject({
      ok: true,
      report: { mode: "read-only", migration: { provenance: "journal-derived" } },
    })
    if ("promotionFails" in options && options.promotionFails)
      expect(fixture.leases.releaseCount).toBe(1)
  })
})
