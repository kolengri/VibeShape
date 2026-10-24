import { createModelDiagnosticsEvidence } from "@vibeshape/application/model-diagnostics"
import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  canonicalJson,
  type DocumentSnapshot,
  documentSnapshotSchema,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readHoleFeatureParameters,
  readRevolveFeatureParameters,
} from "@vibeshape/domain"
import type { ModelDiagnosticsEvidence } from "@vibeshape/domain/model-diagnostics"
import { readLoftFeatureParametersV3 } from "@vibeshape/domain/part-design-loft-v3"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { isError } from "is-what"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  createBrowserDocumentId,
  materializeActiveDocumentSourceAssets,
} from "../../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"
import { type ModelBodyGeometry, terminalModelBodies } from "../part-design/model-bodies"
import {
  isBooleanFeature,
  isBoxFeature,
  isChamferFeature,
  isConeFeature,
  isCylinderFeature,
  isFilletFeature,
  isPyramidFeature,
  isSphereFeature,
  isTorusFeature,
} from "../part-design/part-design-tool"
import {
  completeFeaturePreviewResponse,
  scopeFeaturePreviewDocument,
} from "./feature-preview-scope"

type PreviewSession = Pick<ReturnType<typeof createDocumentWorkerSession>, "rebuild" | "terminate">

type PreviewQueue = { running: boolean; pending: (() => Promise<void>) | null }

function enqueuePreview(queue: PreviewQueue, task: () => Promise<void>) {
  queue.pending = task
  if (queue.running) return
  queue.running = true
  void (async () => {
    try {
      while (queue.pending) {
        const next = queue.pending
        queue.pending = null
        await next()
      }
    } finally {
      queue.running = false
    }
  })()
}

type PreviewGeometryIdentity = Readonly<{
  contentHash: string
  featureId: string
  outputRole?: string
}>

export type FeaturePreviewKind =
  | "edge-treatment"
  | "hole"
  | "datum-plane"
  | "extrusion"
  | "primitive"
  | "revolve"
  | "subtract"

export type FeaturePreviewState = Readonly<{
  assistantDraft?: Readonly<{ documentId: string; draftId: string; baseRevision: number }>
  display?: "result" | "changes"
  candidateMesh?: ViewerMesh
  kind?: FeaturePreviewKind
  meshes: readonly ViewerMesh[]
  status: "idle" | "loading" | "ready" | "error"
  retained?: true
  diagnostic?: string
  diagnostics?: ModelDiagnosticsEvidence["entries"]
}>

type ExactPreview = {
  snapshot: DocumentSnapshot
  featureId: FeatureRecord["id"]
  preview: FeaturePreviewState
}

function pendingPreview(
  previous: ExactPreview | null,
  snapshot: DocumentSnapshot,
  candidate: FeatureRecord,
  retainPrevious: boolean,
): FeaturePreviewState {
  const kind = featurePreviewKind(candidate)
  if (retainPrevious && previous?.snapshot === snapshot && previous.featureId === candidate.id)
    return { ...previous.preview, status: "loading", kind, retained: true }
  return { status: "loading", meshes: [], kind }
}

function failedPreview(candidate: FeatureRecord, error: unknown): FeaturePreviewState {
  return {
    status: "error",
    meshes: [],
    kind: featurePreviewKind(candidate),
    ...(error instanceof FeaturePreviewFailure && error.diagnostics.length > 0
      ? { diagnostics: error.diagnostics }
      : {}),
    ...(readLoftFeatureParametersV3(candidate) && isError(error)
      ? { diagnostic: error.message }
      : {}),
  }
}

function createFeaturePreviewCandidateMesh(
  geometry: readonly (PreviewGeometryIdentity &
    Readonly<{ geometry: { mesh: Omit<ViewerMesh, "featureId"> } }>)[],
  featureId: FeatureRecord["id"],
) {
  const candidate = geometry.find((result) => result.featureId === featureId)
  return candidate
    ? ({
        ...candidate.geometry.mesh,
        appearance: "preview",
        featureId,
        ...(candidate.outputRole === undefined ? {} : { outputRole: candidate.outputRole }),
      } satisfies ViewerMesh)
    : undefined
}

function previewFeatures(snapshot: DocumentSnapshot, candidate: FeatureRecord) {
  const index = snapshot.features.findIndex(({ id }) => id === candidate.id)
  if (index < 0) return [...snapshot.features, candidate]
  return snapshot.features.map((feature) => (feature.id === candidate.id ? candidate : feature))
}

