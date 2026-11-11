import {
  authoredPartExportBodies,
  resolveAuthoredParts,
} from "@vibeshape/application/authored-parts"
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

const staleReport: PersistentDocumentSessionDiagnostic = {
  code: "export-failed",
  message:
    "The active project changed before its geometry was current. Prepare the current revision again.",
  retryable: true,
  sourceCode: "stale-revision",
}

/**
 * Exports and drawings use the worker's last successful rebuild, so the report must describe the
 * captured revision and that revision's rebuild must have succeeded. A lagging report is a
 * retryable race; a failed rebuild of the captured revision is not retried.
 */
export function currentGeometryFailure(
  report: PersistentDocumentSessionReport,
  revision: number,
): PersistentDocumentSessionDiagnostic | null {
  if (report.snapshot.revision !== revision) return staleReport
  if (!report.rebuild.ok)
    return { ...report.rebuild.diagnostic, retryable: false, sourceCode: "rebuild-failed" }
  return null
}

/** Geometry a worker returns must come from the captured revision, never an earlier rebuild. */
export function producedRevisionFailure(
  produced: number,
  revision: number,
): PersistentDocumentSessionDiagnostic | null {
  return produced === revision ? null : staleReport
}

/**
 * Why a requested Part has no export bodies. While a rebuild runs after a commit the report lags
 * the authority and parts cannot resolve: a retryable revision race. Once they resolve, a missing
 * or bodiless Part is deterministic and must not be retried.
 */
function unavailablePart(
  authority: DocumentAuthoritySnapshot | null,
  report: PersistentDocumentSessionReport,
): PersistentDocumentSessionDiagnostic {
  const current =
    authority && authority.schemaVersion !== 1 && resolveAuthoredParts(authority, report)
  return current
    ? {
        code: "export-failed",
        message: "The requested part does not exist or has no current body.",
        retryable: false,
        sourceCode: "part-not-found",
      }
    : {
        code: "export-failed",
        message: "The requested parts do not have current exportable geometry.",
        retryable: true,
        sourceCode: "stale-revision",
      }
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
  if (bodies === null) return { ok: false, diagnostic: unavailablePart(authority, report) }
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
