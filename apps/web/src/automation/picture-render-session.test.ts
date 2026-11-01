import { expect, it } from "bun:test"
import type { DisposableDocumentPreviewResult } from "@vibeshape/application/disposable-document-preview"
import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { preparePictureRenderArgumentsSchema } from "@vibeshape/automation-api/derived-reads"
import { boxFeatureType, featureRecordSchema } from "@vibeshape/domain"
import { documentSnapshotSchema, documentSnapshotV1Schema } from "@vibeshape/domain/document"
import { DOCUMENT_PROTOCOL_VERSION } from "@vibeshape/protocol"
import type { renderPicture } from "@vibeshape/viewer/picture-render"
import { vi } from "../../../../tests/unit/support/bun-test"
import { createPictureRenderSession } from "./picture-render-session"

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${String(n).padStart(12, "0")}`
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

  if (!rebuilt.rebuild) throw new Error("Missing fixture rebuild")
  const authority = documentSnapshotV1Schema.parse({
    ...snapshot,
    schemaVersion: 1,
    features: snapshot.features.map((feature) => ({
      ...feature,
      schemaVersion: 1,
      semanticInputs: [],
    })),
    history: snapshot.features.map((feature) => ({ kind: "feature", id: feature.id })),
  })
  const report: PersistentDocumentSessionReport = {
    status: "clean",
    mode: "read-write",
    snapshot,
    historyItems: null,
    rebuild: { ok: true, response: rebuilt.rebuild },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  }
  let source: {
    snapshot: typeof snapshot
    authority: typeof authority
    report: PersistentDocumentSessionReport
  } | null = { snapshot, authority, report }
  const preview = { preview: vi.fn(async () => rebuilt), cancel: vi.fn(), dispose: vi.fn() }
  const render = vi.fn<typeof renderPicture>(async () => ({
    blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }),
    width: 1080,
    height: 1080,
    mimeType: "image/png" as const,
  }))
  const materialize = vi.fn(async () => [])
  const session = createPictureRenderSession({
    documentId: snapshot.id,
    capture: () => source,
    preview,
    render,
    materializeSourceAssets: materialize,
  })
  const request = preparePictureRenderArgumentsSchema.parse({ revision: 4 })
  return {
    session,
    request,
    render,
    preview,
    snapshot,
    report,
    source,
    replace: (next: typeof source) => {
      source = next
    },
  }
}
it("renders a private bound rebuild and returns exactly the actual default settings", async () => {
  const f = fixture()
  const result = await f.session.prepare(f.request, new AbortController().signal)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("Missing picture")
  expect(result.metadata.settings).toEqual(f.request.settings)
  expect(result.documentId).toBe(f.snapshot.id)
  expect(result.file.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(f.preview.preview).toHaveBeenCalledWith(f.snapshot)
  expect(f.render.mock.calls[0]?.[0]).toMatchObject({ settings: f.request.settings })
  expect(result.isCurrent()).toBe(true)
  f.replace({ ...f.source, authority: { ...f.source.authority, name: "Changed metadata" } })
  expect(result.isCurrent()).toBe(false)
})
it.each(["project", "revision", "stop", "disconnect", "abort"] as const)(
  "rejects %s changes during private rebuild",
  async (mode) => {
    const f = fixture()
    let release!: (v: Awaited<ReturnType<typeof f.preview.preview>>) => void
    const output = await f.preview.preview()
    f.preview.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const abort = new AbortController(),
      pending = f.session.prepare(f.request, abort.signal)
    if (mode === "project")
      f.replace({
        ...f.source,
        snapshot: {
          ...f.snapshot,
          id: documentSnapshotSchema.parse({ ...f.snapshot, id: id(999) }).id,
        },
      })
    if (mode === "revision") f.replace({ ...f.source, snapshot: { ...f.snapshot, revision: 5 } })
    if (mode === "stop") f.session.cancel()
    if (mode === "disconnect") f.session.dispose()
    if (mode === "abort") abort.abort()
    release(output)
    expect(await pending).toEqual({ ok: false })
    expect(f.render).not.toHaveBeenCalled()
  },
)
it("rejects an oversized actual PNG and unsupported finish keys", async () => {
  const f = fixture()
  f.render.mockResolvedValueOnce({
    blob: new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "image/png" }),
    width: 1080,
    height: 1080,
    mimeType: "image/png",
  })
  await expect(f.session.prepare(f.request, new AbortController().signal)).rejects.toMatchObject({
    code: "export-too-large",
  })
  await expect(
    f.session.prepare(
      { ...f.request, settings: { ...f.request.settings, finishes: { unknown: "wood" } } },
      new AbortController().signal,
    ),
  ).rejects.toThrow("unavailable visible body")
})

it("captures committed Part visibility, body colours and material presets independently of the active viewport", async () => {
  const { authoredTreeFixture, authoredTestBody } = await import(
    "../test-support/authored-tree-fixture"
  )
  const { promoteDocumentSnapshotV6, documentSnapshotV6Schema } = await import(
    "@vibeshape/domain/document-v6"
  )
  const { snapshot, authority: base } = authoredTreeFixture()
  const lifted = promoteDocumentSnapshotV6(base)
  const first = lifted.parts[0],
    hidden = lifted.parts[1]
  if (!first || !hidden) throw new Error("Expected authored Parts")
  const authority = documentSnapshotV6Schema.parse({
    ...lifted,
    parts: lifted.parts.map((part) => ({ ...part, visible: part.id !== hidden.id })),
    partAppearances: [{ partId: first.id, appearance: { color: "#123456", presetId: "brass" } }],
  })
  const geometry = authority.parts.map((part) => {
    const body = authoredTestBody(part)
    return {
      featureId: body.featureId,
      contentHash: body.contentHash,
      meshPolicy: { chordTolerance: 0.05, angularTolerance: 0.1 },
      geometry: {
        engine: {
          adapter: "replicad",
          adapterVersion: "test-build",
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
              adapterVersion: "test-build",
              kernelId: "org.opencascade.occt",
              kernelVersion: "7.9.2",
              kernelSourceRevision: null,
            },
            modelingTolerancePolicyVersion: 1,
            provider: { kind: "built-in" },
          },
        },
        cache: { brepHit: false },
        timings: { evaluationMs: 1, tessellationMs: 1, totalMs: 2 },
        shape: body.shape,
        mesh: body.mesh,
        topologyCandidates: [],
        bodies: [
          {
            outputRole: body.outputRole,
            shape: body.shape,
            mesh: body.mesh,
            topologyCandidates: [],
          },
        ],
      },
    }
  })
  const { featureGeometryRecordSchema } = await import("@vibeshape/application/feature-rebuild")
  for (const record of geometry) featureGeometryRecordSchema.parse(record)
  const rebuilt = {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    type: "documentRebuilt",
    documentId: snapshot.id,
    revision: snapshot.revision,
    generation: 1,
    requestId: id(990),
    evaluation: {
      records: snapshot.features.map((feature) => ({
        featureId: feature.id,
        status: "succeeded",
        contentHash: "a".repeat(64),
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: snapshot.features.map((feature) => feature.id),
      reusedFeatureIds: [],
    },
    geometry,
    sketches: [],
    modelReferenceEvidence: [],
  }
  const outcome = {
    ok: true,
    valid: true,
    evidence: { documentId: snapshot.id, revision: snapshot.revision, generation: 1 },
    rebuild: rebuilt,
  } as unknown as Extract<DisposableDocumentPreviewResult, { ok: true }>
  if (!outcome.rebuild) throw new Error("Missing fixture rebuild")
  const report: PersistentDocumentSessionReport = {
    status: "clean",
    mode: "read-write",
    snapshot,
    historyItems: null,
    rebuild: { ok: true, response: outcome.rebuild },
    lostRevisionCount: 0,
    corruptRecords: [],
    migration: null,
    writeAccessDiagnostic: null,
  }
  const f = fixture()
  const session = createPictureRenderSession({
    documentId: snapshot.id,
    capture: () => ({ snapshot, authority, report }),
    preview: { preview: async () => outcome, cancel: () => {}, dispose: () => {} },
    render: f.render,
    materializeSourceAssets: async () => [],
  })
  const request = preparePictureRenderArgumentsSchema.parse({ revision: snapshot.revision })
  expect((await session.prepare(request, new AbortController().signal)).ok).toBe(true)
  const meshes = f.render.mock.calls[0]?.[0].meshes
  expect(meshes).toHaveLength(2)
  expect(meshes?.some((mesh) => mesh.featureId === hidden.bodyHistory[0]?.featureId)).toBe(false)
  expect(meshes?.find((mesh) => mesh.featureId === first.bodyHistory[0]?.featureId)).toMatchObject({
    color: "#123456",
    material: { metalness: 0.86 },
  })
})
