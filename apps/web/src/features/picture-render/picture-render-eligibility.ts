import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"

export type PictureRepresentationIssue = "assembly" | "relief"

/** UI and automation must not silently substitute undecorated or unplaced geometry. */
export function pictureRepresentationIssue(
  authority: DocumentAuthoritySnapshot | DocumentSnapshot,
): PictureRepresentationIssue | null {
  if ("assembly" in authority && authority.assembly.instances.length) return "assembly"
  if ("surfaceTextures" in authority && authority.surfaceTextures.some((layer) => layer.enabled))
    return "relief"
  return null
}
