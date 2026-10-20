import { describe, expect, it } from "bun:test"
import {
  applyDocumentCommand,
  applyDocumentV3Command,
  applyVersionedDocumentCommand,
  booleanFeatureType,
  boxFeatureType,
  canonicalJson,
  createLengthQuantity,
  featureRecordSchema,
} from "@vibeshape/domain"
import type { CommandActor } from "@vibeshape/domain/commands"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type { DocumentV2MetadataChange } from "@vibeshape/domain/document-v2-command-schemas"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import { replayDocumentAuthorityEvents } from "@vibeshape/domain/document-v2-replay"
import { applyDocumentV4Command } from "@vibeshape/domain/document-v4-commands"
import {
  commandIdSchema,
  draftIdSchema,
  partIdSchema,
  sessionIdSchema,
} from "@vibeshape/domain/identifiers"
import { sourceAssetSchema } from "@vibeshape/domain/source-assets"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  historyRepairFixture,
  repairId,
  repairRemovalCommand,
} from "../../domain/src/history-repair.test-fixture"
import {
  type AuthorityCommitInput,
  type AuthorityDocumentRepositoryPort,
  type AuthorityDraftInput,
  createAuthorityPersistenceAdapter,
} from "./authority-persistence-adapter"
import { runtimeProjection } from "./authority-persistence-operations"
import { DocumentUndoHistory } from "./document-undo-history"
import {
  type DocumentHistoryPreview,
  PersistentDocumentSession,
} from "./persistent-document-session"

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
  let publicationAttempts = 0
  const writes: AuthorityCommitInput[] = []
  const drafts: AuthorityDraftInput[] = []
  const repository: AuthorityDocumentRepositoryPort = {
    async commit(input) {
      publicationAttempts += 1
      if (failWrite)
        return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async commitDraft(input) {
      publicationAttempts += 1
      if (failWrite)
        return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
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
      publicationAttempts += 1
      writes.push(input)
      if (failWrite)
        return { ok: false, diagnostic: { code: "quota", message: "full", retryable: true } }
      stored = input.snapshot
      return { ok: true, value: undefined }
    },
    async commitAuthorityDraft(input) {
      publicationAttempts += 1
      drafts.push(input)
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
    publicationAttempts: () => publicationAttempts,
    repository,
    writes,
    drafts,
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
  if (snapshot.schemaVersion === 1 || !snapshot.parts[0]) throw new Error("Missing authored part")
  return snapshot.parts[0]
}

const assistantActor = { type: "mcp", clientId: "org.vibeshape.assistant", sessionId } as const
async function checkpointRename(
  f: ReturnType<typeof fixture>,
  n: number,
  name: string,
  by: CommandActor = assistantActor,
) {
  const base = f.runtime()
  const changed = success(
    applyDocumentCommand(base, {
      ...f.envelope(n),
      schemaVersion: 1,
      actor: by,
      kind: "org.vibeshape.document.rename",
      payload: { name },
    }),
  )
  success(
    await f.adapter.commit({
      sessionId,
      lease,
      storedAt: issuedAt,
      baseSnapshot: base,
      event: changed.event,
      snapshot: changed.snapshot,
    }),
  )
}

type CheckpointUpgrade = "texture" | "import" | "repair" | "cascade"
async function checkpointUpgrade(
  f: ReturnType<typeof fixture>,
  kind: CheckpointUpgrade,
  by: CommandActor = assistantActor,
) {
  const base = f.current()
  const feature = base.features[0]
  if (!feature) throw new Error("Missing upgrade feature")
  const { createDefaultSurfaceTextureLayer, surfaceTextureLayerIdSchema } = await import(
    "@vibeshape/domain/surface-textures"
  )
  const change = {
    kind: "textures.replace-layers",
    featureId: feature.id,
    layers: [
      createDefaultSurfaceTextureLayer(
        feature.id,
        "result",
        surfaceTextureLayerIdSchema.parse(id(1510)),
      ),
    ],
  }
  const removal = {
    schemaVersion: 5,
    kind: "org.vibeshape.history.remove-retaining-dependents",
    payload: { target: { kind: "feature", id: feature.id } },
  }
  if (kind === "texture" || kind === "repair")
    return f.adapter.authoredMetadata.apply({
      sessionId,
      lease,
      baseSnapshot: f.runtime(),
      command: {
        ...f.envelope(1511),
        actor: by,
        ...(kind === "texture"
          ? { schemaVersion: 3, kind: "org.vibeshape.document.metadata-command", payload: change }
          : removal),
      },
    })
  let revision = base.revision
  let ordinal = 1520
  const command = (schemaVersion: number, kind: string, payload: unknown) => ({
    ...f.envelope(ordinal++),
    schemaVersion,
    actor: by,
    baseRevision: revision++,
    kind,
    payload,
  })
  const body = part(base).bodyHistory[0]
  if (!body) throw new Error("Missing assembly source body")
  const frame = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  const bytes = new Uint8Array([1, 2, 3])
  const digest = "a".repeat(64)
  const asset = sourceAssetSchema.parse({
    id: id(1540),
    digest,
    byteLength: bytes.byteLength,
    filename: "Turn.step",
    format: "step",
    representation: "exact-solid",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [id(1541)],
  })
  const commands = [
    command(3, "org.vibeshape.document.upgrade-v3", { change: null }),
    command(4, "org.vibeshape.document.upgrade-v4", {}),
    command(4, "org.vibeshape.document.add-source-assets", { assets: [asset] }),
    command(4, "org.vibeshape.document.assembly-command", {
      changes: [
        {
          kind: "definition.create",
          definition: {
            schemaVersion: 1,
            id: id(1542),
            name: "Turn component",
            sources: [{ kind: "part", partId: part(base).id, body, contentHash: "b".repeat(64) }],
            sourceFrame: frame,
          },
        },
        {
          kind: "instance.create",
          instance: {
            schemaVersion: 1,
            id: id(1543),
            definitionId: id(1542),
            name: "Turn occurrence",
            grounded: true,
            worldFrame: frame,
          },
        },
      ],
    }),
  ]
  if (kind === "cascade") commands.push(command(5, removal.kind, removal.payload))
  return f.adapter.authoredTransaction.apply({
    sessionId,
    lease,
    baseSnapshot: f.runtime(),
    command: { transactionId: id(1550), commands, assetBlobs: [{ digest, bytes }] },
  })
}

describe("internal assistant history checkpoints", () => {
  it.each([3, 4])(
    "does not offer Undo for an empty V%s adoption followed by a failed model save",
    async (version) => {
      const original = initial().v2
      const seed =
        version === 3
          ? original
          : success(
              applyDocumentV3Command(original, {
                schemaVersion: 3,
                kind: "org.vibeshape.document.upgrade-v3",
                commandId: id(1600),
                documentId: original.id,
                baseRevision: original.revision,
                issuedAt,
                actor,
                payload: { change: null },
              }),
            ).snapshot
      const f = fixture(seed)
      const checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing checkpoint port")
      const handle = checkpoints.capture((value) => value.type === "mcp")
      if (!handle) throw new Error("Missing baseline")
      success(
        await f.adapter.authoredMetadata.apply({
          sessionId,
          lease,
          baseSnapshot: f.runtime(),
          command: {
            ...f.envelope(1601),
            schemaVersion: version,
            actor: assistantActor,
            kind:
              version === 3
                ? "org.vibeshape.document.upgrade-v3"
                : "org.vibeshape.document.upgrade-v4",
            payload: version === 3 ? { change: null } : {},
          },
        }),
      )
      f.fail(true)
      expect(
        (await f.metadata(1602, { kind: "part.rename", partId: part(seed).id, name: "Unsaved" }))
          .ok,
      ).toBe(false)
      expect(checkpoints.read(handle)).toEqual({ revision: seed.revision + 1, changed: false })
      expect(checkpoints.preview(handle)).toBeNull()
      expect(f.current()).toMatchObject({
        schemaVersion: version,
        parts: [part(seed)],
        features: seed.features,
      })
    },
  )

  it.each(["texture", "import", "repair", "cascade"] as const)(
    "preserves a V2 turn baseline across %s authority adoption and restores through the current schema",
    async (kind) => {
      const seed = initial().v2
      const f = fixture(seed)
      success(
        await f.metadata(1500, {
          kind: "part.set-visibility",
          partId: part(seed).id,
          visible: false,
        }),
      )
      const baseline = f.current()
      const baselineContent = canonicalJson(baseline)
      const checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing checkpoint port")
      const handle = checkpoints.capture(
        (value) =>
          value.type === "mcp" &&
          value.clientId === assistantActor.clientId &&
          value.sessionId === sessionId,
      )
      if (!handle) throw new Error("Missing baseline")
      await checkpointRename(f, 1501, "Before upgrade")
      success(await checkpointUpgrade(f, kind))
      await checkpointRename(f, 1560, "After upgrade")
      const saved = f.current()
      const savedContent = canonicalJson(saved)
      expect(checkpoints.read(handle)).toEqual({ revision: saved.revision, changed: true })
      expect(checkpoints.seal(handle, saved.revision)).toBe(true)
      expect(checkpoints.preview(handle)?.authority).toEqual(baseline)
      expect(canonicalJson(checkpoints.preview(handle)?.authority)).toBe(baselineContent)
      expect(canonicalJson(f.current())).toBe(savedContent)
      const attempts = f.publicationAttempts()
      success(
        await checkpoints.restore({
          handle,
          sessionId,
          lease,
          baseSnapshot: f.runtime(),
          request: {
            direction: "undo",
            commandId: commandIdSchema.parse(id(1561)),
            documentId: saved.id,
            baseRevision: saved.revision,
            issuedAt,
            actor,
          },
        }),
      )
      expect(f.publicationAttempts()).toBe(attempts + 1)
      expect(f.current()).toMatchObject({
        schemaVersion: saved.schemaVersion,
        revision: saved.revision + 1,
        name: baseline.name,
        parts: [part(baseline)],
        features: baseline.features,
        history: baseline.history,
      })
      expect(f.writes.at(-1)?.event).toMatchObject({
        schemaVersion: saved.schemaVersion,
        type: "org.vibeshape.document.restored",
        targetRevision: baseline.revision,
      })
      expect(checkpoints.read(handle)).toBeNull()
      success(await f.navigate(1562, "redo"))
      expect(f.current()).toEqual({ ...saved, revision: saved.revision + 2, updatedAt: issuedAt })
      if (kind === "import" || kind === "cascade") {
        expect(f.current()).toMatchObject({
          assets: [{ filename: "Turn.step" }],
          assembly: {
            definitions: [{ pinnedModels: [expect.anything()] }],
            instances: [{ name: "Turn occurrence", grounded: true }],
          },
        })
        expect(f.drafts[0]?.assetBlobs?.[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]))
      }
      const events = [
        ...f.writes.map(({ event }) => event),
        ...f.drafts.flatMap(({ events }) => events),
      ].sort((a, b) => a.revision - b.revision)
      expect(success(replayDocumentAuthorityEvents(seed, events)).snapshot).toEqual(f.current())
    },
  )

  it("keeps a captured baseline on failed upgrade and checks transaction budget against the actual pre-upgrade head", async () => {
    const f = fixture()
    const checkpoints = f.adapter.history.checkpoints
    if (!checkpoints) throw new Error("Missing checkpoint port")
    const handle = checkpoints.capture((value) => value.type === "mcp")
    if (!handle) throw new Error("Missing baseline")
    await checkpointRename(f, 1570, "Saved before upgrade")
    const before = f.current()
    f.fail(true)
    expect((await checkpointUpgrade(f, "import")).ok).toBe(false)
    expect(f.current()).toBe(before)
    expect(checkpoints.read(handle)).toEqual({ revision: before.revision, changed: true })
    f.fail(false)
    const attempts = f.publicationAttempts()
    const policy = vi
      .spyOn(DocumentUndoHistory.prototype, "permitsPublication")
      .mockImplementation(function (this: DocumentUndoHistory, base) {
        return base.revision !== before.revision
      })
    try {
      expect(await checkpointUpgrade(f, "import")).toMatchObject({
        ok: false,
        diagnostic: { code: "checkpoint-budget-exceeded" },
      })
      expect(f.publicationAttempts()).toBe(attempts)
      expect(f.current()).toBe(before)
      expect(checkpoints.read(handle)).toEqual({ revision: before.revision, changed: true })
    } finally {
      policy.mockRestore()
    }
  })

  it.each([actor, { ...assistantActor, sessionId: sessionIdSchema.parse(id(1580)) }])(
    "invalidates a turn baseline when another actor performs an authority upgrade: %j",
    async (by) => {
      const f = fixture()
      const checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing checkpoint port")
      const handle = checkpoints.capture((value) => value.type === "mcp")
      if (!handle) throw new Error("Missing baseline")
      await checkpointRename(f, 1581, "Owning actor save")
      success(await checkpointUpgrade(f, "import", by))
      expect(checkpoints.read(handle)).toBeNull()
      expect(checkpoints.preview(handle)).toBeNull()
    },
  )

  it.each([1, 2])(
    "releases internal handles and ordinary stacks when authority v%s closes",
    async (version) => {
      const f = fixture(version === 1 ? initial().v1 : initial().v2)
      const checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing checkpoint port")
      const handle = checkpoints.capture(() => true)
      if (!handle) throw new Error("Missing baseline")
      await checkpointRename(f, 1590, "Saved turn")
      success(
        await f.adapter.closeCleanly({
          documentId: f.current().id,
          revision: f.current().revision,
          sessionId,
          lease,
        }),
      )
      expect(checkpoints.read(handle)).toBeNull()
      expect(f.adapter.history.availability).toEqual({ canUndo: false, canRedo: false })
    },
  )

  it.each([1, 2])(
    "rejects v%s publication before repository access and preserves the last saved checkpoint on quota or budget failure",
    async (version) => {
      const f = fixture(version === 1 ? initial().v1 : initial().v2),
        checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing checkpoint port")
      const handle = checkpoints.capture((value) => value.type === "mcp")
      if (!handle) throw new Error("Missing baseline")
      await checkpointRename(f, 1401, "Checkpoint budget fixture")
      const base = f.runtime(),
        savedAuthority = f.current()
      const command = {
        ...f.envelope(1402),
        schemaVersion: 1,
        actor: assistantActor,
        kind: "org.vibeshape.document.rename",
        payload: { name: "Rejected unsaved change" },
      }
      const change = success(applyDocumentCommand(base, command))
      const input = {
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: base,
        event: change.event,
        snapshot: change.snapshot,
      }
      const original = DocumentUndoHistory.prototype.permitsPublication
      let blocked = false
      const policy = vi
        .spyOn(DocumentUndoHistory.prototype, "permitsPublication")
        .mockImplementation(function (this: DocumentUndoHistory, before, after, actors) {
          return before.name === "Checkpoint budget fixture" && blocked
            ? false
            : original.call(this, before, after, actors)
        })
      try {
        // A real repository failure leaves actor/head ownership and the saved Undo untouched.
        f.fail(true)
        expect((await f.adapter.commit(input)).ok).toBe(false)
        f.fail(false)
        const writes = f.writes.length,
          drafts = f.drafts.length,
          attempts = f.publicationAttempts()
        blocked = true
        const failure = {
          ok: false,
          diagnostic: {
            code: "checkpoint-budget-exceeded",
            message: "The model change exceeds the assistant checkpoint limit and was not saved.",
          },
        }
        expect(await f.adapter.commit(input)).toMatchObject(failure)
        expect(
          await f.adapter.commitDraft({
            ...input,
            transactionId: draftIdSchema.parse(id(1403)),
            events: [change.event],
          }),
        ).toMatchObject(failure)
        if (version === 2) {
          expect(
            await f.adapter.authoredTransaction.apply({
              sessionId,
              lease,
              baseSnapshot: base,
              command: { transactionId: id(1404), commands: [command] },
            }),
          ).toMatchObject(failure)
          expect(
            await f.adapter.authoredMetadata.apply({
              sessionId,
              lease,
              baseSnapshot: base,
              command: {
                ...f.envelope(1405),
                actor: assistantActor,
                kind: "org.vibeshape.document.metadata-command",
                payload: {
                  kind: "part.rename",
                  partId: part(savedAuthority).id,
                  name: "Unsaved part",
                },
              },
            }),
          ).toMatchObject(failure)
        }
        expect(f.current()).toEqual(savedAuthority)
        expect(f.publicationAttempts()).toBe(attempts)
        expect(f.writes).toHaveLength(writes)
        expect(f.drafts).toHaveLength(drafts)
        expect(checkpoints.read(handle)).toEqual({
          revision: savedAuthority.revision,
          changed: true,
        })
        blocked = false
        success(await f.adapter.commit(input))
        expect(checkpoints.read(handle)).toEqual({
          revision: savedAuthority.revision + 1,
          changed: true,
        })
      } finally {
        policy.mockRestore()
      }
    },
  )

  it.each([1, 2, 4, 5])(
    "restores a whole saved series once and makes it redoable for authority v%s",
    async (version) => {
      const seed =
        version === 1
          ? initial().v1
          : version === 2
            ? initial().v2
            : version === 4
              ? assetAuthority()
              : historyRepairFixture()
      const f = fixture(seed)
      const checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing internal checkpoint port.")
      const handle = checkpoints.capture(
        (value) => value.type === "mcp" && value.sessionId === sessionId,
      )
      if (!handle) throw new Error("Missing captured baseline.")
      expect(checkpoints.read(handle)).toEqual({ revision: seed.revision, changed: false })
      await checkpointRename(f, 901, "First assistant save")
      await checkpointRename(f, 902, "Second assistant save")
      const resultRevision = f.current().revision
      expect(checkpoints.read(handle)).toEqual({ revision: resultRevision, changed: true })
      const availability = { ...f.adapter.history.availability },
        savedWrites = f.writes.length
      const preview = checkpoints.preview(handle)
      if (!preview) throw new Error("Missing internal before-view target.")
      expect(preview.authority).toEqual(seed)
      mutatePreviewTarget(preview)
      expect(checkpoints.preview(handle)?.authority).toEqual(seed)
      expect(f.writes).toHaveLength(savedWrites)
      expect(f.adapter.history.availability).toEqual(availability)
      const before = f.current()
      success(
        await checkpoints.restore({
          handle,
          sessionId,
          lease,
          baseSnapshot: f.runtime(),
          request: {
            direction: "undo",
            commandId: commandIdSchema.parse(id(903)),
            documentId: seed.id,
            baseRevision: resultRevision,
            issuedAt,
            actor,
          },
        }),
      )
      expect(f.current()).toMatchObject({
        name: seed.name,
        revision: resultRevision + 1,
        features: seed.features,
        history: seed.history,
      })
      expect(checkpoints.read(handle)).toBeNull()
      expect(f.adapter.history.availability.canRedo).toBe(true)
      success(await f.navigate(904, "redo"))
      expect(f.current()).toMatchObject({
        name: before.name,
        revision: resultRevision + 2,
        history: before.history,
      })
    },
  )

  it("pins a baseline beyond ordinary Undo retention and rejects forged, stale, or failed restore requests", async () => {
    const f = fixture(),
      baseline = f.current()
    const checkpoints = f.adapter.history.checkpoints
    if (!checkpoints) throw new Error("Missing internal checkpoint port.")
    const handle = checkpoints.capture((value) => value.type === "mcp")
    if (!handle) throw new Error("Missing captured baseline.")
    for (let n = 0; n < 105; n += 1) await checkpointRename(f, 1000 + n, `Saved stage ${n}`)
    const request = {
      direction: "undo" as const,
      commandId: commandIdSchema.parse(id(1200)),
      documentId: baseline.id,
      baseRevision: f.current().revision,
      issuedAt,
      actor,
    }
    const input = { handle, sessionId, lease, baseSnapshot: f.runtime(), request }
    const count = f.writes.length
    expect((await checkpoints.restore({ ...input, handle: { id: Symbol("forged") } })).ok).toBe(
      false,
    )
    expect(
      (
        await checkpoints.restore({
          ...input,
          request: { ...request, baseRevision: baseline.revision },
        })
      ).ok,
    ).toBe(false)
    expect(f.writes).toHaveLength(count)
    f.fail(true)
    expect((await checkpoints.restore(input)).ok).toBe(false)
    expect(checkpoints.read(handle)).toEqual({ revision: request.baseRevision, changed: true })
    f.fail(false)
    success(await checkpoints.restore(input))
    expect(f.current()).toMatchObject({ name: baseline.name, revision: request.baseRevision + 1 })
    expect(f.writes.at(-1)?.event).toMatchObject({
      type: "org.vibeshape.document.restored",
      targetRevision: baseline.revision,
    })
  })

  it.each(["human", "rotated", "unavailable"])(
    "refuses to undo intervening %s authority without overwriting it",
    async (kind) => {
      const f = fixture(),
        checkpoints = f.adapter.history.checkpoints
      if (!checkpoints) throw new Error("Missing internal checkpoint port.")
      let available = true
      const handle = checkpoints.capture((value) => {
        if (!available) throw new Error("Actor owner unavailable")
        return value.type === "mcp"
      })
      if (!handle) throw new Error("Missing captured baseline.")
      await checkpointRename(f, 1301, "Assistant save")
      if (kind === "unavailable") available = false
      const by =
        kind === "human" ? actor : { ...assistantActor, sessionId: sessionIdSchema.parse(id(91)) }
      await checkpointRename(f, 1302, "Intervening save", by)
      expect(checkpoints.read(handle)).toBeNull()
      const count = f.writes.length,
        before = f.current()
      expect(
        (
          await checkpoints.restore({
            handle,
            sessionId,
            lease,
            baseSnapshot: f.runtime(),
            request: {
              direction: "undo",
              commandId: commandIdSchema.parse(id(1303)),
              documentId: before.id,
              baseRevision: before.revision,
              issuedAt,
              actor,
            },
          })
        ).ok,
      ).toBe(false)
      expect(f.current()).toEqual(before)
      expect(f.writes).toHaveLength(count)
    },
  )
})

function validationSession(f: ReturnType<typeof fixture>) {
  const unexpected = async (): Promise<never> => {
    throw new Error("Draft validation must not acquire a lease or rebuild geometry")
  }
  const rebuildPort = {
    rebuild: unexpected,
    exportDocument: unexpected,
    solveSketch: unexpected,
    dispose: unexpected,
    terminate() {},
  }
  return new PersistentDocumentSession({
    snapshot: f.runtime(),
    sessionId,
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
    leaseDurationMs: 30_000,
    lease: null,
    rebuildPort,
    dependencies: {
      commandDispatcher: { dispatch: applyDocumentCommand },
      repository: f.adapter,
      leases: { acquire: unexpected, release: unexpected },
      createRebuildPort: () => rebuildPort,
      now: () => lease.nowMs,
    },
  })
}

it("rejects a runtime-valid draft whose schema-2 Boolean depends on a later History item", async () => {
  const f = fixture()
  const source = f.runtime().features[0]
  if (!source) throw new Error("Missing fixture feature")
  const tool = { ...source, id: source.id.replace(/003$/, "007") }
  const boolean = featureRecordSchema.parse({
    ...source,
    id: id(8),
    type: booleanFeatureType.type,
    label: "Private authored model label",
    parameters: { operation: "subtract" },
    dependencies: [source.id, tool.id],
  })
  for (const [index, feature] of [tool, boolean].entries()) {
    const base = f.runtime()
    const added = success(
      applyDocumentCommand(base, {
        ...f.envelope(10 + index),
        schemaVersion: 1,
        kind: "org.vibeshape.feature.add",
        payload: { feature },
      }),
    )
    success(
      await f.adapter.commit({
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: base,
        ...added,
      }),
    )
  }
  const session = validationSession(f)
  const base = session.snapshot
  const before = f.current()
  const authorityJson = JSON.stringify(before)
  const history = { ...f.adapter.history.availability }
  const undoTarget = f.adapter.history.preview?.("undo")
  const writes = f.writes.length
  const replacement = { ...source, id: source.id.replace(/003$/, "009") }
  const firstCommand = {
    ...f.envelope(12),
    schemaVersion: 1,
    kind: "org.vibeshape.feature.add",
    payload: { feature: replacement },
  }
  const first = success(applyDocumentCommand(base, firstCommand))
  const secondCommand = {
    ...f.envelope(13),
    baseRevision: first.snapshot.revision,
    schemaVersion: 1,
    kind: "org.vibeshape.feature.update",
    payload: { feature: { ...boolean, dependencies: [replacement.id, tool.id] } },
  }
  const second = success(applyDocumentCommand(first.snapshot, secondCommand))
  const input = {
    draftId: id(80),
    commands: [firstCommand, secondCommand],
    expectedSnapshot: second.snapshot,
  }
  const result = await session.validateDraft(input)
  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: "invalid-draft-commit", sourceCode: "invalid-event" },
  })
  if (result.ok) throw new Error("Expected the later dependency to be rejected")
  expect(result.diagnostic.message).toContain(
    `Draft command 2 (${id(13)}, org.vibeshape.feature.update)`,
  )
  expect(result.diagnostic.message).toContain(
    "history: References must precede their consumers in history.",
  )
  expect(result.diagnostic.message).not.toContain(boolean.label)
  expect(result.diagnostic.message.length).toBeLessThanOrEqual(512)
  expect(session.snapshot).toBe(base)
  expect(session.mode).toBe("read-only")
  expect(f.current()).toBe(before)
  expect(JSON.stringify(f.current())).toBe(authorityJson)
  expect(f.writes).toHaveLength(writes)
  expect(f.drafts).toHaveLength(0)
  expect(f.adapter.history.availability).toEqual(history)
  expect(f.adapter.history.preview?.("undo")).toEqual(undoTarget)
  const committed = await f.adapter.commitDraft({
    sessionId,
    lease,
    storedAt: issuedAt,
    transactionId: draftIdSchema.parse(id(80)),
    baseSnapshot: base,
    events: [first.event, second.event],
    snapshot: second.snapshot,
  })
  expect(committed).toMatchObject({ ok: false, diagnostic: { message: result.diagnostic.message } })
  expect(f.drafts).toHaveLength(0)
})

