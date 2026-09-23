import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { featureRecordSchema } from "@vibeshape/domain/feature-graph"
import type { FeatureMeshPolicy } from "@vibeshape/protocol"
import { describe, expect, it } from "vitest"
import { createDisposableDocumentPreview } from "./disposable-document-preview"
import type { DocumentRebuildPort } from "./persistent-document-session"

const documentId = "0195b5ac-b220-7a2c-8c33-67a36a7f2101"
const mesh = { chordTolerance: 0.05, angularTolerance: 0.1 } as const

function snapshot(): DocumentSnapshot {
  return documentSnapshotSchema.parse({
    schemaVersion: 0,
    id: documentId,
    revision: 4,
    name: "Preview",
    sketches: [],
    features: [],
    variables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  })
}

function feature(id: string) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "vibeshape.part-design",
      moduleVersion: "1.0.0",
      typeId: "vibeshape.box",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies: [],
    references: [],
    suppressed: false,
  })
}

function snapshotWithFeatures(features: readonly string[]): DocumentSnapshot {
  return documentSnapshotSchema.parse({
    ...snapshot(),
    features: features.map(feature),
  })
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 21,
    requestId: "0195b5ac-b220-7a2c-8c33-67a36a7f2201",
    documentId,
    revision: 4,
    generation: 9,
    type: "documentRebuilt" as const,
    evaluation: { records: [], dirtyFeatureIds: [], evaluatedFeatureIds: [], reusedFeatureIds: [] },
    geometry: [],
    sketches: [],
    modelReferenceEvidence: [],
    ...overrides,
  }
}

