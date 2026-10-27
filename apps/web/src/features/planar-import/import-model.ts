import { insertSketchInHistoryCommandSchema } from "@vibeshape/domain"
import { type CommandActor, commandActorSchema } from "@vibeshape/domain/commands"
import { documentV4AssetsCommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import { draftIdSchema, sketchEntityIdSchema, sketchIdSchema } from "@vibeshape/domain/identifiers"
import { authorPreparedPlanarImport } from "@vibeshape/domain/planar-import-authoring"
import { MAX_SKETCH_SOURCE_BYTES } from "@vibeshape/domain/sketch-source-import"
import { attachSketchSourceImport } from "@vibeshape/domain/sketch-source-import-edit"
import {
  sourceAssetIdSchema,
  sourceAssetOutputIdSchema,
  sourceAssetSchema,
} from "@vibeshape/domain/source-assets"
import { importSvgUnitSchema } from "@vibeshape/formats/import"
import { z } from "zod"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import type { ImportDocumentContext } from "../import/import-model"
import { sourceAuthorityUpgradeCommands } from "../import/source-authority-upgrade"
import {
  type PlanarInspection,
  planarParserRequestSchema,
  planarParserResponseSchema,
} from "./parser-contract"

export const planarUnitSchema = importSvgUnitSchema.or(z.literal("declared"))
export type PlanarUnit = z.infer<typeof planarUnitSchema>
export const planarUnits = ["declared", "px", "mm", "cm", "m", "in", "ft", "um"] as const
export const planarPlaneSchema = z.enum(["xy", "xz", "yz"])
export function planarFormat(filename: string) {
  const format = filename.toLowerCase().split(".").at(-1)
  return format === "svg" || format === "dxf" ? format : null
}
export class PlanarFileError extends Error {
  constructor(readonly code: "format" | "budget" | "filename" | "units") {
    super(code)
  }
}
export async function readPlanarSource(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  unit: PlanarUnit | null,
) {
  const format = planarFormat(file.name)
  if (!format) throw new PlanarFileError("format")
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_SKETCH_SOURCE_BYTES)
    throw new PlanarFileError("budget")
  const filename = sourceAssetSchema.shape.filename.safeParse(file.name)
  if (!filename.success) throw new PlanarFileError("filename")
  if (!unit || (format === "svg" && unit === "declared") || (format === "dxf" && unit === "px"))
    throw new PlanarFileError("units")
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new PlanarFileError("budget")
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  const digest = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
  const request = planarParserRequestSchema.parse({
    schemaVersion: 0,
    input: { format, bytes, ...(unit === "declared" ? {} : { units: unit }) },
  })
  return { filename: filename.data, digest, bytes, input: request.input }
}
export type PlanarSource = Awaited<ReturnType<typeof readPlanarSource>>
const sourceUnits = {
  mm: "millimeter",
  cm: "centimeter",
  m: "meter",
  in: "inch",
  ft: "foot",
  um: "micrometer",
  px: "unitless",
} as const
export function createPlanarImportTransaction(
  context: ImportDocumentContext,
  source: PlanarSource,
  inspected: PlanarInspection,
  plane: z.infer<typeof planarPlaneSchema>,
  label: string,
  uuid = browserAuthoredUuid,
  actor: CommandActor = { type: "user", userId: null },
) {
  const authoredActor = commandActorSchema.parse(actor)
  const inspection = planarParserResponseSchema.parse(inspected)
  if (!inspection.ok || inspection.prepared.format !== source.input.format)
    throw new Error("Inspection must belong to the selected source format.")
  const unit = importSvgUnitSchema.parse(inspection.prepared.units.sourceUnit)
  const asset = sourceAssetSchema.parse({
    id: sourceAssetIdSchema.parse(uuid()),
    digest: source.digest,
    byteLength: source.bytes.byteLength,
    filename: source.filename,
    format: source.input.format,
    representation: "sketch-curves",
    normalization: {
      sourceUnit: sourceUnits[unit],
      scaleToMillimeters: inspection.prepared.units.millimetersPerUnit,
      normalizedUnit: "millimeter",
    },
    outputs: inspection.prepared.paths.map(() => sourceAssetOutputIdSchema.parse(uuid())),
  })
  const authored = authorPreparedPlanarImport(inspection.prepared, {
    id: sketchIdSchema.parse(uuid()),
    label,
    plane: planarPlaneSchema.parse(plane),
    createEntityId: () => sketchEntityIdSchema.parse(uuid()),
  })
  const sketch = attachSketchSourceImport(authored.sketch, asset, authored.paths)
  const issuedAt = new Date().toISOString()
  let revision = context.revision
  const envelope = () => ({
    documentId: context.documentId,
    commandId: uuid(),
    baseRevision: revision++,
    issuedAt,
    actor: authoredActor,
  })
  const commands = [
    ...sourceAuthorityUpgradeCommands(context.authorityVersion, envelope),
    documentV4AssetsCommandSchema.parse({
      ...envelope(),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
    insertSketchInHistoryCommandSchema.parse({
      ...envelope(),
      schemaVersion: 1,
      kind: "org.vibeshape.history.insert-sketch",
      payload: { sketch, historyAfter: context.historyAfter },
    }),
  ]
  return {
    transactionId: draftIdSchema.parse(uuid()),
    commands,
    assetBlobs: [{ digest: source.digest, bytes: Uint8Array.from(source.bytes) }],
  }
}