it("validates ordinary authored model commands without saving or adding an undo checkpoint", async () => {
  const f = fixture()
  const session = validationSession(f)
  const base = session.snapshot
  const before = f.current()
  const authorityJson = JSON.stringify(before)
  const source = base.features[0]
  if (!source) throw new Error("Missing fixture feature")
  const command = {
    ...f.envelope(10),
    schemaVersion: 1,
    kind: "org.vibeshape.feature.add",
    payload: { feature: { ...source, id: source.id.replace(/003$/, "007") } },
  }
  const dispatched = success(applyDocumentCommand(base, command))
  expect(
    await session.validateDraft({
      draftId: id(80),
      commands: [command],
      expectedSnapshot: dispatched.snapshot,
    }),
  ).toEqual({ ok: true })
  expect(session.snapshot).toBe(base)
  expect(f.current()).toBe(before)
  expect(JSON.stringify(f.current())).toBe(authorityJson)
  expect(f.writes).toHaveLength(0)
  expect(f.drafts).toHaveLength(0)
  expect(f.adapter.history.availability).toEqual({ canUndo: false, canRedo: false })
})

function mutatePreviewTarget(target: DocumentHistoryPreview) {
  Reflect.set(target.snapshot.features[0]?.parameters ?? {}, "height", createLengthQuantity(999))
  Reflect.set(target.authority, "name", "Caller mutation")
  if (target.authority.schemaVersion === 4 && target.authority.assets[0])
    Reflect.set(target.authority.assets[0], "filename", "Caller mutation.step")
}

