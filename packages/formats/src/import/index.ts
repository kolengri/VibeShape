import { z } from "zod"
import { SafeZipError } from "../safe-zip"
import type { GeometryImportDiagnostic, GeometryImportInput } from "./contracts"
import {
  DEFAULT_IMPORT_LIMITS,
  GeometryImportError,
  type GeometryImportResult,
  geometryImportDiagnosticSchema,
  geometryImportInputSchema,
  type ImportLimits,
  type ParsedGeometryImport,
  parsedGeometryImportSchema,
  requireImport,
} from "./contracts"
import { parseDxfGeometry } from "./dxf"
import { parseStlGeometry } from "./stl"
import { parseSvgGeometry } from "./svg"
import { parseThreeMfGeometry } from "./three-mf"
import { validateParsedImport } from "./validate"

export type {
  GeometryImportDiagnostic,
  GeometryImportInput,
  GeometryImportResult,
  ImportedCurve,
  ImportedCurvePath,
  ImportedMesh,
  ImportedMeshNode,
  ImportLengthUnit,
  ImportLimits,
  ImportSvgUnit,
  ParsedGeometryImport,
} from "./contracts"
export {
  DEFAULT_IMPORT_LIMITS,
  geometryImportDiagnosticSchema,
  geometryImportInputSchema,
  importedCurvePathSchema,
  importedCurveSchema,
  importedMeshNodeSchema,
  importedMeshSchema,
  importLengthUnitSchema,
  importLimitsSchema,
  importSvgUnitSchema,
  importTransformSchema,
  parsedGeometryImportSchema,
} from "./contracts"

function parseSelectedFormat(
  input: GeometryImportInput,
  bytes: Uint8Array,
  limits: ImportLimits,
): ParsedGeometryImport | Promise<ParsedGeometryImport> {
  switch (input.format) {
    case "stl":
      return parseStlGeometry(bytes, input.units, limits)
    case "3mf":
      return parseThreeMfGeometry(bytes, limits)
    case "dxf":
      return parseDxfGeometry(bytes, input.units, limits)
    case "svg":
      return parseSvgGeometry(bytes, input.units, limits)
  }
}
function importDiagnostic(error: unknown): GeometryImportDiagnostic {
  if (error instanceof SafeZipError)
    return {
      code:
        error.code === "resource-limit"
          ? "resource-limit"
          : error.code === "unsafe-path"
            ? "unsafe-reference"
            : "invalid-format",
      message: error.message.slice(0, 4096),
    }
  if (error instanceof GeometryImportError)
    return geometryImportDiagnosticSchema.parse({
      code: error.code,
      message: error.message.slice(0, 4096),
      ...(error.source ? { source: error.source.slice(0, 4096) } : {}),
    })
  const message =
    error instanceof z.ZodError
      ? "Parsed geometry violates the bounded geometry contract."
      : error instanceof Error
        ? error.message.slice(0, 4096)
        : "The source format is invalid."
  return { code: "invalid-format", message: message || "The source format is invalid." }
}
/** Parsing is read-only; this inspection result confers no authored identities. */
export async function parseGeometryImport(value: unknown): Promise<GeometryImportResult> {
  const input = geometryImportInputSchema.safeParse(value)
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-input",
        message: "Import input does not match its bounded format contract.",
      },
    }
  const limits: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...input.data.limits }
  try {
    requireImport(
      input.data.bytes.byteLength <= limits.fileBytes,
      "resource-limit",
      "Import exceeds its file-size budget.",
    )
    const geometry = await parseSelectedFormat(input.data, input.data.bytes.slice(), limits)
    const parsed = parsedGeometryImportSchema.parse(geometry)
    validateParsedImport(parsed, limits)
    return { ok: true, geometry: parsed }
  } catch (error) {
    return { ok: false, diagnostic: importDiagnostic(error) }
  }
}