type Deferred = {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: Deferred["resolve"]
  let reject!: Deferred["reject"]
  const promise = new Promise<unknown>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function portFor(
  rebuild: DocumentRebuildPort["rebuild"],
  onTerminate: () => void,
): DocumentRebuildPort {
  return {
    rebuild,
    exportDocument: async () => ({}) as never,
    solveSketch: async () => ({}) as never,
    dispose: async () => undefined,
    terminate: onTerminate,
  }
}

describe("createDisposableDocumentPreview", () => {
  it("resolves cancellation immediately and consumes a late rebuild", async () => {
    const pending = deferred()
    let terminated = 0
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => pending.promise as never,
          () => {
            terminated += 1
          },
        ),
    })

    const result = preview.preview(snapshot())
    preview.cancel()

    await expect(result).resolves.toEqual({ ok: false, code: "preview-cancelled" })
    expect(terminated).toBe(1)
    pending.resolve(response())
    await Promise.resolve()
    pending.reject(new Error("late worker failure"))
    await Promise.resolve()
    expect(terminated).toBe(1)
  })

  it("cancels the previous operation and allocates a fresh port", async () => {
    const first = deferred()
    const ports: DocumentRebuildPort[] = []
    const terminated: DocumentRebuildPort[] = []
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () => {
        const pending = ports.length === 0 ? first : null
        const port = portFor(
          async () => (pending ? pending.promise : (response() as never)) as never,
          () => terminated.push(port),
        )
        ports.push(port)
        return port
      },
    })

    const oldResult = preview.preview(snapshot())
    const currentResult = preview.preview(snapshot())

    await expect(oldResult).resolves.toEqual({ ok: false, code: "preview-cancelled" })
    await expect(currentResult).resolves.toMatchObject({ ok: true, valid: true })
    first.resolve(response())
    await Promise.resolve()
    expect(ports).toHaveLength(2)
    expect(terminated).toHaveLength(2)
    expect(ports[0]).not.toBe(ports[1])
  })

  it("disposes the active port and rejects future previews", async () => {
    const pending = deferred()
    let terminated = 0
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => pending.promise as never,
          () => {
            terminated += 1
          },
        ),
    })
    const active = preview.preview(snapshot())
    preview.dispose()

    await expect(active).resolves.toEqual({ ok: false, code: "preview-cancelled" })
    await expect(preview.preview(snapshot())).resolves.toEqual({
      ok: false,
      code: "preview-disposed",
    })
    preview.dispose()
    expect(terminated).toBe(1)
  })

  it("projects successful evidence and reports failed evaluations as invalid", async () => {
    const current = snapshot()
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => response() as never,
          () => undefined,
        ),
    })
    await expect(preview.preview(current)).resolves.toMatchObject({
      ok: true,
      evidence: { documentId, revision: 4, features: [] },
      valid: true,
    })

    const failed = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () =>
            response({
              evaluation: {
                records: [
                  {
                    featureId: "0195b5ac-b220-7a2c-8c33-67a36a7f2102",
                    status: "failed",
                    diagnostics: [{ code: "failed" }],
                  },
                ],
                dirtyFeatureIds: [],
                evaluatedFeatureIds: [],
                reusedFeatureIds: [],
              },
            }) as never,
          () => undefined,
        ),
    })
    await expect(failed.preview(current)).resolves.toEqual({
      ok: false,
      code: "invalid-geometry-evidence",
    })
  })

  it("returns preview-failed for malformed snapshots and thrown rebuilds", async () => {
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => {
            throw new Error("worker failed")
          },
          () => undefined,
        ),
    })
    await expect(preview.preview({ invalid: true } as never)).resolves.toEqual({
      ok: false,
      code: "preview-failed",
    })
    await expect(preview.preview(snapshot())).resolves.toEqual({
      ok: false,
      code: "preview-failed",
    })
  })

  it("rejects stale and malformed worker evidence with projector codes", async () => {
    const stale = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => response({ revision: 3 }) as never,
          () => undefined,
        ),
    })
    await expect(stale.preview(snapshot())).resolves.toEqual({ ok: false, code: "stale-geometry" })

    const malformed = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => ({ type: "documentRebuilt" }) as never,
          () => undefined,
        ),
    })
    await expect(malformed.preview(snapshot())).resolves.toEqual({
      ok: false,
      code: "invalid-geometry-evidence",
    })
  })

  it("marks failed and blocked evidence invalid while allowing suppression", async () => {
    const ids = [
      "0195b5ac-b220-7a2c-8c33-67a36a7f2102",
      "0195b5ac-b220-7a2c-8c33-67a36a7f2103",
      "0195b5ac-b220-7a2c-8c33-67a36a7f2104",
    ]
    const current = snapshotWithFeatures(ids)
    const mixed = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () =>
            response({
              evaluation: {
                records: [
                  {
                    featureId: ids[0],
                    status: "failed",
                    diagnostics: [{ code: "org.vibeshape.feature-failed", values: {} }],
                  },
                  { featureId: ids[1], status: "blocked", blockedBy: [ids[0]] },
                  { featureId: ids[2], status: "suppressed" },
                ],
                dirtyFeatureIds: [],
                evaluatedFeatureIds: [],
                reusedFeatureIds: [],
              },
            }) as never,
          () => undefined,
        ),
    })
    await expect(mixed.preview(current)).resolves.toMatchObject({ ok: true, valid: false })

    const suppressed = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () =>
            response({
              evaluation: {
                records: ids.map((featureId) => ({ featureId, status: "suppressed" })),
                dirtyFeatureIds: [],
                evaluatedFeatureIds: [],
                reusedFeatureIds: [],
              },
            }) as never,
          () => undefined,
        ),
    })
    await expect(suppressed.preview(current)).resolves.toMatchObject({ ok: true, valid: true })
  })

  it("detaches the snapshot and mesh at the public boundary", async () => {
    const callerMesh: FeatureMeshPolicy = { ...mesh }
    let seenSnapshot: DocumentSnapshot | null = null
    let seenMesh: FeatureMeshPolicy | null = null
    const preview = createDisposableDocumentPreview({
      mesh: callerMesh,
      createRebuildPort: () =>
        portFor(
          async ({ document, mesh: rebuildMesh }) => {
            seenSnapshot = document
            seenMesh = rebuildMesh
            return response() as never
          },
          () => undefined,
        ),
    })
    const callerSnapshot = snapshot()
    const result = preview.preview(callerSnapshot)
    ;(callerSnapshot as { name: string }).name = "mutated"
    callerMesh.chordTolerance = 0.2
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(seenSnapshot).not.toBe(callerSnapshot)
    expect((seenSnapshot as unknown as DocumentSnapshot).name).toBe("Preview")
    expect(seenMesh).toEqual(mesh)
  })

  it("contains a throwing terminate without losing terminal state", async () => {
    const preview = createDisposableDocumentPreview({
      mesh,
      createRebuildPort: () =>
        portFor(
          async () => new Promise<never>(() => undefined),
          () => {
            throw new Error("terminate failed")
          },
        ),
    })
    const result = preview.preview(snapshot())
    expect(() => preview.cancel()).not.toThrow()
    await expect(result).resolves.toEqual({ ok: false, code: "preview-cancelled" })
    preview.dispose()
    await expect(preview.preview(snapshot())).resolves.toEqual({
      ok: false,
      code: "preview-disposed",
    })
  })
})
