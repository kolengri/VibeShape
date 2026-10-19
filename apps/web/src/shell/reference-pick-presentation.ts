import type { FeatureEvaluatedResponse } from "@vibeshape/protocol"
import type { ViewerMesh } from "@vibeshape/viewer/three-viewport"
import type { DocumentControllerState } from "../document/document-controller"
import type { PartVisibilityOverrides } from "../editor-session/part-visibility"
import { authoredBodyKey, authoredBodyKeys, currentAuthoredSnapshot } from "./authored-tree-state"
import { viewerMeshes } from "./geometry-viewport"
import type { ReferencePickCandidate } from "./reference-picking"

export function currentReferenceRebuild(controller: DocumentControllerState) {
  const report = controller.report
  return report?.rebuild.ok &&
    report.rebuild.response.documentId === report.snapshot.id &&
    report.rebuild.response.revision === report.snapshot.revision
    ? report.rebuild.response
    : null
}

export function referencePickExcludedFeatures(
  controller: DocumentControllerState,
  editingFeatureId: string | null,
): ReadonlySet<string> {
  const excluded = new Set<string>(editingFeatureId ? [editingFeatureId] : [])
  const features = controller.report?.snapshot.features ?? []
  let previousSize = -1
  while (previousSize !== excluded.size) {
    previousSize = excluded.size
    for (const feature of features)
      if (feature.dependencies.some((id) => excluded.has(id))) excluded.add(feature.id)
  }
  return excluded
}

export function referencePickHiddenBodies(
  controller: DocumentControllerState,
  partVisibilityOverrides?: PartVisibilityOverrides,
): ReadonlySet<string> {
  const authority = currentAuthoredSnapshot(controller)
  return authority ? authoredBodyKeys(authority, true, partVisibilityOverrides) : new Set<string>()
}

function validSolid(
  geometry: Pick<FeatureEvaluatedResponse, "shape" | "representation">,
  wholeProducer = false,
) {
  return (
    geometry.shape.valid &&
    (wholeProducer ? geometry.shape.solidCount >= 1 : geometry.shape.solidCount === 1) &&
    geometry.shape.volume > 0 &&
    geometry.representation !== "triangle-mesh"
  )
}

type ReferenceRebuild = NonNullable<ReturnType<typeof currentReferenceRebuild>>
type ReferenceGeometry = ReferenceRebuild["geometry"][number]["geometry"]
type GeometryBody = NonNullable<FeatureEvaluatedResponse["bodies"]>[number]
type ExactReferenceCandidate = Exclude<ReferencePickCandidate, { kind: "producer" }>

function currentCandidateGeometry(candidate: ReferencePickCandidate, rebuild: ReferenceRebuild) {
  const records = rebuild.geometry.filter(({ featureId }) => featureId === candidate.featureId)
  const record = records.length === 1 ? records[0] : undefined
  if (!record) return null
  const evaluations =
    rebuild.evaluation?.records.filter(({ featureId }) => featureId === candidate.featureId) ?? []
  const evaluation = evaluations.length === 1 ? evaluations[0] : undefined
  if (evaluation?.status !== "succeeded" || evaluation.contentHash !== record.contentHash)
    return null
  return record.geometry
}

function viewerBodyMesh(featureId: string, body: GeometryBody): ViewerMesh {
  return { featureId, outputRole: body.outputRole, ...body.mesh }
}

function producerMeshes(featureId: string, geometry: ReferenceGeometry): readonly ViewerMesh[] {
  const bodies = geometry.bodies ?? []
  if (!validSolid(geometry, true) || !bodies.every((body) => validSolid(body))) return []
  return bodies.length > 0
    ? bodies.map((body) => viewerBodyMesh(featureId, body))
    : [{ featureId, ...geometry.mesh }]
}

function exactCandidateBody(candidate: ExactReferenceCandidate, geometry: ReferenceGeometry) {
  const bodies = geometry.bodies ?? []
  const matches = bodies.filter(({ outputRole }) => outputRole === candidate.outputRole)
  const body = matches.length === 1 ? matches[0] : undefined
  if (!body || !validSolid(body)) return null
  if (
    candidate.kind === "face" &&
    body.topologyCandidates.filter(
      (face) => face.kind === "face" && face.meshFaceId === candidate.meshFaceId,
    ).length !== 1
  )
    return null
  return body
}

function candidateMeshes(
  candidate: ReferencePickCandidate,
  rebuild: ReferenceRebuild,
): readonly ViewerMesh[] {
  const geometry = currentCandidateGeometry(candidate, rebuild)
  if (!geometry) return []
  if (candidate.kind === "producer") return producerMeshes(candidate.featureId, geometry)
  const body = exactCandidateBody(candidate, geometry)
  return body ? [viewerBodyMesh(candidate.featureId, body)] : []
}

export function referencePickPresentation({
  candidates,
  controller,
  excludedFeatureIds,
  hiddenFeatureIds,
  partVisibilityOverrides,
}: Readonly<{
  candidates: readonly ReferencePickCandidate[]
  controller: DocumentControllerState
  excludedFeatureIds: ReadonlySet<string>
  hiddenFeatureIds: readonly string[]
  partVisibilityOverrides?: PartVisibilityOverrides | undefined
}>) {
  const rebuild = currentReferenceRebuild(controller)
  const hiddenBodies = referencePickHiddenBodies(controller, partVisibilityOverrides)
  const hiddenFeatures = new Set([...hiddenFeatureIds, ...excludedFeatureIds])
  const visible = (mesh: ViewerMesh) =>
    !hiddenFeatures.has(mesh.featureId) && !hiddenBodies.has(authoredBodyKey(mesh))
  const meshes = new Map(
    viewerMeshes(controller, hiddenFeatureIds, [], partVisibilityOverrides)
      .filter(visible)
      .map((mesh) => [authoredBodyKey(mesh), mesh]),
  )
  const available = rebuild
    ? candidates.filter((candidate) => {
        const features =
          controller.report?.snapshot.features.filter(({ id }) => id === candidate.featureId) ?? []
        if (features.length !== 1 || features[0]?.suppressed) return false
        const sources = candidateMeshes(candidate, rebuild)
        // A legacy producer is indivisible; a hidden sibling must not be bypassed.
        if (sources.length === 0 || !sources.every(visible)) return false
        for (const mesh of sources) meshes.set(authoredBodyKey(mesh), mesh)
        return true
      })
    : []
  return { candidates: available, meshes: [...meshes.values()] }
}
