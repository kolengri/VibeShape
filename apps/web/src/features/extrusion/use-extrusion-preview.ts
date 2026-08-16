import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import {
  type DocumentSnapshot,
  type FeatureRecord,
  documentSnapshotSchema,
} from "@vibeshape/domain"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import { useEffect, useMemo, useRef, useState } from "react"
import { createBrowserDocumentId } from "../../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../../document/document-worker-settings"
import { terminalFeatureIds } from "../part-design/terminal-features"

type PreviewSession = Pick<ReturnType<typeof createDocumentWorkerSession>, "rebuild" | "terminate">

type PreviewGeometryIdentity = Readonly<{
  contentHash: string
  featureId: string
}>

export type ExtrusionPreviewState = Readonly<{
  meshes: readonly ViewerMesh[]
  status: "idle" | "loading" | "ready" | "error"
}>

function previewFeatures(snapshot: DocumentSnapshot, candidate: FeatureRecord) {
  const index = snapshot.features.findIndex(({ id }) => id === candidate.id)
  if (index < 0) return [...snapshot.features, candidate]
  return snapshot.features.map((feature) => (feature.id === candidate.id ? candidate : feature))
}

export function createExtrusionPreviewDocument(
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

export function createExtrusionPreviewMeshes(
  document: DocumentSnapshot,
  geometry: readonly (PreviewGeometryIdentity &
    Readonly<{ geometry: { mesh: Omit<ViewerMesh, "featureId"> } }>)[],
  committedGeometry: readonly PreviewGeometryIdentity[],
) {
  const terminalIds = terminalFeatureIds(document.features)
  const committedHashes = new Map(
    committedGeometry.map(({ contentHash, featureId }) => [featureId, contentHash]),
  )
  return geometry
    .filter(({ featureId }) => terminalIds.has(featureId))
    .map(({ contentHash, featureId, geometry: result }) => ({
      ...result.mesh,
      featureId,
      appearance: committedHashes.get(featureId) === contentHash ? "model" : "preview",
    })) satisfies readonly ViewerMesh[]
}

async function rebuildPreview(
  session: PreviewSession,
  snapshot: DocumentSnapshot,
  candidate: FeatureRecord,
  previewDocumentId: DocumentSnapshot["id"],
  committedGeometry: readonly PreviewGeometryIdentity[],
) {
  const document = createExtrusionPreviewDocument(snapshot, candidate, previewDocumentId)
  const response = await session.rebuild({ document, mesh: PRODUCT_MESH_POLICY })
  const candidateEvaluation = response.evaluation.records.find(
    ({ featureId }) => featureId === candidate.id,
  )
  if (candidateEvaluation?.status !== "succeeded") {
    throw new Error("The extrusion preview could not be evaluated.")
  }
  return createExtrusionPreviewMeshes(document, response.geometry, committedGeometry)
}

export function useExtrusionPreview(
  snapshot: DocumentSnapshot | null,
  candidate: FeatureRecord | null,
  committedGeometry: readonly PreviewGeometryIdentity[],
) {
  const [state, setState] = useState<ExtrusionPreviewState>({ status: "idle", meshes: [] })
  const sequenceRef = useRef(0)
  const sessionRef = useRef<PreviewSession | null>(null)
  const previewDocumentId = useMemo(
    () => (snapshot ? createBrowserDocumentId() : null),
    [snapshot?.id],
  )

  useEffect(() => {
    if (!previewDocumentId) return
    const session = createDocumentWorkerSession(previewDocumentId, {
      retryRecoverableFailure: false,
    })
    sessionRef.current = session
    return () => {
      if (sessionRef.current === session) sessionRef.current = null
      session.terminate()
    }
  }, [previewDocumentId])

  useEffect(() => {
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    const session = sessionRef.current
    if (!snapshot || !candidate || !previewDocumentId || !session) {
      setState({ status: "idle", meshes: [] })
      return
    }
    setState({ status: "loading", meshes: [] })
    void rebuildPreview(session, snapshot, candidate, previewDocumentId, committedGeometry).then(
      (meshes) => {
        if (sequenceRef.current === sequence) setState({ status: "ready", meshes })
      },
      () => {
        if (sequenceRef.current === sequence) setState({ status: "error", meshes: [] })
      },
    )
  }, [candidate, committedGeometry, previewDocumentId, snapshot])

  return state
}
