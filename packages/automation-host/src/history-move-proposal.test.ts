import { describe, expect, it } from "bun:test"
import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import { projectDocumentSnapshotV1ToV0 } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import { historyItemRefSchema } from "@vibeshape/domain/document-node"
import {
  type AuthoredDocumentSnapshot,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  projectAuthoredDocumentSnapshotToV1,
} from "@vibeshape/domain/document-v2"
import { promoteDocumentSnapshotV4 } from "@vibeshape/domain/document-v4"
import { documentSnapshotV5Schema } from "@vibeshape/domain/document-v5"
import { applyHistoryRemoveRetainingDependentsCommand } from "@vibeshape/domain/document-v5-commands"
import {
  type MoveHistoryItemCommand,
  moveHistoryItemCommandSchema,
} from "@vibeshape/domain/history-document-commands"
import { sketchIdSchema } from "@vibeshape/domain/identifiers"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
} from "@vibeshape/domain/modules"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { sketchRecordSchema } from "@vibeshape/domain/sketch"
import { createEmptySketch } from "@vibeshape/domain/sketch-edit"
import {
  createDefaultSurfaceTextureLayer,
  surfaceTextureLayerIdSchema,
} from "@vibeshape/domain/surface-textures"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { vi } from "../../../tests/unit/support/bun-test"
import {
  historyRepairFixture,
  repairId,
  repairRemovalCommand,
} from "../../domain/src/history-repair.test-fixture"
import type { DraftReviewInput } from "./draft-review"
import {
  createHistoryMoveProposalCoordinator,
  prepareAuthoredHistoryMove,
} from "./history-move-proposal"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.move",
  sessionId: id(9),
})
const started = Date.parse("2026-10-03T00:00:00Z")
const ref = (n: number) => historyItemRefSchema.parse({ kind: "sketch", id: id(n) })
function success<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function setup(options: { folder?: boolean; dependency?: boolean; version?: number } = {}) {
  const sketches = [2, 3, 4].map((n) =>
    createEmptySketch({ id: sketchIdSchema.parse(id(n)), label: `Sketch ${n}`, plane: "xy" }),
  )
  if (options.dependency) {
    const first = sketches[0]
    const second = sketches[1]
    if (!first || !second) throw new Error("Missing sketch fixture")
    sketches[0] = sketchRecordSchema.parse({
      ...first,
      entities: [{ schemaVersion: 0, id: id(20), type: "point", construction: false, x: 0, y: 0 }],
    })
    sketches[1] = sketchRecordSchema.parse({
      ...second,
      externalReferences: [
        {
          schemaVersion: 0,
          id: id(21),
          sourceSketchId: first.id,
          sourcePointId: id(20),
          projectedPointId: id(22),
        },
      ],
    })
  }
  const base = documentSnapshotV2Schema.parse({
    schemaVersion: 2,
    id: id(1),
    revision: 4,
    name: "History move fixture",
    createdAt: new Date(started - 1000).toISOString(),
    updatedAt: new Date(started - 500).toISOString(),
    displayUnits: { length: "mm", angle: "deg" },
    variables: [],
    sketches,
    features: [
      {
        schemaVersion: 1,
        id: id(5),
        label: "Box",
        type: boxFeatureType.type,
        parameters: {
          width: createLengthQuantity(10),
          depth: createLengthQuantity(10),
          height: createLengthQuantity(10),
          centered: false,
        },
        dependencies: [],
        references: [],
        semanticInputs: [],
        suppressed: false,
      },
    ],
    history: [ref(2), ref(3), ref(4), { kind: "feature", id: id(5) }],
    parts: [
      {
        schemaVersion: 0,
        id: id(6),
        name: "Hidden housing",
        visible: false,
        origin: "independent",
        bodyHistory: [{ schemaVersion: 0, featureId: id(5), outputRole: "result" }],
        consumedBy: null,
      },
    ],
    folders: options.folder
      ? [{ schemaVersion: 0, id: id(7), name: "Sketches", items: [ref(2), ref(3)] }]
      : [],
  })
  const box = base.features[0]
  if (!box) throw new Error("Missing box fixture")
  const textured = documentSnapshotV3Schema.parse({
    ...base,
    schemaVersion: 3,
    surfaceTextures: [
      createDefaultSurfaceTextureLayer(box.id, "result", surfaceTextureLayerIdSchema.parse(id(25))),
    ],
  })
  const sourced = promoteDocumentSnapshotV4(textured)
  let snapshot: AuthoredDocumentSnapshot =
    options.version === 5
      ? documentSnapshotV5Schema.parse({
          ...sourced,
          schemaVersion: 5,
          repairIntents: [],
          suspendedParts: [],
        })
      : options.version === 4
        ? sourced
        : options.version === 3
          ? textured
          : base
  const registry = success(createModuleRegistry([documentCoreModule, featureCoreModule])).registry
  const queries = success(createQueryDispatcher(registry, documentCoreQueryHandlers)).dispatcher
  const confirm = vi.fn<(input: DraftReviewInput) => unknown | PromiseLike<unknown>>(
    () => "approved",
  )
  const hasCommandId = vi.fn(async () => false)
  const commit = vi.fn(
    async (
      command: MoveHistoryItemCommand,
      expected: AuthoredDocumentSnapshot,
    ): Promise<unknown> => {
      snapshot = success(prepareAuthoredHistoryMove(snapshot, command)).snapshot
      expect(snapshot).toEqual(expected)
      return {
        documentId: command.documentId,
        commandId: command.commandId,
        baseRevision: command.baseRevision,
        revision: snapshot.revision,
        ...command.payload,
      }
    },
  )
  const geometry = {
    evaluate: vi.fn<(document: DocumentSnapshot) => unknown>((document) => ({
      schemaVersion: 1,
      documentId: document.id,
      revision: document.revision,
      generation: 1,
      features: document.features.map((feature) => ({
        featureId: feature.id,
        status: "succeeded",
        contentHash: "a".repeat(64),
        shape: {
          valid: true,
          volume: 1000,
          surfaceArea: 600,
          bounds: { min: [0, 0, 0], max: [10, 10, 10] },
          solidCount: 1,
          faceCount: 6,
          edgeCount: 12,
        },
      })),
    })),
  }
  let active = true
  let at = started
  const configuration = {
    documentId: snapshot.id,
    actor,
    readSnapshot: () => snapshot,
    hasCommandId,
    commit,
    geometry,
    queries,
    review: { confirm },
    createDraftId: () => id(11),
    isActive: () => active,
    now: () => at,
  }
  const host = createHistoryMoveProposalCoordinator(configuration)
  return {
    host,
    configuration,
    confirm,
    hasCommandId,
    commit,
    geometry,
    snapshot: () => snapshot,
    replace: (next: AuthoredDocumentSnapshot) => {
      snapshot = next
    },
    expire: () => {
      at += 300_001
    },
    deactivate: () => {
      active = false
    },
    request: {
      documentId: snapshot.id,
      baseRevision: snapshot.revision,
      commandId: id(10),
      item: ref(4),
      historyAfter: null,
    },
  }
}