describe("authored authority persistence adapter", () => {
  it.each([
    { version: 1, seed: () => initial().v1 },
    { version: 2, seed: () => initial().v2 },
    { version: 4, seed: assetAuthority },
  ])(
    "previews owned v$version targets without moving stacks or losing authority, then preserves MCP restore actor",
    async ({ version, seed: createSeed }) => {
      const seed = createSeed()
      const f = fixture(seed)
      const before = f.runtime()
      const feature = before.features[0]
      if (!feature) throw new Error("Missing model feature")
      const change = success(
        applyDocumentCommand(before, {
          ...f.envelope(710),
          schemaVersion: 1,
          kind: "org.vibeshape.feature.update",
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
          event: change.event,
          snapshot: change.snapshot,
        }),
      )
      const availability = { ...f.adapter.history.availability }
      const target = f.adapter.history.preview?.("undo")
      if (!target) throw new Error("Missing read-only undo target")
      expect(target.targetRevision).toBe(seed.revision)
      expect(target.authority).toEqual(seed)
      mutatePreviewTarget(target)
      expect(f.adapter.history.preview?.("undo")?.authority).toEqual(seed)
      expect(f.adapter.history.availability).toEqual(availability)
      expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(12))
      const mcpActor = { type: "mcp", clientId: "org.example.history", sessionId } as const
      success(
        await f.adapter.history.navigate({
          sessionId,
          lease,
          baseSnapshot: f.runtime(),
          request: {
            commandId: commandIdSchema.parse(id(711)),
            documentId: before.id,
            baseRevision: f.current().revision,
            issuedAt,
            actor: mcpActor,
            direction: "undo",
          },
        }),
      )
      expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(5))
      if (version !== 1)
        expect(f.writes.at(-1)?.event).toMatchObject({
          type: "org.vibeshape.document.restored",
          actor: mcpActor,
          targetRevision: seed.revision,
        })
      expect(f.adapter.history.preview?.("redo")?.snapshot.features[0]?.parameters.height).toEqual(
        createLengthQuantity(12),
      )
    },
  )

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
    const checkpoints = f.adapter.history.checkpoints
    const handle = checkpoints?.capture(() => true)
    if (!handle) throw new Error("Missing checkpoint")
    success(
      await f.metadata(10, { kind: "part.rename", partId: part(f.current()).id, name: "Durable" }),
    )
    const recovered = success(await f.adapter.recover(f.current().id))
    expect(part(f.current()).name).toBe("Durable")
    expect(recovered.value.snapshot.schemaVersion).toBe(0)
    expect(f.adapter.history?.availability.canUndo).toBe(false)
    expect(checkpoints?.read(handle)).toBeNull()
    expect(f.adapter.authoredMetadata?.snapshot).toEqual(f.current())
  })
})

