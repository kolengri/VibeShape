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
  | "subtract"

export type FeaturePreviewState = Readonly<{
  candidateMesh?: ViewerMesh
  kind?: FeaturePreviewKind
  meshes: readonly ViewerMesh[]
  status: "idle" | "loading" | "ready" | "error"
  diagnostic?: string
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
    const diagnostic =
      candidateEvaluation?.status === "failed" && readLoftFeatureParametersV3(candidate)
        ? candidateEvaluation.diagnostics.find(({ values }) => typeof values.message === "string")
            ?.values.message
        : null
    if (typeof diagnostic === "string") throw new Error(diagnostic)
    throw new Error("The feature preview could not be evaluated.")
  }
  return {
    candidateMesh: createFeaturePreviewCandidateMesh(response.geometry, candidate.id),
    meshes: createFeaturePreviewMeshes(document, response, committedGeometry),
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
) {
  if (!snapshot || !candidate || !response) return null
  if (!matchesCommittedRevision(snapshot, response)) return null
  const saved = snapshot.features.find(({ id }) => id === candidate.id)
  if (!saved || canonicalJson(saved) !== canonicalJson(candidate)) return null
  if (!currentFeatureGeometry(response, candidate.id)) return null
  const candidateMesh = createFeaturePreviewCandidateMesh(response.geometry, candidate.id)
  return {
    status: "ready" as const,
    kind: featurePreviewKind(candidate),
    ...(candidateMesh ? { candidateMesh } : {}),
    meshes: createFeaturePreviewMeshes(snapshot, response, response.geometry),
  }
}

export function useFeaturePreview(
  snapshot: DocumentSnapshot | null,
  candidate: FeatureRecord | null,
  committedGeometry: readonly PreviewGeometryIdentity[],
  sessionActive = candidate !== null,
  committedResponse: Extract<DocumentWorkerResponse, { type: "documentRebuilt" }> | null = null,
) {
  const [state, setState] = useState<FeaturePreviewState>({ status: "idle", meshes: [] })
  const sequenceRef = useRef(0)
  const sessionRef = useRef<PreviewSession | null>(null)
  const previewDocumentId = useMemo(
    () => (snapshot ? createBrowserDocumentId() : null),
    [snapshot?.id],
  )
  const candidateKey = canonicalJson(candidate)
  const cached = useMemo(
    () => committedPreview(snapshot, candidate, committedResponse),
    [snapshot, candidateKey, committedResponse],
  )
  const previewSessionActive = snapshot !== null && sessionActive && cached === null

  useEffect(() => {
    if (!previewDocumentId || !previewSessionActive) return
    const session = createDocumentWorkerSession(previewDocumentId, {
      retryRecoverableFailure: false,
      materializeSourceAssets: materializeActiveDocumentSourceAssets,
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
    if (cached) {
      setState(cached)
      return
    }
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
      (error: unknown) => {
        if (sequenceRef.current === sequence)
          setState({
            status: "error",
            meshes: [],
            kind,
            ...(readLoftFeatureParametersV3(candidate) && isError(error)
              ? { diagnostic: error.message }
              : {}),
          })
      },
    )
    return () => {
      sequenceRef.current += 1
    }
  }, [candidateKey, cached, committedGeometry, previewDocumentId, snapshot])

  return state
}
