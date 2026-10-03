import {
  applyDocumentCommand,
  applyVersionedDocumentCommand,
  boxFeatureType,
  createLengthQuantity,
  featureRecordSchema,
} from "@vibeshape/domain"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentV2MetadataChange } from "@vibeshape/domain/document-v2-command-schemas"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import {
  commandIdSchema,
  draftIdSchema,
  partIdSchema,
  sessionIdSchema,
} from "@vibeshape/domain/identifiers"
import { describe, expect, it } from "vitest"
import {
  type AuthorityCommitInput,
  type AuthorityDocumentRepositoryPort,
  createAuthorityPersistenceAdapter,
} from "./authority-persistence-adapter"
import { runtimeProjection } from "./authority-persistence-operations"

const id = (n: number) => `0195b5ac-b250-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = { type: "user", userId: null } as const
const issuedAt = "2026-10-03T00:00:00.000Z"
const sessionId = sessionIdSchema.parse(id(90))
const lease = { epoch: 1, nowMs: Date.parse(issuedAt) }
const migration = {
  migrationProvenance: "current",
  migrationDiagnostic: null,
  unavailableRecords: [],
} as const
function success<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value))
  return value as Extract<T, { ok: true }>
}
function initial() {
  const created = success(
    applyVersionedDocumentCommand(null, {
      schemaVersion: 1,
      kind: "org.vibeshape.document.create",
      commandId: id(2),
      documentId: id(1),
      baseRevision: 0,
      issuedAt,
      actor,
      payload: { name: "Authored parts" },
    }),
  )
  const box = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(3),
    type: boxFeatureType.type,
    label: "Block",
    parameters: {
      width: createLengthQuantity(20),
      depth: createLengthQuantity(10),
      height: createLengthQuantity(5),
      centered: false,
    },
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const inserted = success(
    applyVersionedDocumentCommand(created.snapshot, {
      schemaVersion: 1,
      kind: "org.vibeshape.history.insert-feature",
      commandId: id(4),
      documentId: id(1),
      baseRevision: 1,
      issuedAt,
      actor,
      payload: { feature: box, historyAfter: null },
    }),
  )
  const upgraded = success(
    applyDocumentUpgradeV2Command(inserted.snapshot, {
      schemaVersion: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      commandId: id(5),
      documentId: id(1),
      baseRevision: 2,
      issuedAt,
      actor,
      payload: {
        partAllocations: [
          {
            id: id(6),
            name: "Base",
            body: { schemaVersion: 0, featureId: id(3), outputRole: "result" },
            origin: "independent",
          },
        ],
      },
    }),
  )
  return { v1: inserted.snapshot, v2: upgraded.snapshot }
}
function fixture(seed: DocumentAuthoritySnapshot = initial().v2) {
  let stored = seed
  let failWrite = false
  let identity = 200
  const writes: AuthorityCommitInput[] = []
  const repository: AuthorityDocumentRepositoryPort = {
    async commit(input) {
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async commitDraft(input) {
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async recover() {
      throw new Error("Use authority recovery")
    },
    async closeCleanly() {
      return { ok: true, value: undefined }
    },
    async commitAuthority(input) {
      writes.push(input)
      if (failWrite)
        return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async commitAuthorityDraft(input) {
      if (failWrite)
        return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async recoverAuthority() {
      return {
        ok: true,
        value: {
          status: "clean",
          snapshot: stored,
          headRevision: stored.revision,
          recoveredRevision: stored.revision,
          lostRevisionCount: 0,
          corruptRecords: [],
          migration,
        },
      }
    },
    async closeAuthorityCleanly() {
      return { ok: true, value: undefined }
    },
  }
  const adapter = createAuthorityPersistenceAdapter(
    repository,
    (requirement, feature, ordinal) => ({
      ...requirement,
      id: partIdSchema.parse(id(identity++)),
      name: feature?.label ?? `Part ${ordinal}`,
    }),
    seed,
  )
  const current = () => {
    const snapshot = adapter.currentAuthoritySnapshot
    if (!snapshot) throw new Error("Missing authority")
    return snapshot
  }
  const runtime = () => success(runtimeProjection(current())).snapshot
  const envelope = (n: number) => ({
    schemaVersion: 2 as const,
    commandId: commandIdSchema.parse(id(n)),
    documentId: current().id,
    baseRevision: current().revision,
    issuedAt,
    actor,
  })
  const metadata = (n: number, payload: DocumentV2MetadataChange) =>
    adapter.authoredMetadata.apply({
      sessionId,
      lease,
      baseSnapshot: runtime(),
      command: { ...envelope(n), kind: "org.vibeshape.document.metadata-command", payload },
    })
  const navigate = (n: number, direction: "undo" | "redo") =>
    adapter.history.navigate({
      sessionId,
      lease,
      baseSnapshot: runtime(),
      request: {
        commandId: commandIdSchema.parse(id(n)),
        documentId: current().id,
        baseRevision: current().revision,
        issuedAt,
        actor,
        direction,
      },
    })
  return {
    adapter,
    repository,
    writes,
    current,
    runtime,
    envelope,
    metadata,
    navigate,
    fail: (value: boolean) => {
      failWrite = value
    },
  }
}
function part(snapshot: DocumentAuthoritySnapshot) {
  if (snapshot.schemaVersion !== 2 || !snapshot.parts[0]) throw new Error("Missing authored part")
  return snapshot.parts[0]
}

describe("authored authority persistence adapter", () => {
  it("restores part names and visibility together through undo and redo", async () => {
    const f = fixture()
    const partId = part(f.current()).id
    success(await f.metadata(10, { kind: "part.rename", partId, name: "Mount" }))
    success(await f.metadata(11, { kind: "part.set-visibility", partId, visible: false }))
    expect(part(f.current())).toMatchObject({ id: partId, name: "Mount", visible: false })
    expect(Object.keys(f.writes[0] ?? {}).sort()).toEqual(
      ["sessionId", "lease", "storedAt", "baseSnapshot", "event", "snapshot"].sort(),
    )
    success(await f.navigate(12, "undo"))
    expect(part(f.current())).toMatchObject({ id: partId, name: "Mount", visible: true })
    success(await f.navigate(13, "undo"))
    expect(part(f.current()).name).toBe("Base")
    success(await f.navigate(14, "redo"))
    success(await f.navigate(15, "redo"))
    expect(part(f.current())).toMatchObject({ id: partId, name: "Mount", visible: false })
    expect(f.runtime().features).toEqual(success(runtimeProjection(initial().v2)).snapshot.features)
  })

  it("preserves authored part metadata when an MCP operation edits geometry", async () => {
    const f = fixture()
    const partId = part(f.current()).id
    success(await f.metadata(10, { kind: "part.rename", partId, name: "Human name" }))
    success(await f.metadata(11, { kind: "part.set-visibility", partId, visible: false }))
    const before = f.runtime()
    const feature = before.features[0]
    if (!feature) throw new Error("Missing fixture feature")
    const changed = success(
      applyDocumentCommand(before, {
        ...f.envelope(12),
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        actor: { type: "mcp", clientId: "org.vibeshape.test", sessionId },
        payload: {
          feature: {
            ...feature,
            parameters: { ...feature.parameters, height: createLengthQuantity(12) },
          },
        },
      }),
    )
    success(
      await f.adapter.commit({
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: before,
        event: changed.event,
        snapshot: changed.snapshot,
      }),
    )
    expect(part(f.current())).toMatchObject({ id: partId, name: "Human name", visible: false })
    expect(f.writes.at(-1)?.event).toMatchObject({
      type: "org.vibeshape.document.model-changed",
      actor: { type: "mcp" },
      modelEvent: { actor: { type: "mcp" } },
    })
    expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(12))
  })

  it("does not advance authority or undo on a failed metadata write", async () => {
    const f = fixture()
    const before = f.current()
    f.fail(true)
    expect(
      (await f.metadata(10, { kind: "part.rename", partId: part(before).id, name: "Lost" })).ok,
    ).toBe(false)
    expect(f.current()).toEqual(before)
    expect(f.adapter.history?.availability.canUndo).toBe(false)
    f.fail(false)
    success(await f.metadata(10, { kind: "part.rename", partId: part(before).id, name: "Saved" }))
    expect(part(f.current()).name).toBe("Saved")
  })

  it("rejects stale metadata and forged runtime snapshots before persistence", async () => {
    const f = fixture()
    const command = {
      ...f.envelope(10),
      kind: "org.vibeshape.document.metadata-command",
      payload: { kind: "part.rename", partId: part(f.current()).id, name: "Changed" },
    }
    const stale = await f.adapter.authoredMetadata.apply({
      sessionId,
      lease,
      baseSnapshot: f.runtime(),
      command: { ...command, baseRevision: 0 },
    })
    const forged = await f.adapter.authoredMetadata.apply({
      sessionId,
      lease,
      baseSnapshot: { ...f.runtime(), name: "Forged" },
      command,
    })
    expect(stale.ok).toBe(false)
    expect(forged.ok).toBe(false)
    expect(f.writes).toHaveLength(0)
  })

  it("captures upgrade identities once and preserves the old model and revision prefix", async () => {
    const seed = initial().v1
    const f = fixture(seed)
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: { ...f.envelope(10), kind: "org.vibeshape.document.upgrade-v2", payload: {} },
      }),
    )
    expect(f.current()).toMatchObject({
      schemaVersion: 2,
      revision: seed.revision + 1,
      features: seed.features,
      history: seed.history,
    })
    expect(part(f.current())).toMatchObject({ id: id(200), name: "Block" })
    expect(f.writes[0]?.baseSnapshot).toEqual(seed)
    expect(f.writes[0]?.event.type).toBe("org.vibeshape.document.upgraded-v2")
    expect(f.adapter.history?.availability.canUndo).toBe(false)
  })

  it("keeps a multi-operation model draft atomic and gives it one undo checkpoint", async () => {
    const f = fixture()
    const base = f.runtime()
    const transactionId = draftIdSchema.parse(id(80))
    const first = success(
      applyDocumentCommand(
        base,
        {
          ...f.envelope(10),
          schemaVersion: 1,
          kind: "org.vibeshape.document.rename",
          payload: { name: "Renamed" },
        },
        { transactionId },
      ),
    )
    const second = success(
      applyDocumentCommand(
        first.snapshot,
        {
          ...f.envelope(11),
          baseRevision: first.snapshot.revision,
          schemaVersion: 1,
          kind: "org.vibeshape.document.rename",
          payload: { name: "Final" },
        },
        { transactionId },
      ),
    )
    const input = {
      sessionId,
      lease,
      storedAt: issuedAt,
      transactionId,
      baseSnapshot: base,
      events: [first.event, second.event],
      snapshot: second.snapshot,
    }
    f.fail(true)
    expect((await f.adapter.commitDraft(input)).ok).toBe(false)
    expect(f.current().name).toBe(base.name)
    f.fail(false)
    success(await f.adapter.commitDraft(input))
    expect(f.current().name).toBe("Final")
    success(await f.navigate(12, "undo"))
    expect(f.current().name).toBe(base.name)
    expect(f.adapter.history?.availability.canUndo).toBe(false)
  })

  it("recovers full authored metadata while resetting only transient undo checkpoints", async () => {
    const f = fixture()
    success(
      await f.metadata(10, { kind: "part.rename", partId: part(f.current()).id, name: "Durable" }),
    )
    const recovered = success(await f.adapter.recover(f.current().id))
    expect(part(f.current()).name).toBe("Durable")
    expect(recovered.value.snapshot.schemaVersion).toBe(0)
    expect(f.adapter.history?.availability.canUndo).toBe(false)
    expect(f.adapter.authoredMetadata?.snapshot).toEqual(f.current())
  })
})

describe("surface texture persistence and undo", () => {
  it("persists one first Apply event and restores layers with one undo and redo", async () => {
    const f = fixture()
    const base = f.current()
    const feature = base.features[0]
    if (!feature) throw new Error("Missing fixture feature")
    const { createDefaultSurfaceTextureLayer, surfaceTextureLayerIdSchema } = await import(
      "@vibeshape/domain/surface-textures"
    )
    const layer = createDefaultSurfaceTextureLayer(
      feature.id,
      "result",
      surfaceTextureLayerIdSchema.parse(id(400)),
    )
    const original = f.runtime().features
    const apply = () =>
      f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: {
          ...f.envelope(400),
          schemaVersion: 3,
          kind: "org.vibeshape.document.metadata-command",
          payload: { kind: "textures.replace-layers", featureId: feature.id, layers: [layer] },
        },
      })
    f.fail(true)
    expect((await apply()).ok).toBe(false)
    expect(f.current()).toEqual(base)
    expect(f.adapter.history.availability.canUndo).toBe(false)
    f.fail(false)
    success(await apply())
    const applied = f.current()
    expect(applied.schemaVersion).toBe(3)
    if (applied.schemaVersion !== 3) throw new Error("Missing texture authority")
    expect(applied.surfaceTextures).toEqual([layer])
    expect(f.writes.at(-1)?.event.type).toBe("org.vibeshape.document.upgraded-v3")
    expect(f.current().revision).toBe(base.revision + 1)
    expect(f.runtime().features).toEqual(original)
    success(await f.navigate(401, "undo"))
    const undone = f.current()
    if (undone.schemaVersion !== 3) throw new Error("Undo downgraded texture authority")
    expect(undone.surfaceTextures).toEqual([])
    success(await f.navigate(402, "redo"))
    const redone = f.current()
    if (redone.schemaVersion !== 3) throw new Error("Missing redone texture authority")
    expect(redone.surfaceTextures).toEqual([layer])
    success(
      await f.metadata(403, {
        kind: "part.rename",
        partId: part(base).id,
        name: "Textured base",
      }),
    )
    const renamed = f.current()
    if (renamed.schemaVersion !== 3) throw new Error("Metadata downgraded texture authority")
    expect(renamed.surfaceTextures).toEqual([layer])
    expect(renamed.parts[0]?.name).toBe("Textured base")
    success(await f.adapter.recover(base.id))
    expect(f.current()).toEqual(renamed)
  })
})