function assetAuthority() {
  const previous = initial().v2
  const base = success(
    applyDocumentV3Command(previous, {
      schemaVersion: 3,
      kind: "org.vibeshape.document.upgrade-v3",
      commandId: id(299),
      documentId: previous.id,
      baseRevision: previous.revision,
      issuedAt,
      actor,
      payload: { change: null },
    }),
  ).snapshot
  const upgraded = success(
    applyDocumentV4Command(base, {
      schemaVersion: 4,
      kind: "org.vibeshape.document.upgrade-v4",
      commandId: id(300),
      documentId: base.id,
      baseRevision: base.revision,
      issuedAt,
      actor,
      payload: {},
    }),
  )
  const asset = sourceAssetSchema.parse({
    id: id(301),
    digest: "a".repeat(64),
    byteLength: 12,
    filename: "Original.step",
    format: "step",
    representation: "exact-solid",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [id(302)],
  })
  return success(
    applyDocumentV4Command(upgraded.snapshot, {
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      commandId: id(303),
      documentId: base.id,
      baseRevision: upgraded.snapshot.revision,
      issuedAt,
      actor,
      payload: { assets: [asset] },
    }),
  ).snapshot
}

describe("source asset authority session writes", () => {
  it("retains source descriptors through metadata, undo, redo, replay and recovery", async () => {
    const seed = assetAuthority()
    const f = fixture(seed)
    success(
      await f.metadata(310, { kind: "part.rename", partId: part(seed).id, name: "Imported mount" }),
    )
    expect(f.current()).toMatchObject({ schemaVersion: 4, assets: seed.assets })
    expect(f.writes[0]?.event).toMatchObject({
      schemaVersion: 4,
      type: "org.vibeshape.document.authored-changed",
      authoredEvent: { schemaVersion: 3, type: "org.vibeshape.document.metadata-changed" },
    })
    success(await f.navigate(311, "undo"))
    expect(part(f.current()).name).toBe("Base")
    success(await f.navigate(312, "redo"))
    expect(part(f.current()).name).toBe("Imported mount")
    expect(
      success(
        replayDocumentAuthorityEvents(
          seed,
          f.writes.map((write) => write.event),
        ),
      ).snapshot,
    ).toEqual(f.current())
    const recovered = success(await f.adapter.recover(seed.id))
    expect(recovered.value.snapshot).toEqual(f.runtime())
    expect(f.current()).toMatchObject({ schemaVersion: 4, assets: seed.assets })
    expect(f.adapter.history.availability).toEqual({ canUndo: false, canRedo: false })
  })

  it("wraps ordinary geometry events and draft commits without downgrading assets", async () => {
    const seed = assetAuthority()
    const f = fixture(seed)
    const before = f.runtime()
    const feature = before.features[0]
    if (!feature) throw new Error("Missing fixture feature")
    const changed = success(
      applyDocumentCommand(before, {
        ...f.envelope(320),
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        payload: {
          feature: {
            ...feature,
            parameters: { ...feature.parameters, height: createLengthQuantity(9) },
          },
        },
      }),
    )
    success(
      await f.adapter.commitDraft({
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: before,
        events: [changed.event],
        snapshot: changed.snapshot,
        transactionId: draftIdSchema.parse(id(321)),
      }),
    )
    expect(f.current()).toMatchObject({ schemaVersion: 4, assets: seed.assets })
    expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(9))
    success(await f.navigate(322, "undo"))
    expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(5))
    success(await f.navigate(323, "redo"))
    expect(f.runtime().features[0]?.parameters.height).toEqual(createLengthQuantity(9))
    f.fail(true)
    const snapshot = f.current()
    expect(
      (await f.metadata(324, { kind: "part.rename", partId: part(seed).id, name: "Unsaved" })).ok,
    ).toBe(false)
    expect(f.current()).toBe(snapshot)
  })
})