export function createFeaturePreviewDocument(
  snapshot: DocumentSnapshot,
  candidate: FeatureRecord,
  previewDocumentId: DocumentSnapshot["id"],
) {
  return documentSnapshotSchema.parse({
    ...snapshot,
    id: previewDocumentId,
    features: previewFeatures(snapshot, candidate),
  })
}

export function createFeaturePreviewMeshes(
  document: DocumentSnapshot,
  response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>,
  committedGeometry: readonly PreviewGeometryIdentity[],
): readonly ViewerMesh[] {
  const datumIds = new Set<string>(
    document.features
      .filter((feature) => readDatumPlaneFeatureParameters(feature) !== null)
      .map(({ id }) => id),
  )
  const committedHashes = new Map(
    committedGeometry.map(({ contentHash, featureId }) => [featureId, contentHash]),
  )
  const bodies = terminalModelBodies(document.features, response, [...datumIds])
  if (!bodies) return []
  const modelMeshes = bodies.map(({ geometry: body }: { geometry: ModelBodyGeometry }) => {
    const { contentHash, featureId, outputRole, mesh } = body
    return {
      ...mesh,
      featureId,
      ...(outputRole === undefined ? {} : { outputRole }),
      appearance: committedHashes.get(featureId) === contentHash ? "model" : "preview",
    }
  }) satisfies readonly ViewerMesh[]
  const datumMeshes = response.geometry
    .filter(({ featureId }) => datumIds.has(featureId))
    .map(({ featureId, geometry }) => ({
      ...geometry.mesh,
      featureId,
      appearance: "datum" as const,
    }))
  return [...modelMeshes, ...datumMeshes]
}

class FeaturePreviewFailure extends Error {
  constructor(
    message: string,
    readonly diagnostics: ModelDiagnosticsEvidence["entries"],
  ) {
    super(message)
  }
}

function assertCandidatePreviewSucceeded(
  document: DocumentSnapshot,
  candidate: FeatureRecord,
  response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>,
) {
  const evaluation = response.evaluation.records.find(({ featureId }) => featureId === candidate.id)
  if (evaluation?.status === "succeeded") return
  const diagnostic =
    evaluation?.status === "failed" && readLoftFeatureParametersV3(candidate)
      ? evaluation.diagnostics.find(({ values }) => typeof values.message === "string")?.values
          .message
      : null
  const evidence = createModelDiagnosticsEvidence(document, { ok: true, response })
  const diagnostics = evidence.ok
    ? evidence.evidence.entries.filter(
        (entry) => entry.entity.kind === "feature" && entry.entity.id === candidate.id,
      )
    : []
  throw new FeaturePreviewFailure(
    typeof diagnostic === "string" ? diagnostic : "The feature preview could not be evaluated.",
    diagnostics,
  )
}

async function rebuildPreview(
  session: PreviewSession,
  snapshot: DocumentSnapshot,
  candidate: FeatureRecord,
  previewDocumentId: DocumentSnapshot["id"],
  committedGeometry: readonly PreviewGeometryIdentity[],
  committedResponse: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> | null,
) {
  const document = createFeaturePreviewDocument(snapshot, candidate, previewDocumentId)
  const committed =
    committedResponse && matchesCommittedRevision(snapshot, committedResponse)
      ? committedResponse
      : null
  const scoped = committed ? scopeFeaturePreviewDocument(document, candidate.id) : document
  const response = await session.rebuild({ document: scoped, mesh: PRODUCT_MESH_POLICY })
  assertCandidatePreviewSucceeded(scoped, candidate, response)
  return {
    candidateMesh: createFeaturePreviewCandidateMesh(response.geometry, candidate.id),
    meshes: createFeaturePreviewMeshes(
      document,
      committed ? completeFeaturePreviewResponse(scoped, response, committed) : response,
      committedGeometry,
    ),
  }
}

export function featurePreviewKind(candidate: FeatureRecord): FeaturePreviewKind {
  if (isBooleanFeature(candidate)) return "subtract"
  if (readHoleFeatureParameters(candidate)) return "hole"
  if (readDatumPlaneFeatureParameters(candidate)) return "datum-plane"
  if (readRevolveFeatureParameters(candidate)) return "revolve"
  if (isFilletFeature(candidate) || isChamferFeature(candidate)) return "edge-treatment"
  if (
    [
      isBoxFeature,
      isCylinderFeature,
      isSphereFeature,
      isConeFeature,
      isPyramidFeature,
      isTorusFeature,
    ].some((matches) => matches(candidate))
  ) {
    return "primitive"
  }
  return "extrusion"
}

