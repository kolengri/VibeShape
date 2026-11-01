import {
  type ResolvedAuthoredPart,
  resolveAuthoredParts,
} from "@vibeshape/application/authored-parts"
import type { ModelBodyGeometry } from "@vibeshape/application/model-bodies"
import type { PersistentDocumentSessionReport } from "@vibeshape/application/persistent-document-session"
import { readDatumPlaneFeatureParameters } from "@vibeshape/domain"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import { appearancePresets, type PartAppearanceValue } from "@vibeshape/domain/part-appearance"
import type { DocumentWorkerResponse } from "@vibeshape/protocol"
import { terminalModelBodies } from "../features/part-design/model-bodies"
import { pictureRepresentationIssue } from "../features/picture-render/picture-render-eligibility"
import { authoredBodyKey, authoredBodyKeys } from "../shell/authored-tree-state"
import { BinaryExportPreparationError } from "./binary-export-session"

export type PictureRenderSource = {
  snapshot: DocumentSnapshot
  authority: DocumentAuthoritySnapshot
  report: PersistentDocumentSessionReport
}
type Rebuild = Extract<DocumentWorkerResponse, { type: "documentRebuilt" }>
export function pictureSourceMatches(
  source: PictureRenderSource | null,
  documentId: string,
  revision: number,
): source is PictureRenderSource {
  if (!source) return false
  return (
    source.snapshot.id === documentId &&
    source.snapshot.revision === revision &&
    source.authority.id === documentId &&
    source.authority.revision === revision
  )
}
export function assertPictureRepresentation(authority: DocumentAuthoritySnapshot) {
  const issue = pictureRepresentationIssue(authority)
  if (issue === "assembly")
    throw new BinaryExportPreparationError(
      "picture-representation-unsupported",
      "Picture rendering does not support assembly occurrence placement.",
    )
  if (issue === "relief")
    throw new BinaryExportPreparationError(
      "picture-representation-unsupported",
      "Picture rendering does not support authored surface relief.",
    )
}
function appearanceMesh(
  body: ModelBodyGeometry,
  parts: readonly ResolvedAuthoredPart[],
  appearances: ReadonlyMap<string, PartAppearanceValue>,
) {
  const part = parts.find((p) => p.body && authoredBodyKey(p.body) === authoredBodyKey(body))
  const appearance = part && appearances.get(part.part.id)
  return {
    ...body.mesh,
    featureId: body.featureId,
    ...(body.outputRole === undefined ? {} : { outputRole: body.outputRole }),
    ...(appearance?.presetId ? { material: appearancePresets[appearance.presetId] } : {}),
    ...(appearance?.color ? { color: appearance.color } : {}),
  }
}
/** Uses the same authored Part/body binding and appearance policy as the committed viewport. */
export function projectPictureMeshes(source: PictureRenderSource, rebuilt: Rebuild) {
  const { snapshot, authority } = source
  const bodies = terminalModelBodies(snapshot.features, rebuilt)
  if (!bodies) return null
  const parts =
    authority.schemaVersion === 1
      ? []
      : resolveAuthoredParts(authority, {
          ...source.report,
          snapshot,
          rebuild: { ok: true, response: rebuilt },
        })
  if (!parts) return null
  const hidden =
    authority.schemaVersion === 1 ? new Set<string>() : authoredBodyKeys(authority, true)
  const appearances = new Map(
    authority.schemaVersion === 6
      ? authority.partAppearances.map((item) => [item.partId, item.appearance])
      : [],
  )
  const datum = new Set(
    snapshot.features.filter((f) => readDatumPlaneFeatureParameters(f)).map((f) => f.id),
  )
  return bodies
    .filter(
      ({ geometry }) => !datum.has(geometry.featureId) && !hidden.has(authoredBodyKey(geometry)),
    )
    .map(({ geometry }) => appearanceMesh(geometry, parts, appearances))
}
