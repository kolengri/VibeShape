import { afterEach, describe, expect, it } from "bun:test"
import type { AutomationDocumentPort } from "@vibeshape/automation-host/host"
import { DocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  boxFeatureType,
  createCommandDispatcher,
  createCoreCommandHandlers,
  createFeatureTypeRegistry,
  createLengthQuantity,
  createModuleRegistry,
  documentCoreModule,
  featureCoreModule,
  partDesignFeatureTypeHandlers,
  partDesignModule,
} from "@vibeshape/domain"
import { commandActorSchema } from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { commitDocumentDraft } from "@vibeshape/domain/drafts"
import { draftIdSchema } from "@vibeshape/domain/identifiers"
import { DOCUMENT_PROTOCOL_VERSION, documentWorkerResponseSchema } from "@vibeshape/protocol"
import { vi } from "../../../../tests/unit/support/bun-test"
import {
  automationDraftViewportPreview,
  createAutomationDraftViewport,
} from "./automation-draft-viewport"
import {
  automationReviews,
  getActiveAutomationReviews,
  setActiveAutomationReviews,
} from "./automation-review-controller"
import { createAutomationReviewController } from "./automation-review-state"
import { createDocumentAutomationSession } from "./document-automation-session"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const actor = commandActorSchema.parse({
  type: "mcp",
  clientId: "org.example.agent",
  sessionId: id(1),
})