it("publishes an authority upgrade, source bytes and authored change as one transaction with whole-authority undo", async () => {
  const seed = initial().v2
  const f = fixture(seed)
  const bytes = new Uint8Array([1, 2, 3])
  const hash = "a".repeat(64)
  const asset = sourceAssetSchema.parse({
    id: id(350),
    digest: hash,
    byteLength: bytes.byteLength,
    filename: "Original.step",
    format: "step",
    representation: "exact-solid",
    normalization: {
      sourceUnit: "millimeter",
      scaleToMillimeters: 1,
      normalizedUnit: "millimeter",
    },
    outputs: [id(351)],
  })
  const command = {
    transactionId: id(352),
    assetBlobs: [{ digest: hash, bytes }],
    commands: [
      {
        ...f.envelope(349),
        schemaVersion: 3,
        kind: "org.vibeshape.document.upgrade-v3",
        payload: { change: null },
      },
      {
        ...f.envelope(353),
        baseRevision: seed.revision + 1,
        schemaVersion: 4,
        kind: "org.vibeshape.document.upgrade-v4",
        payload: {},
      },
      {
        ...f.envelope(354),
        schemaVersion: 4,
        baseRevision: seed.revision + 2,
        kind: "org.vibeshape.document.add-source-assets",
        payload: { assets: [asset] },
      },
      {
        ...f.envelope(355),
        schemaVersion: 1,
        baseRevision: seed.revision + 3,
        kind: "org.vibeshape.document.rename",
        payload: { name: "Imported model" },
      },
    ],
  }
  const input = { sessionId, lease, baseSnapshot: f.runtime(), command }
  f.fail(true)
  expect((await f.adapter.authoredTransaction.apply(input)).ok).toBe(false)
  expect(f.current()).toBe(seed)
  expect(f.adapter.history.availability.canUndo).toBe(false)
  f.fail(false)
  success(await f.adapter.authoredTransaction.apply(input))
  const published = f.current()
  expect(published).toMatchObject({
    schemaVersion: 4,
    assets: [asset],
    name: "Imported model",
    revision: seed.revision + 4,
  })
  const draft = f.drafts.at(-1)
  expect(draft?.events).toHaveLength(4)
  expect(draft?.events.every((event) => event.transactionId === command.transactionId)).toBe(true)
  expect(draft?.assetBlobs).toEqual([{ digest: hash, bytes }])
  expect(draft?.assetBlobs?.[0]?.bytes).not.toBe(bytes)
  const replayed = success(replayDocumentAuthorityEvents(seed, draft?.events ?? [])).snapshot
  expect(replayed).toEqual(published)
  success(await f.navigate(356, "undo"))
  expect(f.current()).toMatchObject({ schemaVersion: 4, assets: [], name: seed.name })
  success(await f.navigate(357, "redo"))
  expect(f.current()).toMatchObject({ schemaVersion: 4, assets: [asset], name: "Imported model" })
  const before = f.current()
  const stale = await f.adapter.authoredTransaction.apply({ ...input, baseSnapshot: f.runtime() })
  expect(stale.ok).toBe(false)
  expect(f.current()).toBe(before)
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

describe("V5 retained History persistence", () => {
  it("persists disconnected feature metadata without losing its repair recipe through Undo and Redo", async () => {
    const before = historyRepairFixture()
    const f = fixture(before)
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: repairRemovalCommand(before.revision),
      }),
    )
    const base = f.runtime()
    const feature = base.features[0]
    if (!feature) throw new Error("Missing disconnected feature fixture.")
    const renamed = success(
      applyDocumentCommand(base, {
        ...f.envelope(510),
        schemaVersion: 1,
        kind: "org.vibeshape.feature.update",
        payload: { feature: { ...feature, label: "Renamed missing extrusion" } },
      }),
    )
    success(
      await f.adapter.commit({
        sessionId,
        lease,
        storedAt: issuedAt,
        baseSnapshot: base,
        event: renamed.event,
        snapshot: renamed.snapshot,
      }),
    )
    const renamedAuthority = f.current()
    if (renamedAuthority.schemaVersion !== 5) throw new Error("Missing V5 authority")
    expect(renamedAuthority.repairIntents[0]?.authored).toEqual<unknown>({
      ...before.features[0],
      label: "Renamed missing extrusion",
    })
    expect(f.adapter.committedSnapshot?.features[0]?.label).toBe("Renamed missing extrusion")
    success(await f.navigate(511, "undo"))
    expect(f.current()).toMatchObject({ repairIntents: [{ authored: before.features[0] }, {}, {}] })
    success(await f.navigate(512, "redo"))
    expect(f.current()).toMatchObject({
      repairIntents: renamedAuthority.repairIntents,
      suspendedParts: renamedAuthority.suspendedParts,
    })
    expect(
      success(
        replayDocumentAuthorityEvents(
          before,
          f.writes.map((write) => write.event),
        ),
      ).snapshot,
    ).toEqual(f.current())
  })
  it("saves deletion as one undoable revision and repairs through the authored History repair port", async () => {
    const before = historyRepairFixture()
    const f = fixture(before)
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: repairRemovalCommand(before.revision),
      }),
    )
    expect(f.current().schemaVersion).toBe(5)
    expect(f.adapter.history.availability.canUndo).toBe(true)
    expect(f.writes).toHaveLength(1)
    const root = before.features[0]
    const suspendedPart = before.parts[0]
    if (!root || !suspendedPart) throw new Error("Missing repair feature or part fixture.")
    const { semanticInputs: _semanticInputs, ...legacy } = root
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: {
          ...f.envelope(501),
          schemaVersion: 5,
          kind: "org.vibeshape.history.repair",
          payload: {
            item: {
              kind: "feature",
              feature: {
                ...legacy,
                schemaVersion: 0,
                parameters: {
                  ...root.parameters,
                  profiles: {
                    schemaVersion: 0,
                    profiles: [
                      {
                        schemaVersion: 0,
                        sketchId: repairId(2),
                        outerBoundaryEntityIds: [repairId(40)],
                        holeBoundaryEntityIds: [],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
    )
    const repaired = f.current()
    if (repaired.schemaVersion !== 5) throw new Error("Missing V5 authority")
    expect(repaired.repairIntents).toEqual([])
    expect(repaired.suspendedParts).toEqual([])
    expect(repaired.parts.find((part) => part.id === suspendedPart.id)).toEqual(suspendedPart)
    expect(f.adapter.committedSnapshot?.features.map((feature) => feature.type)).toEqual(
      before.features.map((feature) => feature.type),
    )
    success(await f.navigate(502, "undo"))
    expect(f.current().schemaVersion).toBe(5)
    success(await f.navigate(503, "redo"))
    expect(f.current()).toMatchObject({ repairIntents: [], parts: repaired.parts })
  })
  it("keeps authority and Undo unchanged when retained deletion cannot be saved", async () => {
    const before = historyRepairFixture()
    const f = fixture(before)
    f.fail(true)
    const result = await f.adapter.authoredMetadata.apply({
      sessionId,
      lease,
      baseSnapshot: f.runtime(),
      command: repairRemovalCommand(before.revision),
    })
    expect(result.ok).toBe(false)
    expect(f.current()).toEqual(before)
    expect(f.adapter.history.availability).toEqual({ canUndo: false, canRedo: false })
  })
  it("captures a fresh Part only when repairing a modifier into a new independent root", async () => {
    const before = historyRepairFixture()
    const f = fixture(before)
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: repairRemovalCommand(before.revision),
      }),
    )
    const box = f.runtime().features[3]
    if (!box) throw new Error("Missing independent feature fixture.")
    success(
      await f.adapter.authoredMetadata.apply({
        sessionId,
        lease,
        baseSnapshot: f.runtime(),
        command: {
          ...f.envelope(520),
          schemaVersion: 5,
          kind: "org.vibeshape.history.repair",
          payload: {
            item: { kind: "feature", feature: { ...box, id: repairId(4), label: "New body" } },
          },
        },
      }),
    )
    const repaired = f.current()
    if (repaired.schemaVersion !== 5) throw new Error("Missing V5 authority")
    const newPart = repaired.parts.find((part) => part.bodyHistory[0]?.featureId === repairId(4))
    expect(newPart).toMatchObject({ id: id(200), name: "New body" })
    expect(newPart?.bodyHistory.map((body) => body.featureId)).toEqual<unknown>([
      repairId(4),
      repairId(5),
    ])
    expect(repaired.repairIntents.map((intent) => intent.authored.id)).toEqual<unknown>([
      repairId(3),
    ])
    expect(repaired.suspendedParts).toEqual<unknown>([before.parts[0]])
    expect(
      success(
        replayDocumentAuthorityEvents(
          before,
          f.writes.map((write) => write.event),
        ),
      ).snapshot,
    ).toEqual(repaired)
  })
})

