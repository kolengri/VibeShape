import { applyDocumentCommand } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentId, SessionId } from "@vibeshape/domain/identifiers"
import { describe, expect, it } from "vitest"
import {
  createPersistentDocumentSession,
  type DocumentLeasePort,
  type DocumentRebuildPort,
  openPersistentDocumentSession,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSessionDependencies,
} from "./persistent-document-session"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac" as DocumentId
const sessionA = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad" as SessionId
const sessionB = "0195b5ac-b220-7a2c-8c33-67a36a7f21ae" as SessionId
const timestamp = "2026-08-09T00:00:00Z"
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

function portFailure(code: string, message: string, retryable = false) {
  return { ok: false, diagnostic: { code, message, retryable } } as const
}

class MemoryRepository implements PersistentDocumentRepositoryPort {
  snapshot: DocumentSnapshot | null = null
  recoveryMarker = false
  failNextCommit = false
  commitCount = 0

  async commit(input: Parameters<PersistentDocumentRepositoryPort["commit"]>[0]) {
    if (this.failNextCommit) {
      this.failNextCommit = false
      return portFailure("quota-exceeded", "Storage quota was exceeded.", true)
    }
    this.snapshot = input.snapshot
    this.recoveryMarker = true
    this.commitCount += 1
    return { ok: true, value: { revision: input.snapshot.revision } } as const
  }

  async recover(requestedDocumentId: DocumentId) {
    if (!this.snapshot || this.snapshot.id !== requestedDocumentId) {
      return portFailure("document-not-found", "The document does not exist.")
    }
    return {
      ok: true,
      value: {
        status: this.recoveryMarker ? ("recovered" as const) : ("clean" as const),
        snapshot: this.snapshot,
        headRevision: this.snapshot.revision,
        recoveredRevision: this.snapshot.revision,
        lostRevisionCount: 0,
        corruptRecords: [],
      },
    } as const
  }

  async closeCleanly(input: Parameters<PersistentDocumentRepositoryPort["closeCleanly"]>[0]) {
    if (!this.snapshot || input.revision !== this.snapshot.revision) {
      return portFailure("stale-revision", "The clean-close revision is stale.", true)
    }
    this.recoveryMarker = false
    return { ok: true, value: undefined } as const
  }
}

class MemoryLeases implements DocumentLeasePort {
  ownerId: SessionId | null = null
  epoch = 0
  expiresAt = 0

  async acquire(input: Parameters<DocumentLeasePort["acquire"]>[0]) {
    if (this.ownerId !== null && this.ownerId !== input.ownerId && this.expiresAt > input.nowMs) {
      return portFailure("lease-held", "Another session owns the writer lease.", true)
    }
    if (this.ownerId !== input.ownerId || this.expiresAt <= input.nowMs) this.epoch += 1
    this.ownerId = input.ownerId
    this.expiresAt = input.nowMs + input.durationMs
    return {
      ok: true,
      value: { lease: { epoch: this.epoch, expiresAt: this.expiresAt } },
    } as const
  }

  async release(input: Parameters<DocumentLeasePort["release"]>[0]) {
    if (this.ownerId !== input.ownerId) {
      return portFailure("lease-lost", "The writer lease is no longer owned.", true)
    }
    this.ownerId = null
    this.expiresAt = 0
    return { ok: true, value: undefined } as const
  }
}

class MemoryRebuildPort implements DocumentRebuildPort {
  revisions: number[] = []
  failNextRebuild = false
  disposed = false
  terminated = false

  async rebuild(input: Parameters<DocumentRebuildPort["rebuild"]>[0]) {
    if (this.failNextRebuild) {
      this.failNextRebuild = false
      throw new Error("Synthetic worker failure")
    }
    this.revisions.push(input.document.revision)
    return {
      protocolVersion: 2 as const,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f21ff",
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
    }
  }

  async dispose() {
    this.disposed = true
  }

  terminate() {
    this.terminated = true
  }
}

function createCommand() {
  return {
    kind: "org.vibeshape.document.create",
    schemaVersion: 1,
    commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f2201",
    documentId,
    baseRevision: 0,
    issuedAt: timestamp,
    actor: { type: "user", userId: null },
    payload: { name: "Bracket" },
  } as const
}

function renameCommand(baseRevision: number, suffix: string) {
  return {
    kind: "org.vibeshape.document.rename",
    schemaVersion: 1,
    commandId: `0195b5ac-b220-7a2c-8c33-67a36a7f22${suffix}`,
    documentId,
    baseRevision,
    issuedAt: `2026-08-09T00:00:0${baseRevision}Z`,
    actor: { type: "user", userId: null },
    payload: { name: `Bracket ${baseRevision + 1}` },
  } as const
}

