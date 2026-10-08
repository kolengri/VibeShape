import "../../../../../tests/unit/support/dom"
import { afterEach, describe, expect, it, mock } from "bun:test"
import type { FeatureRecord } from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import { vi } from "../../../../../tests/unit/support/bun-test"

const createSession = (() => vi.fn())()
mock.module("@vibeshape/document-worker/session", () => ({
  createDocumentWorkerSession: createSession,
}))

const { act, cleanup, renderHook } = await import("@testing-library/react")
const {
  booleanFeatureTypeV2,
  boxFeatureType,
  coneFeatureType,
  createLengthQuantity,
  datumPlaneFeatureType,
  documentIdSchema,
  documentSnapshotSchema,
  featureIdSchema,
  featureRecordSchema,
  holeFeatureTypeV2,
  pyramidFeatureType,
  sphereFeatureType,
  torusFeatureType,
} = await import("@vibeshape/domain")
const { DOCUMENT_PROTOCOL_VERSION } = await import("@vibeshape/protocol")
const {
  createFeaturePreviewDocument,
  createFeaturePreviewMeshes,
  featurePreviewKind,
  useFeaturePreview,
} = await import("./use-feature-preview")

afterEach(() => {
  cleanup()
  createSession.mockReset()
})

const documentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2101")
const previewDocumentId = documentIdSchema.parse("0195b5ac-b213-7f2c-9c33-67a36a7f2102")
const baseId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3101")
const independentId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3102")
const candidateId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3103")
const datumId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3104")
const holeId = featureIdSchema.parse("0195b5ac-b220-7a2c-8c33-67a36a7f3105")

function feature(id: typeof baseId, dependencies: readonly (typeof baseId)[] = []) {
  return featureRecordSchema.parse({
    schemaVersion: 0,
    id,
    type: {
      moduleId: "org.vibeshape.core.part-design",
      moduleVersion: "0.1.0",
      typeId: "org.vibeshape.feature.part-design.box",
      schemaVersion: 1,
    },
    parameters: {},
    dependencies,
    references: [],
    suppressed: false,
  })
}

const snapshot = documentSnapshotSchema.parse({
  schemaVersion: 0,
  id: documentId,
  revision: 4,
  name: "Preview test",
  displayUnits: { length: "mm", angle: "deg" },
  variables: [],
  sketches: [],
  features: [feature(baseId), feature(independentId)],
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
})

const mesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  triangleFaceIds: new Uint32Array([1]),
}

function hash(label: string) {
  const discriminator = label
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0)
    .toString(16)
  return `${discriminator}${"a".repeat(64)}`.slice(0, 64)
}

function rebuiltResponse(
  geometry: readonly { featureId: string; contentHash: string; geometry: { mesh: typeof mesh } }[],
): Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> {
  return {
    type: "documentRebuilt",
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId: previewDocumentId,
    documentId: documentId,
    revision: 4,
    generation: 1,
    evaluation: {
      records: geometry.map(({ featureId, contentHash }) => ({
        featureId: featureId as typeof baseId,
        status: "succeeded" as const,
        contentHash: contentHash as `${string}`,
      })),
      dirtyFeatureIds: [],
      evaluatedFeatureIds: geometry.map(({ featureId }) => featureId as typeof baseId),
      reusedFeatureIds: [],
    },
    geometry: geometry.map((record) => ({
      featureId: record.featureId,
      contentHash: record.contentHash,
      meshPolicy: { chordTolerance: 0.01, angularTolerance: 0.1 },
      geometry: {
        ...record.geometry,
        shape: {
          valid: true,
          volume: 1,
          surfaceArea: 1,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          faceCount: 1,
          edgeCount: 3,
          solidCount: 1,
        },
        topologyCandidates: [],
      },
    })) as never,
    sketches: [],
    modelReferenceEvidence: [],
  }
}

