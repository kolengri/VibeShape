import { applyDocumentCommand } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentId, SessionId, SketchEntityId, SketchId } from "@vibeshape/domain/identifiers"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import type { SketchRecord } from "@vibeshape/domain/sketch"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import {
  createPersistentDocumentSession,
  type DocumentLeasePort,
  type DocumentRebuildPort,
  openPersistentDocumentSession,
  type PersistedRecoveryMigration,
  type PersistentDocumentRepositoryPort,
  type PersistentDocumentSessionDependencies,
} from "./persistent-document-session"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f21ac" as DocumentId
const sessionA = "0195b5ac-b220-7a2c-8c33-67a36a7f21ad" as SessionId
const sessionB = "0195b5ac-b220-7a2c-8c33-67a36a7f21ae" as SessionId
const sketchId = "0195b5ac-b220-7a2c-8c33-67a36a7f21af" as SketchId
const sketchPointId = "0195b5ac-b220-7a2c-8c33-67a36a7f21b0" as SketchEntityId
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
  draftCommitCount = 0
  migration: PersistedRecoveryMigration | null = null

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

  async commitDraft(input: Parameters<PersistentDocumentRepositoryPort["commitDraft"]>[0]) {
    if (this.failNextCommit) {
      this.failNextCommit = false
      return portFailure("quota-exceeded", "Storage quota was exceeded.", true)
    }
    this.snapshot = input.snapshot
    this.recoveryMarker = true
    this.draftCommitCount += 1
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
        ...(this.migration ? { migration: this.migration } : {}),
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
  exportedFormats: string[] = []
  solvedSketchIds: string[] = []
  solvedSketchDrafts: Array<SketchRecord | null> = []
  solvedSketchInputs: Array<Parameters<DocumentRebuildPort["solveSketch"]>[0]> = []

  async rebuild(input: Parameters<DocumentRebuildPort["rebuild"]>[0]) {
    if (this.failNextRebuild) {
      this.failNextRebuild = false
      throw new Error("Synthetic worker failure")
    }
    this.revisions.push(input.document.revision)
    return {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
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
      sketches: [],
      modelReferenceEvidence: [],
    }
  }

  async exportDocument(format: Parameters<DocumentRebuildPort["exportDocument"]>[0]) {
    this.exportedFormats.push(format)
    return {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f21fe",
      documentId,
      revision: this.revisions.at(-1) ?? 0,
      generation: 1,
      type: "documentExported" as const,
      format,
      file: new Uint8Array([1, 2, 3]),
      bodyCount: 1,
    }
  }

  async solveSketch(input: Parameters<DocumentRebuildPort["solveSketch"]>[0]) {
    this.solvedSketchIds.push(input.sketchId)
    this.solvedSketchDrafts.push(input.draftSketch ?? null)
    this.solvedSketchInputs.push(input)
    return {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f21fd",
      documentId,
      revision: this.revisions.at(-1) ?? 0,
      generation: 1,
      type: "sketchSolved" as const,
      solution: {
        schemaVersion: 0,
        sketchId: input.sketchId,
        sourceRevision: this.revisions.at(-1) ?? 0,
        status: "fully-constrained" as const,
        degreesOfFreedom: 0,
        maximumResidual: 0,
        points: [],
        circles: [],
        failedConstraintIds: [],
        profileResult: { schemaVersion: 0, profiles: [], loops: [], diagnostics: [] },
        heapCapacityBytes: 0,
        solverBuild: {
          schemaVersion: 0,
          solver: "SolveSpace" as const,
          solverVersion: "3.2" as const,
          sourceRevision: "27b6a080c8b669421bd4d444650c3b8eddec5687" as const,
          abiVersion: 1 as const,
          moduleSha256: "0".repeat(64),
          wasmSha256: "0".repeat(64),
        },
      },
    } as Awaited<ReturnType<DocumentRebuildPort["solveSketch"]>>
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

function addVariableCommand(
  baseRevision: number,
  suffix: string,
  variable: { id: string; name: string; expression: string },
) {
  return {
    kind: "org.vibeshape.variable.add",
    schemaVersion: 1,
    commandId: `0195b5ac-b220-7a2c-8c33-67a36a7f23${suffix}`,
    documentId,
    baseRevision,
    issuedAt: `2026-08-09T00:01:0${baseRevision}Z`,
    actor: { type: "user", userId: null },
    payload: { variable: { schemaVersion: 0, ...variable } },
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
  it("solves against the same rebuilt worker session as the persisted document", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)

    await expect(created.session.solveSketch(sketchId)).resolves.toMatchObject({
      ok: true,
      response: {
        revision: 1,
        solution: { sketchId, sourceRevision: 1, status: "fully-constrained" },
      },
    })
    expect(state.rebuildPorts[0]?.solvedSketchIds).toEqual([sketchId])
    expect(state.rebuildPorts[0]?.solvedSketchDrafts).toEqual([null])
  })

  it("forwards a transient sketch draft without committing a semantic revision", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    const draft = {
      schemaVersion: 0,
      id: sketchId,
      label: "Unsaved profile",
      plane: "xy",
      entities: [
        {
          schemaVersion: 0,
          id: sketchPointId,
          type: "point",
          x: 0,
          y: 0,
          construction: false,
        },
      ],
      constraints: [],
    } as const satisfies SketchRecord
    const continuation = {
      schemaVersion: 0 as const,
      sketchId,
      sourceRevision: 1,
      points: [{ entityId: sketchPointId, x: 0, y: 0 }],
      circles: [],
    }
    const draggedPoints = [{ entityId: sketchPointId, x: 10, y: 20 }]

    await expect(
      created.session.solveSketch(sketchId, draft, { continuation, draggedPoints }),
    ).resolves.toMatchObject({ ok: true })

    expect(state.rebuildPorts[0]?.solvedSketchDrafts).toEqual([draft])
    expect(state.rebuildPorts[0]?.solvedSketchInputs).toEqual([
      { sketchId, draftSketch: draft, continuation, draggedPoints },
    ])
    expect(created.session.snapshot).toMatchObject({ revision: 1, sketches: [] })
    expect(state.repository.commitCount).toBe(1)
  })

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
    state.repository.migration = {
      provenance: "snapshot-derived",
      diagnostic: {
        code: "legacy-journal-unavailable",
        message: "The legacy journal prefix is unavailable.",
      },
      unavailableRecords: ["event:1"],
    }
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
        migration: {
          provenance: "snapshot-derived",
          diagnostic: { code: "legacy-journal-unavailable" },
          unavailableRecords: ["event:1"],
        },
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

  it("persists and reopens orphaned model-reference repair intent before rebuilding", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f21b1"
    const feature = await created.session.commit({
      kind: "org.vibeshape.feature.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f22b1",
      documentId,
      baseRevision: 1,
      issuedAt: "2026-08-09T00:00:01Z",
      actor: { type: "user", userId: null },
      payload: {
        feature: {
          schemaVersion: 0,
          id: featureId,
          type: boxFeatureType.type,
          parameters: {
            width: createLengthQuantity(20),
            depth: createLengthQuantity(20),
            height: createLengthQuantity(20),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    })
    expect(feature.ok).toBe(true)
    if (!feature.ok) return
    const sketch = await created.session.commit({
      kind: "org.vibeshape.sketch.add",
      schemaVersion: 1,
      commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f22b2",
      documentId,
      baseRevision: 2,
      issuedAt: "2026-08-09T00:00:02Z",
      actor: { type: "user", userId: null },
      payload: {
        sketch: {
          schemaVersion: 0,
          id: sketchId,
          label: "Referenced profile",
          plane: "xy",
          entities: [],
          constraints: [],
          externalReferences: [
            {
              schemaVersion: 0,
              id: "0195b5ac-b220-7a2c-8c33-67a36a7f21b2",
              kind: "model-point",
              reference: {
                schemaVersion: 0,
                featureId,
                kind: "vertex",
                signature: {
                  kind: "vertex",
                  geometryClass: "POINT",
                  measure: 0,
                  centroid: [0, 0, 0],
                  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
                  boundaryCount: 0,
                  adjacentGeometryClasses: [],
                },
              },
              projectedPointId: sketchPointId,
            },
          ],
        },
      },
    })
    expect(sketch.ok).toBe(true)
    if (!sketch.ok) return
    const removed = await created.session.commit({
      kind: "org.vibeshape.feature.remove-preserving-model-reference-intent",
      schemaVersion: 1,
      commandId: "0195b5ac-b220-7a2c-8c33-67a36a7f22b3",
      documentId,
      baseRevision: 3,
      issuedAt: "2026-08-09T00:00:03Z",
      actor: { type: "user", userId: null },
      payload: { featureId },
    })

    expect(removed).toMatchObject({
      ok: true,
      snapshot: {
        revision: 4,
        features: [],
        sketches: [
          {
            externalReferences: [
              {
                schemaVersion: 1,
                orphanedSource: { kind: "deleted-feature", featureId },
              },
            ],
          },
        ],
      },
      rebuild: { ok: true, response: { revision: 4 } },
    })
    expect(state.repository.snapshot).toEqual(created.session.snapshot)
    expect(state.rebuildPorts[0]?.revisions).toEqual([1, 2, 3, 4])

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
        snapshot: {
          revision: 4,
          features: [],
          sketches: [
            {
              externalReferences: [
                {
                  schemaVersion: 1,
                  orphanedSource: { kind: "deleted-feature", featureId },
                },
              ],
            },
          ],
        },
        rebuild: { ok: true, response: { revision: 4 } },
      },
    })
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

  it("persists a multi-command draft atomically and rebuilds only the final revision", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)

    const result = await created.session.commitDraft({
      draftId: "0195b5ac-b220-7a2c-8c33-67a36a7f2401",
      commands: [
        addVariableCommand(1, "01", {
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f2501",
          name: "wall",
          expression: "2 mm",
        }),
        addVariableCommand(2, "02", {
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f2502",
          name: "width",
          expression: "#wall * 10",
        }),
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        revision: 3,
        variables: [
          { name: "wall", expression: "2 mm" },
          { name: "width", expression: "#wall * 10" },
        ],
      },
      events: [{ transactionId: "0195b5ac-b220-7a2c-8c33-67a36a7f2401" }, {}],
      rebuild: { ok: true, response: { revision: 3 } },
    })
    expect(state.repository.draftCommitCount).toBe(1)
    expect(state.rebuildPorts[0]?.revisions).toEqual([1, 3])
  })

  it("retains the base snapshot when an atomic draft persistence commit fails", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    state.repository.failNextCommit = true

    const result = await created.session.commitDraft({
      draftId: "0195b5ac-b220-7a2c-8c33-67a36a7f2402",
      commands: [
        addVariableCommand(1, "03", {
          id: "0195b5ac-b220-7a2c-8c33-67a36a7f2503",
          name: "wall",
          expression: "2 mm",
        }),
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "persistence-failed", sourceCode: "quota-exceeded" },
    })
    expect(created.session.snapshot).toMatchObject({ revision: 1, variables: [] })
    expect(state.rebuildPorts[0]?.revisions).toEqual([1])
  })

  it("rejects mixed-actor drafts before persistence", async () => {
    const state = harness()
    const created = await createSession(state.dependencies)
    const wall = addVariableCommand(1, "04", {
      id: "0195b5ac-b220-7a2c-8c33-67a36a7f2504",
      name: "wall",
      expression: "2 mm",
    })
    const width = {
      ...addVariableCommand(2, "05", {
        id: "0195b5ac-b220-7a2c-8c33-67a36a7f2505",
        name: "width",
        expression: "#wall * 10",
      }),
      actor: { type: "system", source: "org.vibeshape.test" },
    } as const

    await expect(
      created.session.commitDraft({
        draftId: "0195b5ac-b220-7a2c-8c33-67a36a7f2403",
        commands: [wall, width],
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "invalid-draft-commit" },
    })
    expect(state.repository.draftCommitCount).toBe(0)
    expect(created.session.snapshot.revision).toBe(1)
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

  it("exports rebuilt geometry without requiring a writer lease", async () => {
    const state = harness()
    const created = await createSession(state.dependencies, sessionA)
    const readOnly = await openPersistentDocumentSession(state.dependencies, {
      documentId,
      sessionId: sessionB,
      mesh,
    })
    if (!readOnly.ok) throw new Error(readOnly.diagnostic.message)

    await expect(readOnly.session.exportDocument("stl")).resolves.toMatchObject({
      ok: true,
      response: {
        type: "documentExported",
        format: "stl",
        file: new Uint8Array([1, 2, 3]),
        bodyCount: 1,
      },
    })
    expect(state.rebuildPorts[1]?.exportedFormats).toEqual(["stl"])
    await readOnly.session.close()
    await expect(readOnly.session.exportDocument("step")).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "session-closed" },
    })
    await created.session.close()
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
