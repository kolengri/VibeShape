import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  type DocumentSnapshot,
  documentSnapshotSchema,
  type FeatureRecord,
  readDatumPlaneFeatureParameters,
  readHoleFeatureParameters,
  readRevolveFeatureParameters,
} from "@vibeshape/domain"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useRef, useState } from "react"
import { createBrowserDocumentId } from "../../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"
import { type ModelBodyGeometry, terminalModelBodies } from "../part-design/model-bodies"
import {
  isBoxFeature,
  isChamferFeature,
  isCylinderFeature,
  isFilletFeature,
} from "../part-design/part-design-tool"

type PreviewSession = Pick<ReturnType<typeof createDocumentWorkerSession>, "rebuild" | "terminate">

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

export type FeaturePreviewState = Readonly<{
  candidateMesh?: ViewerMesh
  kind?: FeaturePreviewKind
  meshes: readonly ViewerMesh[]
  status: "idle" | "loading" | "ready" | "error"
}>

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

async function rebuildPreview(
  session: PreviewSession,
  snapshot: DocumentSnapshot,
  candidate: FeatureRecord,
  previewDocumentId: DocumentSnapshot["id"],
  committedGeometry: readonly PreviewGeometryIdentity[],
) {
  const document = createFeaturePreviewDocument(snapshot, candidate, previewDocumentId)
  const response = await session.rebuild({ document, mesh: PRODUCT_MESH_POLICY })
  const candidateEvaluation = response.evaluation.records.find(
    ({ featureId }) => featureId === candidate.id,
  )
  if (candidateEvaluation?.status !== "succeeded") {
    throw new Error("The feature preview could not be evaluated.")
  }
  return {
    candidateMesh: createFeaturePreviewCandidateMesh(response.geometry, candidate.id),
    meshes: createFeaturePreviewMeshes(document, response, committedGeometry),
  }
}

export function featurePreviewKind(candidate: FeatureRecord): FeaturePreviewKind {
  if (readHoleFeatureParameters(candidate)) return "hole"
  if (readDatumPlaneFeatureParameters(candidate)) return "datum-plane"
  if (readRevolveFeatureParameters(candidate)) return "revolve"
  if (isFilletFeature(candidate) || isChamferFeature(candidate)) return "edge-treatment"
  if (isBoxFeature(candidate) || isCylinderFeature(candidate)) {
    return "primitive"
  }
  return "extrusion"
}

export function useFeaturePreview(
  snapshot: DocumentSnapshot | null,
  candidate: FeatureRecord | null,
  committedGeometry: readonly PreviewGeometryIdentity[],
  sessionActive = candidate !== null,
) {
  const [state, setState] = useState<FeaturePreviewState>({ status: "idle", meshes: [] })
  const sequenceRef = useRef(0)
  const sessionRef = useRef<PreviewSession | null>(null)
  const previewDocumentId = useMemo(
    () => (snapshot ? createBrowserDocumentId() : null),
    [snapshot?.id],
  )
  const previewSessionActive = snapshot !== null && sessionActive

  useEffect(() => {
    if (!previewDocumentId || !previewSessionActive) return
    const session = createDocumentWorkerSession(previewDocumentId, {
      retryRecoverableFailure: false,
    })
    sessionRef.current = session
    return () => {
      if (sessionRef.current === session) sessionRef.current = null
      session.terminate()
    }
  }, [previewDocumentId, previewSessionActive])

  useEffect(() => {
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    const session = sessionRef.current
    if (!snapshot || !candidate || !previewDocumentId || !session) {
      setState({ status: "idle", meshes: [] })
      return
    }
    const kind = featurePreviewKind(candidate)
    setState({ status: "loading", meshes: [], kind })
    void rebuildPreview(session, snapshot, candidate, previewDocumentId, committedGeometry).then(
      ({ candidateMesh, meshes }) => {
        if (sequenceRef.current === sequence) {
          setState({ status: "ready", meshes, kind, ...(candidateMesh ? { candidateMesh } : {}) })
        }
      },
      () => {
        if (sequenceRef.current === sequence) setState({ status: "error", meshes: [], kind })
      },
    )
    return () => {
      sequenceRef.current += 1
    }
  }, [candidate, committedGeometry, previewDocumentId, snapshot])

  return state
}