describe("feature preview worker lifetime", () => {
  it("does not start kernel workers while untouched History forms debounce between items", () => {
    const response = rebuiltResponse([
      { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
      { featureId: independentId, contentHash: hash("independent"), geometry: { mesh } },
    ])
    const { rerender } = renderHook(
      ({ candidate }: { candidate: FeatureRecord | null }) =>
        useFeaturePreview(snapshot, candidate, response.geometry, true, response),
      { initialProps: { candidate: null as FeatureRecord | null } },
    )
    for (let index = 0; index < 20; index += 1) {
      rerender({ candidate: snapshot.features[index % 2]! })
      rerender({ candidate: null })
    }
    expect(createSession).not.toHaveBeenCalled()
  })
  it("uses correlated committed geometry for untouched History edits and rebuilds actual changes", () => {
    const response = rebuiltResponse([
      { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
      { featureId: independentId, contentHash: hash("independent"), geometry: { mesh } },
    ])
    const session = {
      rebuild: vi.fn(() => new Promise<DocumentWorkerResponse>(() => {})),
      terminate: vi.fn(),
    }
    createSession.mockReturnValue(session)
    const original = snapshot.features[0]!
    const { result, rerender } = renderHook(
      ({ candidate }) => useFeaturePreview(snapshot, candidate, response.geometry, true, response),
      { initialProps: { candidate: original } },
    )
    expect(result.current.status).toBe("ready")
    expect(result.current.meshes).toHaveLength(2)
    expect(result.current.candidateMesh?.positions).toBe(mesh.positions)
    expect(createSession).not.toHaveBeenCalled()
    rerender({ candidate: { ...original } })
    expect(createSession).not.toHaveBeenCalled()
    rerender({ candidate: { ...original, parameters: { width: 20 } } })
    expect(session.rebuild).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe("loading")
  })
  it("does not reuse stale committed evidence for an untouched edit", () => {
    const response = {
      ...rebuiltResponse([{ featureId: baseId, contentHash: hash("base"), geometry: { mesh } }]),
      revision: snapshot.revision - 1,
    }
    const session = {
      rebuild: vi.fn(() => new Promise<DocumentWorkerResponse>(() => {})),
      terminate: vi.fn(),
    }
    createSession.mockReturnValue(session)
    const { result } = renderHook(() =>
      useFeaturePreview(snapshot, snapshot.features[0]!, response.geometry, true, response),
    )
    expect(result.current.status).toBe("loading")
    expect(session.rebuild).toHaveBeenCalledTimes(1)
  })

  it("keeps the worker through debounce invalidation and terminates it when the tool closes", async () => {
    const rejectFirst = vi.fn<(error: Error) => void>()
    const firstWork = new Promise<never>((_, reject) => rejectFirst.mockImplementation(reject))
    const firstSession = { rebuild: vi.fn(() => firstWork), terminate: vi.fn() }
    const rejectSecond = vi.fn<(error: Error) => void>()
    const secondWork = new Promise<never>((_, reject) => rejectSecond.mockImplementation(reject))
    const secondSession = { rebuild: vi.fn(() => secondWork), terminate: vi.fn() }
    createSession.mockReturnValueOnce(firstSession).mockReturnValueOnce(secondSession)
    const candidate = feature(candidateId)
    const committedGeometry: readonly { featureId: string; contentHash: string }[] = []
    const initialProps: { active: boolean; candidate: FeatureRecord | null } = {
      active: false,
      candidate: null,
    }
    const { result, rerender, unmount } = renderHook(
      ({ active, candidate }: { active: boolean; candidate: FeatureRecord | null }) =>
        useFeaturePreview(snapshot, candidate, committedGeometry, active),
      { initialProps },
    )

    expect(createSession).not.toHaveBeenCalled()
    rerender({ active: true, candidate })
    expect(firstSession.rebuild).toHaveBeenCalledTimes(1)
    rerender({ active: true, candidate: null })
    expect(firstSession.terminate).not.toHaveBeenCalled()
    expect(result.current.status).toBe("idle")
    rerender({ active: true, candidate })
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(firstSession.rebuild).toHaveBeenCalledTimes(1)
    rerender({ active: false, candidate: null })
    expect(firstSession.terminate).toHaveBeenCalledTimes(1)
    rerender({ active: true, candidate })
    expect(secondSession.rebuild).toHaveBeenCalledTimes(1)
    await act(async () => rejectFirst(new Error("The previous worker was terminated.")))
    expect(result.current.status).toBe("loading")
    expect(firstSession.rebuild).toHaveBeenCalledTimes(1)

    unmount()
    expect(secondSession.terminate).toHaveBeenCalledTimes(1)
    await act(async () => rejectSecond(new Error("The preview was unmounted.")))
  })

  it("keeps only the latest pending rebuild while the kernel evaluates a previous candidate", async () => {
    let complete!: (response: DocumentWorkerResponse) => void
    const response = rebuiltResponse([
      { featureId: candidateId, contentHash: hash("candidate"), geometry: { mesh } },
    ])
    const session = {
      rebuild: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<DocumentWorkerResponse>((resolve) => {
              complete = resolve
            }),
        )
        .mockResolvedValue(response),
      terminate: vi.fn(),
    }
    createSession.mockReturnValue(session)
    const geometry: readonly { featureId: string; contentHash: string }[] = []
    const candidate = feature(candidateId)
    const { result, rerender } = renderHook(
      ({ width }) =>
        useFeaturePreview(snapshot, { ...candidate, parameters: { width } }, geometry, true),
      { initialProps: { width: 10 } },
    )
    rerender({ width: 20 })
    rerender({ width: 30 })
    rerender({ width: 40 })
    expect(session.rebuild).toHaveBeenCalledTimes(1)
    await act(async () => complete(response))
    expect(session.rebuild).toHaveBeenCalledTimes(2)
    expect(session.rebuild.mock.calls[1]?.[0].document.features.at(-1).parameters).toEqual({
      width: 40,
    })
    expect(result.current.status).toBe("ready")
  })
})

describe("feature preview composition", () => {
  it("classifies exact-body Subtract as a feature preview", () => {
    const candidate = featureRecordSchema.parse({
      ...feature(candidateId, [baseId]),
      type: booleanFeatureTypeV2.type,
      parameters: {
        operation: "subtract",
        targetBody: { featureId: baseId, outputRole: "pattern.instance.0" },
        toolBody: { featureId: baseId, outputRole: "pattern.instance.1" },
      },
    })

    expect(featurePreviewKind(candidate)).toBe("subtract")
  })

  it("classifies structurally parsed primitive feature types as primitive previews", () => {
    const candidate = featureRecordSchema.parse({
      schemaVersion: 0,
      id: candidateId,
      type: { ...boxFeatureType.type },
      parameters: {
        width: createLengthQuantity(20),
        depth: createLengthQuantity(20),
        height: createLengthQuantity(20),
        centered: false,
        origin: {
          x: createLengthQuantity(0),
          y: createLengthQuantity(0),
          z: createLengthQuantity(0),
        },
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })

    expect(featurePreviewKind(candidate)).toBe("primitive")
  })

  it.each([
    sphereFeatureType.type,
    coneFeatureType.type,
    pyramidFeatureType.type,
    torusFeatureType.type,
  ])("classifies $typeId as a primitive preview", (type) => {
    expect(featurePreviewKind(featureRecordSchema.parse({ ...feature(candidateId), type }))).toBe(
      "primitive",
    )
  })

  it("creates a disposable document without mutating the committed snapshot", () => {
    const candidate = feature(candidateId, [baseId])
    const preview = createFeaturePreviewDocument(snapshot, candidate, previewDocumentId)

    expect(preview.id).toBe(previewDocumentId)
    expect(preview.features.map(({ id }) => id)).toEqual([baseId, independentId, candidateId])
    expect(snapshot.id).toBe(documentId)
    expect(snapshot.features.map(({ id }) => id)).toEqual([baseId, independentId])
  })

  it("replaces an edited feature identity instead of appending a duplicate", () => {
    const edited = feature(baseId)
    const preview = createFeaturePreviewDocument(snapshot, edited, previewDocumentId)

    expect(preview.features).toHaveLength(2)
    expect(preview.features[0]?.id).toBe(baseId)
  })

  it("marks only changed terminal geometry as preview", () => {
    const document = createFeaturePreviewDocument(
      snapshot,
      feature(candidateId, [baseId]),
      previewDocumentId,
    )
    const meshes = createFeaturePreviewMeshes(
      document,
      rebuiltResponse([
        { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
        { featureId: independentId, contentHash: hash("independent"), geometry: { mesh } },
        { featureId: candidateId, contentHash: hash("candidate"), geometry: { mesh } },
      ]),
      [
        { featureId: baseId, contentHash: hash("base") },
        { featureId: independentId, contentHash: hash("independent") },
      ],
    )

    expect(meshes.map(({ appearance, featureId }) => ({ appearance, featureId }))).toEqual([
      { featureId: independentId, appearance: "model" },
      { featureId: candidateId, appearance: "preview" },
    ])
  })

  it("retains changed datum geometry as a selectable translucent reference preview", () => {
    const datum = featureRecordSchema.parse({
      schemaVersion: 0,
      id: datumId,
      type: datumPlaneFeatureType.type,
      parameters: {
        mode: "offset",
        support: { kind: "origin-plane", plane: "xy" },
        offset: createLengthQuantity(12),
      },
      dependencies: [],
      references: [],
      suppressed: false,
    })
    const document = createFeaturePreviewDocument(snapshot, datum, previewDocumentId)
    const meshes = createFeaturePreviewMeshes(
      document,
      rebuiltResponse([
        { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
        { featureId: independentId, contentHash: hash("independent"), geometry: { mesh } },
        { featureId: datumId, contentHash: hash("datum"), geometry: { mesh } },
      ]),
      [
        { featureId: baseId, contentHash: hash("base") },
        { featureId: independentId, contentHash: hash("independent") },
      ],
    )

    expect(meshes.map(({ appearance, featureId }) => ({ appearance, featureId }))).toEqual([
      { featureId: baseId, appearance: "model" },
      { featureId: independentId, appearance: "model" },
      { featureId: datumId, appearance: "datum" },
    ])
  })

  it("preserves every terminal body role when projecting preview meshes", () => {
    const baseDocument = createFeaturePreviewDocument(snapshot, feature(baseId), previewDocumentId)
    const response = rebuiltResponse([
      { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
      { featureId: independentId, contentHash: hash("independent"), geometry: { mesh } },
    ])
    const roleResponse = {
      ...response,
      geometry: response.geometry.map((record) =>
        record.featureId === baseId
          ? {
              ...record,
              geometry: {
                ...record.geometry,
                shape: { ...record.geometry.shape, solidCount: 2 },
                bodies: [
                  {
                    outputRole: "pattern.instance.0",
                    shape: { ...record.geometry.shape, solidCount: 1 },
                    mesh,
                    topologyCandidates: [],
                  },
                  {
                    outputRole: "pattern.instance.1",
                    shape: { ...record.geometry.shape, solidCount: 1 },
                    mesh,
                    topologyCandidates: [],
                  },
                ],
              },
            }
          : record,
      ),
    } as Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

    const meshes = createFeaturePreviewMeshes(baseDocument, roleResponse, [
      { featureId: baseId, contentHash: hash("base") },
      { featureId: independentId, contentHash: hash("independent") },
    ])

    expect(
      meshes.map((mesh) => ({
        featureId: mesh.featureId,
        outputRole: "outputRole" in mesh ? mesh.outputRole : undefined,
        appearance: mesh.appearance,
      })),
    ).toEqual([
      { featureId: baseId, outputRole: "pattern.instance.0", appearance: "model" },
      { featureId: baseId, outputRole: "pattern.instance.1", appearance: "model" },
      { featureId: independentId, outputRole: undefined, appearance: "model" },
    ])
  })

  it("keeps unconsumed source bodies when Hole v2 targets one role", () => {
    const hole = featureRecordSchema.parse({
      schemaVersion: 0,
      id: holeId,
      type: holeFeatureTypeV2.type,
      parameters: {
        sketchId: "0195b5ac-b220-7a2c-8c33-67a36a7f3201",
        pointIds: ["0195b5ac-b220-7a2c-8c33-67a36a7f3211"],
        diameter: createLengthQuantity(8),
        direction: "forward",
        extent: "blind",
        depth: createLengthQuantity(12),
        targetBody: { schemaVersion: 0, featureId: baseId, outputRole: "pattern.instance.1" },
      },
      dependencies: [baseId],
      references: [],
      suppressed: false,
    })
    const document = createFeaturePreviewDocument(
      documentSnapshotSchema.parse({ ...snapshot, features: [feature(baseId)] }),
      hole,
      previewDocumentId,
    )
    const response = rebuiltResponse([
      { featureId: baseId, contentHash: hash("base"), geometry: { mesh } },
      { featureId: holeId, contentHash: hash("hole"), geometry: { mesh } },
    ])
    const roleResponse = {
      ...response,
      geometry: response.geometry.map((record) =>
        record.featureId === baseId
          ? {
              ...record,
              geometry: {
                ...record.geometry,
                shape: { ...record.geometry.shape, solidCount: 3 },
                bodies: [0, 1, 2].map((index) => ({
                  outputRole: `pattern.instance.${index}`,
                  shape: { ...record.geometry.shape, solidCount: 1 },
                  mesh,
                  topologyCandidates: [],
                })),
              },
            }
          : record,
      ),
    } as Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>

    const meshes = createFeaturePreviewMeshes(document, roleResponse, [
      { featureId: baseId, contentHash: hash("base") },
    ])

    expect(
      meshes.map(({ featureId, outputRole, appearance }) => ({
        featureId,
        outputRole,
        appearance,
      })),
    ).toEqual([
      { featureId: baseId, outputRole: "pattern.instance.0", appearance: "model" },
      { featureId: baseId, outputRole: "pattern.instance.2", appearance: "model" },
      { featureId: holeId, outputRole: undefined, appearance: "preview" },
    ])

    const failedConsumerResponse = {
      ...roleResponse,
      evaluation: {
        ...roleResponse.evaluation,
        records: [
          roleResponse.evaluation.records.find(({ featureId }) => featureId === baseId),
          {
            featureId: holeId,
            status: "failed" as const,
            diagnostics: [{ code: "org.vibeshape.test", values: {} }],
          },
        ],
      },
      geometry: roleResponse.geometry.filter(({ featureId }) => featureId === baseId),
    } as Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>
    const failedMeshes = createFeaturePreviewMeshes(document, failedConsumerResponse, [
      { featureId: baseId, contentHash: hash("base") },
    ])
    expect(failedMeshes.map(({ featureId, outputRole }) => ({ featureId, outputRole }))).toEqual([
      { featureId: baseId, outputRole: "pattern.instance.0" },
      { featureId: baseId, outputRole: "pattern.instance.1" },
      { featureId: baseId, outputRole: "pattern.instance.2" },
    ])
  })
})
