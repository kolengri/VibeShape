import { describe, expect, it } from "bun:test"
import type { DisposableDocumentPreviewResult } from "@vibeshape/application/disposable-document-preview"
import { boxFeatureType, featureRecordSchema } from "@vibeshape/domain"
import { documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureIdSchema } from "@vibeshape/domain/identifiers"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import type { ModelPreview } from "@vibeshape/viewer/model-preview"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createModelPreviewSession } from "./model-preview-session"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
const image: ModelPreview = {
  mimeType: "image/png",
  base64: png,
  width: 1,
  height: 1,
  views: ["front"],
}
function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: id(1),
    type: boxFeatureType.type,
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
  })
  const snapshot = documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: id(900),
    revision: 4,
    name: "Preview",
    features: [feature],
    sketches: [],
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
  })
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    triangleFaceIds: new Uint32Array([1]),
  }
  const shape = {
    valid: true,
    volume: 1,
    solidCount: 1,
    surfaceArea: 1,
    faceCount: 1,
    edgeCount: 3,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  }
  const rebuilt = {
    ok: true,
    valid: true,
    evidence: { documentId: snapshot.id, revision: 4, generation: 9 },
    rebuild: {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      type: "documentRebuilt",
      documentId: snapshot.id,
      revision: 4,
      generation: 9,
      requestId: id(800),
      evaluation: {
        records: [{ featureId: feature.id, status: "succeeded", contentHash: "a".repeat(64) }],
        dirtyFeatureIds: [],
        evaluatedFeatureIds: [feature.id],
        reusedFeatureIds: [],
      },
      geometry: [
        {
          featureId: feature.id,
          contentHash: "a".repeat(64),
          geometry: {
            shape,
            mesh,
            topologyCandidates: [],
            bodies: [{ outputRole: "result", shape, mesh, topologyCandidates: [] }],
          },
        },
      ],
      sketches: [],
      modelReferenceEvidence: [],
    },
  } as unknown as Extract<DisposableDocumentPreviewResult, { ok: true }>
  let current: typeof snapshot | null = snapshot
  const preview = vi.fn(async (): Promise<DisposableDocumentPreviewResult> => rebuilt)
  const render = vi.fn(async () => image)
  const cancel = vi.fn(),
    dispose = vi.fn(),
    commit = vi.fn()
  const unsupported = vi.fn<(target: unknown) => string | null>(() => null)
  const reader = createModelPreviewSession({
    documents: { readSnapshot: () => current, compareAndCommitDraft: commit },
    preview: { preview, cancel, dispose },
    render,
    unsupportedRepresentation: unsupported,
  })
  const request = { source: "model" as const, revision: 4, views: ["front" as const] }
  return {
    reader,
    preview,
    render,
    cancel,
    dispose,
    commit,
    unsupported,
    rebuilt,
    shape,
    snapshot,
    request,
    replace: (next: typeof snapshot | null) => {
      current = next
    },
  }
}

describe("isolated model previews", () => {
  it("forwards a custom camera and detail height without changing the user's viewport", async () => {
    const f = fixture()
    const camera = {
      position: [10, 20, 30] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      up: [0, 0, 1] as [number, number, number],
      viewHeightMm: 3,
    }
    const customImage = { ...image, views: ["custom"] } as ModelPreview
    f.render.mockResolvedValue(customImage)
    await expect(
      f.reader.read(f.snapshot.id, { source: "model", revision: 4, camera }),
    ).resolves.toMatchObject({ ok: true, value: { camera, image: { views: ["custom"] } } })
    expect(f.render).toHaveBeenCalledWith(expect.any(Array), { camera })
    expect(f.commit).not.toHaveBeenCalled()
    f.render.mockResolvedValue(image)
    await expect(
      f.reader.read(f.snapshot.id, { source: "model", revision: 4, camera }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "invalid-geometry-evidence" } })
  })
  it("renders terminal model bodies with exact rebuild metadata without committing", async () => {
    const f = fixture()
    await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "model",
        documentId: f.snapshot.id,
        revision: 4,
        generation: 9,
        geometryStatus: "valid",
        bodyCount: 1,
        image,
      },
    })
    expect(f.render).toHaveBeenCalledWith(
      [expect.objectContaining({ featureId: id(1), outputRole: "result" })],
      { views: ["front"] },
    )
    expect(f.commit).not.toHaveBeenCalled()
  })
  it("keeps invalid status while rendering successful independent bodies", async () => {
    const f = fixture()
    f.rebuilt.valid = false
    await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({
      ok: true,
      value: { geometryStatus: "invalid", bodyCount: 1 },
    })
  })
  it("rejects stale requests before rebuilding and changed revisions after PNG encoding", async () => {
    const f = fixture()
    await expect(
      f.reader.read(f.snapshot.id, { ...f.request, revision: 3 }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "stale-query-revision" } })
    expect(f.preview).not.toHaveBeenCalled()
    const encoded = deferred<ModelPreview>()
    f.render.mockImplementation(() => encoded.promise)
    const pending = f.reader.read(f.snapshot.id, f.request)
    await vi.waitFor(() => expect(f.render).toHaveBeenCalled())
    f.replace({ ...f.snapshot, revision: 5 })
    encoded.resolve(image)
    await expect(pending).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "stale-query-revision" },
    })
  })
  it.each(["cancel", "dispose", "abort"] as const)(
    "drops an image when %s occurs during encoding",
    async (action) => {
      const f = fixture(),
        encoded = deferred<ModelPreview>(),
        abort = new AbortController()
      f.render.mockImplementation(() => encoded.promise)
      const pending = f.reader.read(f.snapshot.id, f.request, abort.signal)
      await vi.waitFor(() => expect(f.render).toHaveBeenCalled())
      if (action === "abort") abort.abort()
      else f.reader[action]()
      encoded.resolve(image)
      await expect(pending).resolves.toMatchObject({
        ok: false,
        diagnostic: { code: "request-cancelled" },
      })
      if (action === "dispose") {
        await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({
          ok: false,
          diagnostic: { code: "geometry-unavailable" },
        })
        expect(f.dispose).toHaveBeenCalledTimes(1)
      }
    },
  )
  it("rejects an unavailable exact output without falling back to a sibling body", async () => {
    const f = fixture()
    await expect(
      f.reader.read(f.snapshot.id, {
        ...f.request,
        target: { featureId: featureIdSchema.parse(id(1)), outputRole: "missing" },
      }),
    ).resolves.toMatchObject({ ok: false, diagnostic: { code: "body-not-found" } })
    expect(f.render).not.toHaveBeenCalled()
  })
  it("fails closed for empty geometry and unsupported authored representations", async () => {
    const f = fixture()
    f.unsupported.mockReturnValue("Authored relief is not supported.")
    await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "preview-representation-unsupported" },
    })
    expect(f.preview).not.toHaveBeenCalled()
    f.unsupported.mockReturnValue(null)
    f.shape.valid = false
    await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "geometry-unavailable" },
    })
    expect(f.render).not.toHaveBeenCalled()
  })
  it("rejects a superseded render generation while a later render succeeds", async () => {
    const f = fixture(),
      first = deferred<ModelPreview>()
    f.render.mockImplementationOnce(() => first.promise)
    const old = f.reader.read(f.snapshot.id, f.request)
    await vi.waitFor(() => expect(f.render).toHaveBeenCalledTimes(1))
    await expect(f.reader.read(f.snapshot.id, f.request)).resolves.toMatchObject({ ok: true })
    first.resolve(image)
    await expect(old).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "request-cancelled" },
    })
  })
})