function currentFeatureGeometry(
  response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>,
  featureId: string,
) {
  const evaluation = response.evaluation.records.find((record) => record.featureId === featureId)
  if (evaluation?.status !== "succeeded") return false
  const source = response.geometry.find((record) => record.featureId === featureId)
  return source?.contentHash === evaluation.contentHash
}

function matchesCommittedRevision(
  snapshot: DocumentSnapshot,
  response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>,
) {
  return response.documentId === snapshot.id && response.revision === snapshot.revision
}

function committedPreview(
  snapshot: DocumentSnapshot | null,
  candidate: FeatureRecord | null,
  response: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> | null,
): ExactPreview | null {
  if (!snapshot || !candidate || !response) return null
  if (!matchesCommittedRevision(snapshot, response)) return null
  const saved = snapshot.features.find(({ id }) => id === candidate.id)
  if (!saved || canonicalJson(saved) !== canonicalJson(candidate)) return null
  if (!currentFeatureGeometry(response, candidate.id)) return null
  const candidateMesh = createFeaturePreviewCandidateMesh(response.geometry, candidate.id)
  return {
    snapshot,
    featureId: candidate.id,
    preview: {
      status: "ready",
      kind: featurePreviewKind(candidate),
      ...(candidateMesh ? { candidateMesh } : {}),
      meshes: createFeaturePreviewMeshes(snapshot, response, response.geometry),
    },
  }
}

export function useFeaturePreview(
  snapshot: DocumentSnapshot | null,
  candidate: FeatureRecord | null,
  committedGeometry: readonly PreviewGeometryIdentity[],
  sessionActive = candidate !== null,
  committedResponse: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> | null = null,
  retainPreviousGeometry = false,
) {
  const [state, setState] = useState<FeaturePreviewState>({ status: "idle", meshes: [] })
  const sequenceRef = useRef(0)
  const lastReadyRef = useRef<ExactPreview | null>(null)
  const sessionRef = useRef<{ worker: PreviewSession; queue: PreviewQueue } | null>(null)
  const previewDocumentId = useMemo(
    () => (snapshot ? createBrowserDocumentId() : null),
    [snapshot?.id],
  )
  const candidateKey = canonicalJson(candidate)
  const cached = useMemo(
    () => committedPreview(snapshot, candidate, committedResponse),
    [snapshot, candidateKey, committedResponse],
  )
  useEffect(() => {
    if (!previewDocumentId || !sessionActive) return
    return () => {
      const session = sessionRef.current
      sessionRef.current = null
      if (session) {
        session.queue.pending = null
        session.worker.terminate()
      }
    }
  }, [previewDocumentId, sessionActive])

  useEffect(() => {
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    if (sessionRef.current) sessionRef.current.queue.pending = null
    if (cached) {
      lastReadyRef.current = cached
      setState(cached.preview)
      return
    }
    if (!snapshot || !candidate || !previewDocumentId || !sessionActive) {
      lastReadyRef.current = null
      setState({ status: "idle", meshes: [] })
      return
    }
    // An untouched History edit or a debouncing form needs no extra kernel worker.
    const session = sessionRef.current ?? {
      worker: createDocumentWorkerSession(previewDocumentId, {
        retryRecoverableFailure: false,
        materializeSourceAssets: materializeActiveDocumentSourceAssets,
      }),
      queue: { running: false, pending: null },
    }
    sessionRef.current = session
    const kind = featurePreviewKind(candidate)
    // Placement keeps its last exact pose while the next exact result is pending.
    const pending = pendingPreview(
      lastReadyRef.current,
      snapshot,
      candidate,
      retainPreviousGeometry,
    )
    if (!pending.retained) lastReadyRef.current = null
    setState(pending)
    enqueuePreview(session.queue, () =>
      rebuildPreview(
        session.worker,
        snapshot,
        candidate,
        previewDocumentId,
        committedGeometry,
        committedResponse,
      ).then(
        ({ candidateMesh, meshes }) => {
          if (sequenceRef.current === sequence) {
            const preview = {
              status: "ready" as const,
              meshes,
              kind,
              ...(candidateMesh ? { candidateMesh } : {}),
            }
            lastReadyRef.current = { snapshot, featureId: candidate.id, preview }
            setState(preview)
          }
        },
        (error: unknown) => {
          if (sequenceRef.current === sequence) {
            lastReadyRef.current = null
            setState(failedPreview(candidate, error))
          }
        },
      ),
    )
    return () => {
      sequenceRef.current += 1
      session.queue.pending = null
    }
  }, [
    candidateKey,
    cached,
    committedGeometry,
    committedResponse,
    previewDocumentId,
    snapshot,
    sessionActive,
    retainPreviousGeometry,
  ])

  return state
}