function rebuild(snapshot: DocumentSnapshot, roles = ["result"]) {
  const shape = {
    valid: true,
    volume: 24,
    surfaceArea: 52,
    solidCount: 1,
    faceCount: 1,
    edgeCount: 3,
    bounds: { min: [0, 0, 0], max: [2, 3, 4] },
  }
  const response = documentWorkerResponseSchema.parse({
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: id(2),
    generation: 1,
    documentId: snapshot.id,
    revision: snapshot.revision,
    evaluation: {
      records: snapshot.features.map(({ id }) => ({
        featureId: id,
        status: "succeeded",
        contentHash: "a".repeat(64),
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: snapshot.features.map(({ id }) => id),
      reusedFeatureIds: [],
    },
    geometry: snapshot.features.map((feature) => {
      const mesh = {
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        triangleFaceIds: new Uint32Array([1]),
      }
      return {
        featureId: feature.id,
        contentHash: "a".repeat(64),
        meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
        geometry: {
          engine: {
            adapter: "replicad",
            adapterVersion: "test",
            replicadVersion: "0.23.1",
            opencascadePackageVersion: "0.23.0",
            opencascadeSourceRevision: null,
            wasmBytes: 1,
            initializedInMs: 1,
            featureContentEnvironment: {
              schemaVersion: 0,
              hostApiVersion: "0.1.0",
              geometry: {
                adapterId: "org.vibeshape.geometry.replicad",
                adapterVersion: "test",
                kernelId: "org.opencascade.occt",
                kernelVersion: "0.23.0",
                kernelSourceRevision: null,
              },
              modelingTolerancePolicyVersion: 1,
              provider: { kind: "built-in" },
            },
          },
          shape: { ...shape, solidCount: roles.length, volume: shape.volume * roles.length },
          mesh,
          topologyCandidates: [],
          bodies: roles.map((outputRole) => ({ outputRole, shape, mesh, topologyCandidates: [] })),
          cache: { brepHit: false },
          timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        },
      }
    }),
    sketches: [],
    modelReferenceEvidence: [],
  })
  if (response.type !== "documentRebuilt") throw new Error("Expected an exact fixture rebuild.")
  return response
}

function fixture(roles?: string[]) {
  const modules = createModuleRegistry([documentCoreModule, featureCoreModule, partDesignModule])
  if (!modules.ok) throw new Error(modules.diagnostic.message)
  const types = createFeatureTypeRegistry(modules.registry, partDesignFeatureTypeHandlers)
  if (!types.ok) throw new Error(types.diagnostic.message)
  const commands = createCommandDispatcher(
    modules.registry,
    createCoreCommandHandlers(types.registry),
  )
  if (!commands.ok) throw new Error(commands.diagnostic.message)
  let current: DocumentSnapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(10),
    revision: 1,
    name: "Project A",
    features: [],
    sketches: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  let draftNumber = 100
  const reviews = createAutomationReviewController()
  const worker = vi
    .spyOn(DocumentWorkerSession.prototype, "rebuild")
    .mockImplementation(async ({ document }) =>
      rebuild(documentSnapshotSchema.parse(document), roles),
    )
  const terminated = vi.spyOn(DocumentWorkerSession.prototype, "terminate")
  const commit = vi.fn<AutomationDocumentPort["compareAndCommitDraft"]>((draft) => {
    const result = commitDocumentDraft(current, draft)
    if (result.ok) current = result.commit.snapshot
    return result
  })
  const createdSession = createDocumentAutomationSession(
    {
      commands: commands.dispatcher,
      modules: modules.registry,
      createDraftId: () => id(draftNumber++),
      documents: { readSnapshot: () => current, compareAndCommitDraft: commit },
    },
    reviews,
  )
  if (!createdSession.ok) throw new Error(createdSession.diagnostic.message)
  const session = createdSession
  async function draft() {
    const created = await session.host.createDraft(actor, {
      schemaVersion: 1,
      documentId: current.id,
      baseRevision: current.revision,
    })
    if (!created.ok) throw new Error(created.diagnostic.message)
    const request = { schemaVersion: 1, draftId: created.value.draftId }
    const applied = await session.host.applyCommand(actor, {
      ...request,
      command: {
        kind: "org.vibeshape.feature.add",
        schemaVersion: 1,
        documentId: current.id,
        baseRevision: current.revision,
        commandId: id(draftNumber + 100),
        issuedAt: new Date().toISOString(),
        actor,
        payload: {
          feature: {
            schemaVersion: 0,
            id: id(draftNumber + 200),
            type: boxFeatureType.type,
            parameters: {
              width: createLengthQuantity(2),
              depth: createLengthQuantity(3),
              height: createLengthQuantity(4),
              centered: false,
            },
            dependencies: [],
            references: [],
            suppressed: false,
          },
        },
      },
    })
    if (!applied.ok) throw new Error(applied.diagnostic.message)
    return request
  }
  async function pendingReview() {
    const request = await draft()
    const committed = session.host.commitDraft(actor, request)
    await Promise.race([
      vi.waitFor(() => expect(reviews.getSnapshot()?.status).toBe("ready")),
      committed.then((result) => {
        throw new Error(`The commit ended before review: ${JSON.stringify(result)}`)
      }),
    ])
    const review = reviews.getSnapshot()
    if (!review || "kind" in review.input) throw new Error("Expected the pending CAD review.")
    return { request, committed, review }
  }
  return {
    session,
    reviews,
    worker,
    terminated,
    commit,
    draft,
    pendingReview,
    snapshot: () => current,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("exact automation review viewport", () => {
  it("draws private commands before review without saving, and clears them on discard and disposal", async () => {
    const f = fixture()
    const base = f.snapshot()
    const request = await f.draft()
    const presentation = f.reviews.getDraftViewportSnapshot()
    expect(automationDraftViewportPreview(null, base, presentation)?.meshes).toHaveLength(1)
    expect(f.reviews.getSnapshot()).toBeNull()
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.snapshot()).toBe(base)
    expect(
      automationDraftViewportPreview(null, { ...base, revision: base.revision + 1 }, presentation),
    ).toBeNull()
    expect(
      automationDraftViewportPreview(
        null,
        { ...base, id: documentSnapshotSchema.parse({ ...base, id: id(50) }).id },
        presentation,
      ),
    ).toBeNull()
    f.reviews.clearDraftViewport(Symbol("different-session"))
    expect(f.reviews.getDraftViewportSnapshot()).toBe(presentation)
    await f.session.host.discardDraft(actor, request)
    expect(f.reviews.getDraftViewportSnapshot()).toBeNull()
    await f.draft()
    expect(f.reviews.getDraftViewportSnapshot()).not.toBeNull()
    f.session.dispose()
    expect(f.reviews.getDraftViewportSnapshot()).toBeNull()
    expect(f.commit).not.toHaveBeenCalled()
  })

  it("retains the exact evaluated buffers until Apply and keeps the document unchanged before approval", async () => {
    const f = fixture()
    const base = f.snapshot()
    const { committed, review } = await f.pendingReview()
    const projected = automationDraftViewportPreview(review, base)
    expect(projected?.status).toBe("ready")
    expect(projected?.meshes).toHaveLength(1)
    expect(projected?.meshes[0]).toMatchObject({ outputRole: "result", appearance: "preview" })
    expect(projected?.meshes[0]?.positions).toEqual(new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]))
    expect(f.snapshot()).toBe(base)
    expect(f.snapshot().features).toHaveLength(0)
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.worker).toHaveBeenCalledTimes(2)
    expect(f.terminated).toHaveBeenCalledTimes(2)
    const applying = f.reviews.decide(review.id, "approved")
    expect(automationDraftViewportPreview(f.reviews.getSnapshot(), base)).toBe(projected)
    await expect(committed).resolves.toMatchObject({ ok: true })
    await applying
    expect(f.commit).toHaveBeenCalledTimes(1)
    expect(f.snapshot().features).toHaveLength(1)
    expect(f.reviews.getSnapshot()).toBeNull()
    f.session.dispose()
  })

  it("preserves every exact output role and refuses other projects, revisions, drafts, and rebuild generations", async () => {
    const f = fixture(["retained", "split"])
    const { review, committed } = await f.pendingReview()
    const base = f.snapshot()
    const projected = automationDraftViewportPreview(review, base)
    expect(projected?.meshes.map(({ outputRole }) => outputRole)).toEqual(["retained", "split"])
    expect(projected?.meshes.every(({ appearance }) => appearance === "preview")).toBe(true)
    expect(
      automationDraftViewportPreview(review, {
        ...base,
        id: documentSnapshotSchema.parse({ ...base, id: id(11) }).id,
      }),
    ).toBeNull()
    expect(
      automationDraftViewportPreview(review, { ...base, revision: base.revision + 1 }),
    ).toBeNull()
    const viewport = review.draftViewport
    if (!viewport) throw new Error("Expected retained review geometry.")
    expect(
      automationDraftViewportPreview(
        {
          ...review,
          draftViewport: {
            ...viewport,
            draft: { ...viewport.draft, draftId: draftIdSchema.parse(id(200)) },
          },
        },
        base,
      ),
    ).toBeNull()
    expect(
      automationDraftViewportPreview(
        { ...review, draftViewport: { ...viewport, generation: 2 } },
        base,
      ),
    ).toBeNull()
    f.session.cancel("stale-revision")
    await expect(committed).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-cancelled" },
    })
    expect(f.reviews.getSnapshot()?.draftViewport).toBeNull()
    expect(automationDraftViewportPreview(f.reviews.getSnapshot(), base)).toBeNull()
    expect(f.commit).not.toHaveBeenCalled()
    f.session.dispose()
  })

  it("replaces a rejected draft at the same revision and releases it on session disposal", async () => {
    const f = fixture()
    const first = await f.pendingReview()
    await f.reviews.decide(first.review.id, "rejected")
    await expect(first.committed).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "draft-review-rejected" },
    })
    expect(f.reviews.getSnapshot()).toBeNull()
    const next = await f.pendingReview()
    expect(next.review.draftViewport?.draft.draftId).not.toBe(
      first.review.draftViewport?.draft.draftId,
    )
    expect(next.review.draftViewport?.draft.revision).toBe(
      first.review.draftViewport?.draft.revision,
    )
    expect(next.review.draftViewport?.preview.meshes[0]?.featureId).not.toBe(
      first.review.draftViewport?.preview.meshes[0]?.featureId,
    )
    f.session.dispose()
    await expect(next.committed).resolves.toMatchObject({ ok: false })
    expect(f.reviews.getSnapshot()?.draftViewport).toBeNull()
    expect(f.commit).not.toHaveBeenCalled()
  })

  it("projects a retained background review only through its owning project's active controller", async () => {
    const f = fixture()
    const { review, committed } = await f.pendingReview()
    const viewport = review.draftViewport
    if (!viewport) throw new Error("Expected retained review geometry.")
    const previous = getActiveAutomationReviews()
    try {
      setActiveAutomationReviews(createAutomationReviewController())
      expect(
        automationDraftViewportPreview(automationReviews.getSnapshot(), f.snapshot()),
      ).toBeNull()
      setActiveAutomationReviews(f.reviews)
      expect(automationDraftViewportPreview(automationReviews.getSnapshot(), f.snapshot())).toBe(
        viewport.preview,
      )
    } finally {
      setActiveAutomationReviews(previous)
      f.session.dispose()
      await committed
    }
  })

  it.each(["cancel", "dispose"] as const)(
    "releases buffers on %s during accepted persistence while preserving its outcome",
    async (action) => {
      const f = fixture()
      const { review, committed } = await f.pendingReview()
      let finish!: () => void
      const saving = new Promise<void>((resolve) => {
        finish = resolve
      })
      f.commit.mockImplementation(async (draft) => {
        await saving
        return commitDocumentDraft(f.snapshot(), draft)
      })
      const applied = f.reviews.decide(review.id, "approved")
      await vi.waitFor(() => expect(f.commit).toHaveBeenCalledTimes(1))
      f.reviews.clearDraftViewport(Symbol("another-session"))
      expect(f.reviews.getSnapshot()?.draftViewport).not.toBeNull()
      f.session[action]()
      expect(f.reviews.getSnapshot()).toMatchObject({ status: "applying", draftViewport: null })
      finish()
      await expect(committed).resolves.toMatchObject({ ok: true })
      await applied
      expect(f.reviews.getSnapshot()).toBeNull()
      f.session.dispose()
    },
  )

  it("does not reopen retained geometry when an already completed rebuild is cancelled before publication", async () => {
    const f = fixture()
    const request = await f.draft()
    let finish!: () => void
    f.worker.mockImplementation(
      ({ document }) =>
        new Promise((resolve) => {
          finish = () => resolve(rebuild(documentSnapshotSchema.parse(document)))
        }),
    )
    const committed = f.session.host.commitDraft(actor, request)
    await vi.waitFor(() => expect(f.worker).toHaveBeenCalledTimes(2))
    finish()
    f.session.cancel()
    await expect(committed).resolves.toMatchObject({ ok: false })
    expect(f.reviews.getSnapshot()).toBeNull()
    expect(f.commit).not.toHaveBeenCalled()
    f.session.dispose()
  })

  it("drops retained geometry when persistence fails", async () => {
    const f = fixture()
    const { review, committed } = await f.pendingReview()
    f.commit.mockImplementation(() => ({
      ok: false,
      diagnostic: { code: "stale-revision", message: "Changed", retryable: true, issues: [] },
    }))
    const applying = f.reviews.decide(review.id, "approved")
    await expect(committed).resolves.toMatchObject({ ok: false })
    await applying
    expect(f.reviews.getSnapshot()).toMatchObject({ status: "error", draftViewport: null })
    expect(automationDraftViewportPreview(f.reviews.getSnapshot(), f.snapshot())).toBeNull()
    await f.draft()
    const fresh = f.reviews.getDraftViewportSnapshot()
    if (!fresh) throw new Error("Expected the new private construction preview.")
    expect(automationDraftViewportPreview(f.reviews.getSnapshot(), f.snapshot(), fresh)).toBe(
      fresh.preview,
    )
    expect(f.snapshot().features).toHaveLength(0)
    f.session.dispose()
  })

  it("leaves explicitly auto-approved commits on the ordinary committed renderer", async () => {
    const f = fixture()
    expect(f.session.enableAutoApply(actor)).toBe(true)
    const request = await f.draft()
    await expect(f.session.host.commitDraft(actor, request)).resolves.toMatchObject({ ok: true })
    expect(f.reviews.getSnapshot()).toBeNull()
    expect(f.snapshot().features).toHaveLength(1)
    f.session.dispose()
  })

  it("refuses stale or incomplete retained rebuilds before projecting their meshes", async () => {
    const f = fixture()
    const { review, committed } = await f.pendingReview()
    const snapshot = documentSnapshotSchema.parse(f.worker.mock.calls[0]?.[0].document)
    if ("kind" in review.input) throw new Error("Expected the exact draft evaluation.")
    const exact = rebuild(snapshot)
    expect(
      createAutomationDraftViewport(review.input, snapshot, {
        ...exact,
        revision: exact.revision + 1,
      }),
    ).toBeNull()
    expect(
      createAutomationDraftViewport(review.input, snapshot, { ...exact, geometry: [] }),
    ).toBeNull()
    expect(
      createAutomationDraftViewport(review.input, snapshot, { ...exact, generation: 2 }),
    ).toBeNull()
    f.session.dispose()
    await committed
  })
})