describe("History insertion persistence", () => {
  it("inserts before the first item in one commit and restores order through Undo/Redo", async () => {
    const f = fixture()
    const original = f.current()
    const insert = f.adapter.semanticHistory.insert
    if (!insert) throw new Error("Missing History insertion port")
    const feature = featureRecordSchema.parse({
      ...f.runtime().features[0],
      id: id(610),
      label: "Earlier block",
    })
    const insertion = {
      sessionId,
      lease,
      baseSnapshot: f.runtime(),
      command: {
        ...f.envelope(611),
        schemaVersion: 1,
        kind: "org.vibeshape.history.insert-feature",
        payload: { feature, historyAfter: null },
      },
    }
    success(await insert(insertion))
    expect(f.writes).toHaveLength(1)
    expect(f.current().history.map((item) => item.id)).toEqual<unknown>([
      feature.id,
      original.history[0]?.id,
    ])
    expect(f.current().revision).toBe(original.revision + 1)
    success(await f.navigate(612, "undo"))
    expect(f.current().history).toEqual(original.history)
    success(await f.navigate(613, "redo"))
    expect(f.current().history.map((item) => item.id)).toEqual<unknown>([
      feature.id,
      original.history[0]?.id,
    ])
    expect((await insert(insertion)).ok).toBe(false)
    expect(f.writes).toHaveLength(3)
  })
})
