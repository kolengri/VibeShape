import { serializedQueryBytes } from "./query-byte-budget"
import {
  surfaceTextureCommitViewSchema,
  surfaceTextureOperationSchema,
  surfaceTexturesViewSchema,
} from "./surface-texture-tools"

/** Both transports bind texture receipts to the paired document and requested intent. */
export function surfaceTextureResultContextMatches(
  input: unknown,
  result: { ok: boolean; value?: unknown },
  documentId?: string,
): boolean | null {
  const operation = surfaceTextureOperationSchema.safeParse(input)
  if (!operation.success) return null
  if (serializedQueryBytes(result) > 128 * 1024) return false
  if (!result.ok) return true
  const { tool, arguments: args } = operation.data
  if (tool === "model_surface_textures") {
    const view = surfaceTexturesViewSchema.parse(result.value)
    return (
      (documentId === undefined || view.documentId === documentId) &&
      view.revision === args.revision &&
      view.featureId === args.featureId
    )
  }
  const view = surfaceTextureCommitViewSchema.parse(result.value)
  const requested =
    tool === "create_surface_texture"
      ? "create"
      : tool === "update_surface_texture"
        ? "update"
        : "remove"
  return (
    (documentId === undefined || view.documentId === documentId) &&
    view.baseRevision === args.baseRevision &&
    view.layerId === args.layerId &&
    view.operation === requested &&
    (tool !== "create_surface_texture" || view.featureId === args.featureId)
  )
}