describe("reviewed semantic History moves", () => {
  it("retains nonempty V5 repair intent and suspended Parts in its complete target", () => {
    const fixture = historyRepairFixture()
    const base = success(
      applyHistoryRemoveRetainingDependentsCommand(fixture, repairRemovalCommand(fixture.revision)),
    ).snapshot
    const prepared = success(
      prepareAuthoredHistoryMove(
        base,
        moveHistoryItemCommandSchema.parse({
          schemaVersion: 1,
          kind: "org.vibeshape.history.move-item",
          documentId: base.id,
          baseRevision: base.revision,
          commandId: id(900),
          issuedAt: new Date(started).toISOString(),
          actor,
          payload: { item: { kind: "feature", id: repairId(6) }, historyAfter: null },
        }),
      ),
    )
    expect(prepared.snapshot.schemaVersion).toBe(5)
    if (prepared.snapshot.schemaVersion !== 5)
      throw new Error("History move discarded V5 authority")
    expect(base.repairIntents.length).toBeGreaterThan(0)
    expect(prepared.snapshot.repairIntents).toEqual(base.repairIntents)
    expect(prepared.snapshot.suspendedParts).toEqual(base.suspendedParts)
    expect(prepared.snapshot.parts).toEqual(base.parts)
    expect(prepared.snapshot.folders).toEqual(base.folders)
  })
  it.each([2, 3, 4, 5])(
    "previews and retains complete V%i authority for one ordinary semantic move",
    async (version) => {
      const f = setup({ version, folder: true })
      const before = f.snapshot()
      f.confirm.mockImplementation((review) => {
        expect(f.commit).not.toHaveBeenCalled()
        expect(f.geometry.evaluate).toHaveBeenCalledTimes(1)
        expect(review.commands).toEqual([])
        expect(review.historyMove).toMatchObject({
          command: { payload: { item: ref(4), historyAfter: null } },
          target: { schemaVersion: version, revision: 5 },
          itemLabel: "Sketch 4",
          historyAfterLabel: null,
        })
        expect(review.preview.geometry.status).toBe("valid")
        expect(review.preview.draft).toMatchObject({
          baseRevision: 4,
          revision: 5,
          commandCount: 1,
        })
        if (!review.historyMove) throw new Error("Missing History move review")
        Reflect.set(review.historyMove.command.payload.item, "id", id(99))
        Reflect.set(review.historyMove.target, "name", "Review mutation")
        return "approved"
      })
      expect(await f.host.change(actor, f.request)).toMatchObject({
        ok: true,
        value: { ...f.request, revision: 5 },
      })
      expect(f.commit).toHaveBeenCalledTimes(1)
      expect(f.commit.mock.calls[0]?.[0]).toMatchObject({
        kind: "org.vibeshape.history.move-item",
        schemaVersion: 1,
        actor,
        payload: { item: ref(4), historyAfter: null },
      })
      const after = f.snapshot()
      expect(after.schemaVersion).toBe(version)
      expect(after.parts).toEqual(before.parts)
      expect(after.folders).toEqual(before.folders)
      expect(after.history).toEqual([
        ref(4),
        ref(2),
        ref(3),
        historyItemRefSchema.parse({ kind: "feature", id: id(5) }),
      ])
      const { revision: _r, history: _h, updatedAt: _u, ...retained } = after
      const { revision: _br, history: _bh, updatedAt: _bu, ...baseRetained } = before
      expect(retained).toEqual(baseRetained)
      expect(f.geometry.evaluate.mock.calls[0]?.[0]).toEqual(
        success(projectDocumentSnapshotV1ToV0(projectAuthoredDocumentSnapshotToV1(after))).snapshot,
      )
    },
  )
  it("shows the exact stable anchor label when moving after an item", async () => {
    const f = setup()
    expect(await f.host.change(actor, { ...f.request, historyAfter: ref(2) })).toMatchObject({
      ok: true,
    })
    expect(f.confirm.mock.calls[0]?.[0].historyMove).toMatchObject({
      command: { payload: { historyAfter: ref(2) } },
      historyAfterLabel: "Sketch 2",
    })
  })
  it.each([
    ["no-op", { item: ref(2), historyAfter: null }],
    ["missing item", { item: ref(99), historyAfter: null }],
    ["missing anchor", { item: ref(2), historyAfter: ref(99) }],
    ["self anchor", { item: ref(2), historyAfter: ref(2) }],
  ])("rejects %s before preview or persistence", async (_name, fields) => {
    const f = setup()
    expect(await f.host.change(actor, { ...f.request, ...fields })).toMatchObject({ ok: false })
    expect(f.geometry.evaluate).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.snapshot().revision).toBe(4)
  })
  it.each(["dependency", "folder"] as const)(
    "rejects %s-invalid moves before review",
    async (kind) => {
      const f = setup({ [kind]: true })
      const request =
        kind === "dependency"
          ? { item: ref(2), historyAfter: ref(3) }
          : { item: ref(3), historyAfter: ref(4) }
      expect(await f.host.change(actor, { ...f.request, ...request })).toMatchObject({ ok: false })
      expect(f.geometry.evaluate).not.toHaveBeenCalled()
      expect(f.confirm).not.toHaveBeenCalled()
      expect(f.commit).not.toHaveBeenCalled()
    },
  )
  it.each(["wrong actor", "wrong document", "stale", "duplicate", "authority"])(
    "rejects %s before preview",
    async (kind) => {
      const f = setup()
      if (kind === "duplicate") f.hasCommandId.mockResolvedValue(true)
      const input =
        kind === "wrong document"
          ? { ...f.request, documentId: id(99) }
          : kind === "stale"
            ? { ...f.request, baseRevision: 3 }
            : kind === "authority"
              ? { ...f.request, history: [] }
              : f.request
      expect(
        await f.host.change(
          kind === "wrong actor" ? { ...actor, sessionId: id(99) } : actor,
          input,
        ),
      ).toMatchObject({ ok: false })
      expect(f.geometry.evaluate).not.toHaveBeenCalled()
      expect(f.confirm).not.toHaveBeenCalled()
      expect(f.commit).not.toHaveBeenCalled()
    },
  )
  it("rejects cyclic dependency authority before exact preview or consent", async () => {
    const f = setup({ dependency: true })
    const before = f.snapshot()
    f.replace({
      ...before,
      sketches: before.sketches.map((sketch, index) =>
        index === 0
          ? sketchRecordSchema.parse({
              ...sketch,
              externalReferences: [
                {
                  schemaVersion: 0,
                  id: id(24),
                  sourceSketchId: id(3),
                  sourcePointId: id(22),
                  projectedPointId: id(23),
                },
              ],
            })
          : sketch,
      ),
    })
    expect(await f.host.change(actor, f.request)).toMatchObject({ ok: false })
    expect(f.geometry.evaluate).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("does not start preview or consent for an already aborted request", async () => {
    const f = setup()
    expect(await f.host.change(actor, f.request, { aborted: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-cancelled" },
    })
    expect(f.geometry.evaluate).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
  })
  it.each(["rejected", "cancelled", "invalid"])(
    "does not save after %s review",
    async (decision) => {
      const f = setup()
      f.confirm.mockReturnValue(decision)
      expect(await f.host.change(actor, f.request)).toMatchObject({ ok: false })
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.snapshot().revision).toBe(4)
    },
  )
  it.each(["expire", "cancel", "dispose", "deactivate", "stale metadata", "duplicate"])(
    "rechecks %s after approval",
    async (kind) => {
      const f = setup()
      f.confirm.mockImplementation(() => {
        if (kind === "expire") f.expire()
        if (kind === "cancel") f.host.cancel()
        if (kind === "dispose") f.host.dispose()
        if (kind === "deactivate") f.deactivate()
        if (kind === "stale metadata")
          f.replace({
            ...f.snapshot(),
            parts: f.snapshot().parts.map((part) => ({ ...part, visible: true })),
          })
        if (kind === "duplicate") f.hasCommandId.mockResolvedValue(true)
        return "approved"
      })
      expect(await f.host.change(actor, f.request)).toMatchObject({ ok: false })
      expect(f.commit).not.toHaveBeenCalled()
    },
  )
  it("requires valid exact geometry before consent", async () => {
    const f = setup()
    f.geometry.evaluate.mockImplementation((document) => ({
      schemaVersion: 1,
      documentId: document.id,
      revision: document.revision,
      generation: 1,
      features: [{ featureId: id(5), status: "failed", diagnosticCodes: ["org.example.invalid"] }],
    }))
    expect(await f.host.change(actor, f.request)).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("settles the actual persistence result after disposal and blocks duplicate activation", async () => {
    const f = setup()
    let finish = (_result: unknown) => {}
    f.commit.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.host.change(actor, f.request)
    await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1))
    expect(await f.host.change(actor, { ...f.request, commandId: id(99) })).toMatchObject({
      ok: false,
    })
    f.host.dispose()
    finish({ ...f.request, revision: 5 })
    expect(await pending).toMatchObject({ ok: true })
    expect(f.commit).toHaveBeenCalledTimes(1)
  })
  it.each(["wrong receipt", "save failure", "throw"])(
    "reports %s without retrying a semantic save",
    async (kind) => {
      const f = setup()
      f.commit.mockImplementation(async () => {
        if (kind === "throw") throw new Error("Storage failed")
        return kind === "save failure"
          ? {
              ok: false,
              diagnostic: { code: "stale-revision", message: "Changed", retryable: true },
            }
          : { ...f.request, revision: 5, historyAfter: ref(2) }
      })
      expect(await f.host.change(actor, f.request)).toMatchObject({ ok: false })
      expect(f.commit).toHaveBeenCalledTimes(1)
      expect(await f.host.change(actor, f.request)).toMatchObject({
        ok: false,
        diagnostic: { code: "duplicate-command-id" },
      })
      expect(f.commit).toHaveBeenCalledTimes(1)
    },
  )
})
