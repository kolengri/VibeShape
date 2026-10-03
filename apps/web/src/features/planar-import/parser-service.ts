import { parseGeometryImport } from "@vibeshape/formats/import"
import { preparePlanarImport } from "@vibeshape/formats/planar-import-transform"
import { planarParserRequestSchema, planarParserResponseSchema } from "./parser-contract"

/** Inspection allocates no authored identities and holds no document or persistence authority. */
export async function inspectPlanarRequest(value: unknown) {
  const request = planarParserRequestSchema.safeParse(value)
  if (!request.success)
    return planarParserResponseSchema.parse({
      schemaVersion: 0,
      ok: false,
      diagnostic: {
        code: "invalid-input",
        message: "The planar import request exceeds its supported input contract.",
      },
    })
  const parsed = await parseGeometryImport(request.data.input)
  const result = parsed.ok ? preparePlanarImport(parsed.geometry) : parsed
  if (result.ok && result.prepared.paths.length > 1024)
    return planarParserResponseSchema.parse({
      schemaVersion: 0,
      ok: false,
      diagnostic: {
        code: "resource-limit",
        message: "The source exceeds the 1024 captured path limit.",
      },
    })
  return planarParserResponseSchema.parse({ schemaVersion: 0, ...result })
}
