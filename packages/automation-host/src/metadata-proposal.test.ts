import { createQueryDispatcher, documentCoreQueryHandlers } from "@vibeshape/automation-api/queries"
import { applyVersionedDocumentCommand } from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentSnapshotV2 } from "@vibeshape/domain/document-v2"
import { applyDocumentV2Command } from "@vibeshape/domain/document-v2-commands"
import { applyDocumentUpgradeV2Command } from "@vibeshape/domain/document-v2-migration"
import {
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
} from "@vibeshape/domain/modules"
import { boxFeatureType } from "@vibeshape/domain/part-design"
import { createLengthQuantity } from "@vibeshape/domain/units"
import { describe, expect, it, vi } from "vitest"
import type { DraftReviewInput } from "./draft-review"
import type { MetadataCommand } from "./metadata-proposal"
import { createMetadataProposalCoordinator } from "./metadata-proposal"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.metadata",
  sessionId: id(9),
})
const started = Date.parse("2026-10-03T00:00:00Z")
function requireSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}
function setup() {
  const envelope = { documentId: id(1), issuedAt: new Date(started).toISOString(), actor }
  const created = requireSuccess(
    applyVersionedDocumentCommand(null, {
      ...envelope,
      schemaVersion: 1,
      commandId: id(2),
      baseRevision: 0,
      kind: "org.vibeshape.document.create",
      payload: { name: "Metadata fixture" },
    }),
  )
  const model = requireSuccess(
    applyVersionedDocumentCommand(created.snapshot, {
      ...envelope,
      schemaVersion: 1,
      commandId: id(3),
      baseRevision: 1,
      kind: "org.vibeshape.history.insert-feature",
      payload: {
        historyAfter: null,
        feature: {
          schemaVersion: 0,
          id: id(4),
          type: boxFeatureType.type,
          label: "Box",
          parameters: {
            width: createLengthQuantity(10),
            depth: createLengthQuantity(10),
            height: createLengthQuantity(10),
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      },
    }),
  )
  let snapshot: DocumentSnapshotV2 = requireSuccess(
    applyDocumentUpgradeV2Command(model.snapshot, {
      ...envelope,
      schemaVersion: 2,
      commandId: id(5),
      baseRevision: 2,
      kind: "org.vibeshape.document.upgrade-v2",
      payload: {
        partAllocations: [
          {
            id: id(6),
            name: "Housing",
            origin: "independent",
            body: { schemaVersion: 0, featureId: id(4), outputRole: "result" },
          },
        ],
      },
    }),
  ).snapshot
  const registry = requireSuccess(
    createModuleRegistry([documentCoreModule, featureCoreModule]),
  ).registry
  const queries = requireSuccess(
    createQueryDispatcher(registry, documentCoreQueryHandlers),
  ).dispatcher
  let active = true
  let at = started
  const confirm = vi.fn<(input: DraftReviewInput) => unknown | PromiseLike<unknown>>(
    () => "approved",
  )
  const hasCommandId = vi.fn(async () => false)
  const commit = vi.fn(async (command: MetadataCommand, expected: DocumentSnapshotV2) => {
    snapshot = requireSuccess(applyDocumentV2Command(snapshot, command)).snapshot
    expect(snapshot).toEqual(expected)
    return {
      documentId: snapshot.id,
      commandId: command.commandId,
      baseRevision: command.baseRevision,
      revision: snapshot.revision,
      change: command.payload,
    }
  })
  const geometry = {
    evaluate: vi.fn<(document: DocumentSnapshot) => unknown>((document) => ({
      schemaVersion: 1,
      documentId: document.id,
      revision: document.revision,
      generation: 1,
      features: document.features.map((feature: { id: string }) => ({
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
  const host = createMetadataProposalCoordinator({
    documentId: snapshot.id,
    actor,
    readSnapshot: () => snapshot,
    hasCommandId,
    commit,
    geometry,
    queries,
    review: { confirm },
    createDraftId: () => id(8),
    isActive: () => active,
    now: () => at,
  })
  return {
    host,
    confirm,
    commit,
    geometry,
    hasCommandId,
    snapshot: () => snapshot,
    deactivate: () => {
      active = false
    },
    advance: () => {
      at += 300_000
    },
    replace: (value: DocumentSnapshotV2) => {
      snapshot = value
    },
    request: {
      baseRevision: snapshot.revision,
      commandId: id(10),
      change: { kind: "part.rename", partId: id(6), name: "Renamed housing" },
    },
  }
}

describe("typed metadata proposal coordination", () => {
  it("previews one V2 change and commits the retained MCP actor and intent after manual review", async () => {
    const fixture = setup()
    fixture.confirm.mockImplementation((review) => {
      expect(review.commands).toEqual([])
      expect(review.metadata).toMatchObject({
        change: fixture.request.change,
        targetName: "Housing",
      })
      expect(review.preview.geometry.status).toBe("valid")
      if (review.metadata && "name" in review.metadata.change)
        Reflect.set(review.metadata.change, "name", "Review mutation")
      return "approved"
    })
    expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
      ok: true,
      value: { commandId: id(10), baseRevision: 3, revision: 4, change: fixture.request.change },
    })
    expect(fixture.commit).toHaveBeenCalledTimes(1)
    expect(fixture.commit.mock.calls[0]?.[0]).toMatchObject({
      commandId: id(10),
      actor,
      payload: fixture.request.change,
    })
    expect(fixture.snapshot().parts[0]?.name).toBe("Renamed housing")
    expect(await fixture.host.change(actor, { ...fixture.request, baseRevision: 4 })).toMatchObject(
      { ok: false, diagnostic: { code: "duplicate-command-id" } },
    )
  })
  it.each(["rejected", "cancelled"])("leaves authority untouched after %s", async (decision) => {
    const fixture = setup()
    fixture.confirm.mockReturnValue(decision)
    expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
      ok: false,
      diagnostic: {
        code: decision === "rejected" ? "draft-review-rejected" : "draft-review-cancelled",
      },
    })
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.snapshot().revision).toBe(3)
  })
  it("rejects cross-pair actors, stale bases, duplicates and unrecognized command payloads before preview", async () => {
    const fixture = setup()
    expect(
      await fixture.host.change({ ...actor, sessionId: id(30) }, fixture.request),
    ).toMatchObject({ ok: false, diagnostic: { code: "draft-owner-mismatch" } })
    expect(await fixture.host.change(actor, { ...fixture.request, baseRevision: 1 })).toMatchObject(
      { ok: false, diagnostic: { code: "stale-revision" } },
    )
    expect(
      await fixture.host.change(actor, {
        ...fixture.request,
        change: { kind: "execute", code: "anything" },
      }),
    ).toMatchObject({ ok: false, diagnostic: { code: "invalid-draft-request" } })
    fixture.hasCommandId.mockResolvedValue(true)
    expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
      ok: false,
      diagnostic: { code: "duplicate-command-id" },
    })
    expect(fixture.geometry.evaluate).not.toHaveBeenCalled()
    expect(fixture.confirm).not.toHaveBeenCalled()
  })
  it.each(["expire", "cancel", "disconnect", "stale", "duplicate"])(
    "rechecks %s after approval",
    async (mode) => {
      const fixture = setup()
      fixture.confirm.mockImplementation(() => {
        if (mode === "expire") fixture.advance()
        if (mode === "cancel") fixture.host.cancel()
        if (mode === "disconnect") fixture.deactivate()
        if (mode === "stale") fixture.replace({ ...fixture.snapshot(), name: "Human change" })
        if (mode === "duplicate") fixture.hasCommandId.mockResolvedValue(true)
        return "approved"
      })
      const code =
        mode === "expire"
          ? "draft-expired"
          : mode === "stale"
            ? "stale-revision"
            : mode === "duplicate"
              ? "duplicate-command-id"
              : "draft-review-cancelled"
      expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
        ok: false,
        diagnostic: { code },
      })
      expect(fixture.commit).not.toHaveBeenCalled()
    },
  )
  it("retains the actual save result when disconnect happens during persistence", async () => {
    const fixture = setup()
    const ordinaryCommit = fixture.commit.getMockImplementation()
    fixture.commit.mockImplementation(async (command, expected) => {
      fixture.host.dispose()
      if (!ordinaryCommit) throw new Error("Missing commit")
      return ordinaryCommit(command, expected)
    })
    expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
      ok: true,
      value: { revision: 4 },
    })
  })
  it("rejects invalid geometry and noncontiguous folder membership without consent", async () => {
    const fixture = setup()
    fixture.geometry.evaluate.mockImplementation((document) => ({
      schemaVersion: 1,
      documentId: document.id,
      revision: document.revision,
      generation: 1,
      features: [{ featureId: id(4), status: "failed", diagnosticCodes: ["org.example.invalid"] }],
    }))
    expect(await fixture.host.change(actor, fixture.request)).toMatchObject({
      ok: false,
      diagnostic: { code: "draft-geometry-invalid" },
    })
    expect(fixture.confirm).not.toHaveBeenCalled()
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(
      await fixture.host.change(actor, {
        ...fixture.request,
        commandId: id(12),
        change: {
          kind: "folder.create",
          folder: { id: id(11), name: "Invalid", items: [{ kind: "feature", id: id(50) }] },
        },
      }),
    ).toMatchObject({ ok: false })
    expect(fixture.confirm).not.toHaveBeenCalled()
  })
})
