import { authoredPartExportBodies } from "@vibeshape/application/authored-parts"
import type {
  PersistentDocumentSessionDiagnostic,
  PersistentDocumentSessionReport,
} from "@vibeshape/application/persistent-document-session"
import { resolveSurfaceTextureExportLayers } from "@vibeshape/application/surface-textures"
import type { DocumentAuthoritySnapshot } from "@vibeshape/domain/document-v2"
import type {
  DocumentExportOptions,
  GeometryExportFormat,
  MeshExportQuality,
} from "@vibeshape/protocol"

type GeometryExportPlan =
  | Readonly<{ ok: true; options: DocumentExportOptions }>
  | Readonly<{ ok: false; diagnostic: PersistentDocumentSessionDiagnostic }>

function selectedBodies(
  authority: DocumentAuthoritySnapshot | null,
  report: PersistentDocumentSessionReport,
  partId?: string,
) {
  if (authority && authority.schemaVersion !== 1)
    return authoredPartExportBodies(authority, report, partId)
  return partId ? null : undefined
}

/** Authoritative layers are resolved at the same captured revision as the exact export bodies. */
export function prepareDocumentGeometryExport(
  authority: DocumentAuthoritySnapshot | null,
  report: PersistentDocumentSessionReport,
  format: GeometryExportFormat,
  partId?: string,
  meshQuality?: MeshExportQuality,
): GeometryExportPlan {
  const bodies = selectedBodies(authority, report, partId)
  if (bodies === null)
    return {
      ok: false,
      diagnostic: {
        code: "export-failed",
        message: "The requested parts do not have current exportable geometry.",
        retryable: true,
        sourceCode: "stale-revision",
      },
    }
  try {
    const surfaceTextures =
      authority &&
      (authority.schemaVersion === 3 ||
        authority.schemaVersion === 4 ||
        authority.schemaVersion === 5 ||
        authority.schemaVersion === 6) &&
      format !== "step"
        ? resolveSurfaceTextureExportLayers(report, authority.surfaceTextures, bodies)
        : []
    return {
      ok: true,
      options: {
        ...(bodies?.length ? { bodies } : {}),
        ...(surfaceTextures.length ? { surfaceTextures } : {}),
        ...(format !== "step" && meshQuality ? { meshQuality } : {}),
      },
    }
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: "export-failed",
        message:
          error instanceof Error
            ? error.message
            : "Surface texture export targets are unavailable.",
        retryable: false,
        sourceCode: "texture-target-unresolved",
      },
    }
  }
}