function harness() {
  const repository = new MemoryRepository()
  const leases = new MemoryLeases()
  const rebuildPorts: MemoryRebuildPort[] = []
  let nowMs = 1_000
  const dependencies: PersistentDocumentSessionDependencies = {
    commandDispatcher: { dispatch: applyDocumentCommand },
    repository,
    leases,
    createRebuildPort() {
      const port = new MemoryRebuildPort()
      rebuildPorts.push(port)
      return port
    },
    now: () => nowMs,
  }
  return {
    dependencies,
    repository,
    leases,
    rebuildPorts,
    setNow(value: number) {
      nowMs = value
    },
  }
}

async function createSession(
  dependencies: PersistentDocumentSessionDependencies,
  sessionId = sessionA,
) {
  const result = await createPersistentDocumentSession(dependencies, {
    sessionId,
    mesh,
    command: createCommand(),
  })
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result
}

describe("persistent document session", () => {
  it("commits semantic revisions before rebuild and recovers them after an unclean reload", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    expect(created.report).toMatchObject({ status: "created", mode: "read-write" })
    expect(created.report.rebuild).toMatchObject({ ok: true, response: { revision: 1 } })

    const renamed = await created.session.commit(renameCommand(1, "02"))
    expect(renamed).toMatchObject({
      ok: true,
      snapshot: { revision: 2, name: "Bracket 2" },
      rebuild: { ok: true, response: { revision: 2 } },
    })
    expect(state.repository.snapshot?.revision).toBe(2)
    expect(state.rebuildPorts[0]?.revisions).toEqual([1, 2])

    state.rebuildPorts[0]?.terminate()
    const reopened = await openPersistentDocumentSession(state.dependencies, {
      documentId,
      sessionId: sessionA,
      mesh,
    })
    expect(reopened).toMatchObject({
      ok: true,
      report: {
        status: "recovered",
        mode: "read-write",
        snapshot: { revision: 2 },
        rebuild: { ok: true, response: { revision: 2 } },
      },
    })
    if (!reopened.ok) return
    await expect(reopened.session.close()).resolves.toEqual({ ok: true, value: undefined })

    const cleanReopen = await openPersistentDocumentSession(state.dependencies, {
      documentId,
      sessionId: sessionA,
      mesh,
    })
    expect(cleanReopen).toMatchObject({ ok: true, report: { status: "clean" } })
    if (cleanReopen.ok) await cleanReopen.session.close()
  })

  it("does not advance the session or rebuild when the atomic persistence commit fails", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    state.repository.failNextCommit = true

    const result = await created.session.commit(renameCommand(1, "03"))
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "persistence-failed",
        sourceCode: "quota-exceeded",
        retryable: true,
      },
    })
    expect(created.session.snapshot.revision).toBe(1)
    expect(state.repository.snapshot?.revision).toBe(1)
    expect(state.rebuildPorts[0]?.revisions).toEqual([1])
  })

  it("keeps a saved semantic revision when rebuilding fails and permits a retry", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    const port = state.rebuildPorts[0]
    if (!port) throw new Error("The rebuild port was not created.")
    port.failNextRebuild = true

    const result = await created.session.commit(renameCommand(1, "04"))
    expect(result).toMatchObject({
      ok: true,
      snapshot: { revision: 2 },
      rebuild: { ok: false, diagnostic: { code: "rebuild-failed" } },
    })
    expect(state.repository.snapshot?.revision).toBe(2)
    await expect(created.session.retryRebuild()).resolves.toMatchObject({
      ok: true,
      response: { revision: 2 },
    })
  })

  it("opens read-only while another live writer owns the lease and retries write access later", async () => {
    const state = harness()
    await createSession(state.dependencies, sessionA)

    const readOnly = await openPersistentDocumentSession(state.dependencies, {
      documentId,
      sessionId: sessionB,
      mesh,
    })
    expect(readOnly).toMatchObject({
      ok: true,
      report: {
        mode: "read-only",
        writeAccessDiagnostic: {
          code: "write-access-unavailable",
          sourceCode: "lease-held",
        },
      },
    })
    if (!readOnly.ok) return

    await expect(readOnly.session.commit(renameCommand(1, "05"))).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "write-access-unavailable", sourceCode: "lease-held" },
    })
    state.setNow(31_001)
    await expect(readOnly.session.commit(renameCommand(1, "06"))).resolves.toMatchObject({
      ok: true,
      snapshot: { revision: 2 },
    })
    expect(readOnly.session.mode).toBe("read-write")
  })

  it("rejects invalid create and open boundaries without constructing a worker", async () => {
    const state = harness()
    await expect(createPersistentDocumentSession(state.dependencies, {})).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-session-input" },
    })
    await expect(
      openPersistentDocumentSession(state.dependencies, {
        documentId: "not-a-document-id",
        sessionId: sessionA,
        mesh,
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-session-input" },
    })
    expect(state.rebuildPorts).toHaveLength(0)
  })
})
