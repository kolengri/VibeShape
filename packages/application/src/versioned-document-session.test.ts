import {
  applyDocumentCommand,
  type DocumentId,
  type DocumentSnapshot,
  migrateDocumentSnapshot,
  type SessionId,
} from "@vibeshape/domain"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import { partIdSchema } from "@vibeshape/domain/identifiers"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  type AuthorityDocumentSessionDependencies,
  openAuthorityDocumentSession,
} from "./authority-document-session"
import type { AuthorityCommitInput, AuthorityDraftInput } from "./authority-persistence-adapter"
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

// The authority opener reuses legacy promotion while keeping V2 metadata out of the V0 runtime.
function authorityDependencies(
  options: { missing?: boolean; unsupported?: boolean; loss?: boolean } = {},
) {
  const migrated = recovery()
  const v1: VersionedRecoveryReport = {
    ...migrated,
    migration: {
      migrationProvenance: "current",
      migrationDiagnostic: null,
      unavailableRecords: [],
    },
  }
  const base = dependencies({ versioned: v1 })
  let current: DocumentAuthoritySnapshot = migrated.snapshot
  const upgraded = applyDocumentUpgradeV2Command(current, {
    schemaVersion: 2,
    kind: "org.vibeshape.document.upgrade-v2",
    commandId: "0195b5ac-b250-7a2c-8c33-000000000210",
    documentId,
    baseRevision: current.revision,
    issuedAt: timestamp,
    actor: { type: "system", source: "org.vibeshape.test" },
    payload: { partAllocations: [] },
  })
  if (!upgraded.ok) throw new Error(upgraded.diagnostic.message)
  if (!options.missing) current = upgraded.snapshot
  let writes = 0
  let authorityReads = 0
  let identity = 300
  const repository = {
    ...base.dependencies.versionedRepository,
    async recoverAuthority() {
      authorityReads += 1
      if (options.unsupported) return failure("unsupported-version")
      if (options.missing && authorityReads === 1) return failure("document-not-found")
      return {
        ok: true as const,
        value: {
          ...v1,
          snapshot: current,
          headRevision: current.revision + (options.loss ? 1 : 0),
          recoveredRevision: current.revision,
          status: options.loss ? ("recovered-with-loss" as const) : ("clean" as const),
          lostRevisionCount: options.loss ? 1 : 0,
        },
      }
    },
    async commitAuthority(input: AuthorityCommitInput) {
      writes += 1
      current = input.snapshot
      return { ok: true as const, value: undefined }
    },
    async commitAuthorityDraft(input: AuthorityDraftInput) {
      writes += 1
      current = input.snapshot
      return { ok: true as const, value: undefined }
    },
    async closeAuthorityCleanly() {
      return { ok: true as const, value: undefined }
    },
  }
  const configured: AuthorityDocumentSessionDependencies = {
    ...base.dependencies,
    versionedRepository: repository,
    createPart: (requirement, feature) => ({
      ...requirement,
      id: partIdSchema.parse(`0195b5ac-b250-7a2c-8c33-${String(identity++).padStart(12, "0")}`),
      name: feature?.label ?? "Part",
    }),
    commandDispatcher: { dispatch: applyDocumentCommand },
  }
  return { ...base, configured, writes: () => writes, authorityReads: () => authorityReads }
}

it("opens V2 authority through one recovery read and exposes full metadata to the session", async () => {
  const f = authorityDependencies()
  const opened = await openAuthorityDocumentSession(f.configured, input())
  if (!opened.ok) throw new Error(opened.diagnostic.message)
  expect(opened.session.authoredSnapshot).toMatchObject({
    schemaVersion: 2,
    parts: [],
    folders: [],
  })
  expect(opened.report.snapshot.schemaVersion).toBe(0)
  expect(f.authorityReads()).toBe(1)
  expect(f.counts.legacyRecovery).toBe(0)
  await opened.session.close()
})

it("never falls through an unsupported authority version to legacy recovery", async () => {
  const f = authorityDependencies({ unsupported: true })
  const opened = await openAuthorityDocumentSession(f.configured, input())
  expect(opened).toMatchObject({ ok: false, diagnostic: { sourceCode: "unsupported-version" } })
  expect(f.counts.legacyRecovery).toBe(0)
  expect(f.leases.acquireCount).toBe(0)
  expect(f.writes()).toBe(0)
})

it("keeps incomplete V2 recovery read-only without requesting a writer lease", async () => {
  const f = authorityDependencies({ loss: true })
  const opened = await openAuthorityDocumentSession(f.configured, input())
  if (!opened.ok) throw new Error(opened.diagnostic.message)
  expect(opened.session.mode).toBe("read-only")
  expect(f.leases.acquireCount).toBe(0)
  const rejected = await opened.session.commitAuthored({})
  expect(rejected.ok).toBe(false)
  expect(f.writes()).toBe(0)
  await opened.session.close()
})

it("uses the authority adapter after a V1 fallback and serializes explicit upgrade commands", async () => {
  const f = authorityDependencies({ missing: true })
  const opened = await openAuthorityDocumentSession(f.configured, input())
  if (!opened.ok) throw new Error(opened.diagnostic.message)
  expect(opened.session.authoredSnapshot?.schemaVersion).toBe(1)
  const command = {
    schemaVersion: 2,
    kind: "org.vibeshape.document.upgrade-v2",
    commandId: "0195b5ac-b250-7a2c-8c33-000000000211",
    documentId,
    baseRevision: opened.session.snapshot.revision,
    issuedAt: timestamp,
    actor: { type: "system", source: "org.vibeshape.test" },
    payload: {},
  }
  const [first, second] = await Promise.all([
    opened.session.commitAuthored(command),
    opened.session.commitAuthored({
      ...command,
      commandId: "0195b5ac-b250-7a2c-8c33-000000000212",
    }),
  ])
  expect(first.ok).toBe(true)
  expect(second.ok).toBe(false)
  expect(opened.session.authoredSnapshot?.schemaVersion).toBe(2)
  expect(opened.session.snapshot.revision).toBe(command.baseRevision + 1)
  expect(f.writes()).toBe(1)
  await opened.session.close()
  expect((await opened.session.commitAuthored(command)).ok).toBe(false)
})
