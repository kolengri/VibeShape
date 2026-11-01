import {
  featureRecordSchema,
  type HistoryItemRef,
  insertFeatureInHistoryCommandSchema,
} from "@vibeshape/domain"
import { type CommandActor, commandActorSchema } from "@vibeshape/domain/commands"
import { documentV2MetadataCommandSchema } from "@vibeshape/domain/document-v2-command-schemas"
import { documentV4CommandSchema } from "@vibeshape/domain/document-v4-command-schemas"
import { draftIdSchema, featureIdSchema } from "@vibeshape/domain/identifiers"
import {
  importedFeatureParametersSchema,
  importedFeatureType,
} from "@vibeshape/domain/part-design-import"
import {
  meshImportFeatureParametersSchema,
  meshImportFeatureType,
} from "@vibeshape/domain/part-design-mesh-import"
import {
  sourceAssetIdSchema,
  sourceAssetOutputIdSchema,
  sourceAssetSchema,
} from "@vibeshape/domain/source-assets"
import {
  importedSourceContentSchema,
  inspectMeshImportInputSchema,
  type MeshImportInspection,
  meshImportInspectionSchema,
  type SourceImportInspection,
  sourceImportInspectionSchema,
} from "@vibeshape/protocol"
import { browserAuthoredUuid } from "../../document/authored-document-session"
import { authorF3dRecords } from "./f3d-authoring"
import { prepareF3dSource } from "./f3d-parser-client"
import { sourceAuthorityUpgradeCommands } from "./source-authority-upgrade"

export const importSourceUnits = [
  "micrometer",
  "millimeter",
  "centimeter",
  "meter",
  "inch",
  "foot",
] as const
export type ImportSourceUnit = (typeof importSourceUnits)[number]
export const importSourceUnitSchema =
  sourceAssetSchema.shape.normalization.shape.sourceUnit.extract(importSourceUnits)
const scales: Record<ImportSourceUnit, number> = {
  micrometer: 0.001,
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
  foot: 304.8,
}
export class ImportFileError extends Error {
  constructor(readonly code: "format" | "budget" | "filename" | "units") {
    super(code)
  }
}
export type ImportFile = Pick<File, "name" | "size" | "arrayBuffer">
export type PreparedImportSource = Awaited<ReturnType<typeof readImportSource>>
export function importFormat(filename: string): "step" | "brep" | "stl" | "3mf" | "f3d" | null {
  const extension = filename.toLowerCase().split(".").at(-1)
  if (extension === "step" || extension === "stp") return "step"
  return extension === "brep" || extension === "stl" || extension === "3mf" || extension === "f3d"
    ? extension
    : null
}
export function hasImportSourceUnitIntent(file: ImportFile | null, unit: ImportSourceUnit | null) {
  return file !== null && (["3mf", "f3d"].includes(importFormat(file.name) ?? "") || unit !== null)
}
const meshUnits: Record<ImportSourceUnit, "mm" | "cm" | "m" | "in" | "ft" | "um"> = {
  micrometer: "um",
  millimeter: "mm",
  centimeter: "cm",
  meter: "m",
  inch: "in",
  foot: "ft",
}
function requireImportFile(file: ImportFile, unit: ImportSourceUnit | null) {
  const format = importFormat(file.name)
  if (!format) throw new ImportFileError("format")
  if ((format === "3mf" || format === "f3d") !== (unit === null)) throw new ImportFileError("units")
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new ImportFileError("budget")
  if (format === "f3d" && file.size > 64 * 1024 * 1024) throw new ImportFileError("budget")
  const filename = sourceAssetSchema.shape.filename.safeParse(file.name)
  if (!filename.success) throw new ImportFileError("filename")
  return { format, filename: filename.data }
}
async function sha256(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
function exactSourceMetadata(
  format: "step" | "brep" | "f3d",
  bytes: Uint8Array,
  digest: string,
  unit: ImportSourceUnit | null,
) {
  return importedSourceContentSchema.parse({
    digest,
    byteLength: bytes.byteLength,
    format: format === "f3d" ? "step" : format,
    normalization: {
      sourceUnit: unit ?? "millimeter",
      scaleToMillimeters: unit ? scales[unit] : 1,
      normalizedUnit: "millimeter",
    },
    unitPolicy: format === "brep" ? "brep-source-normalized" : "step-system-mm",
    readerPolicyVersion: 1,
  })
}
export async function readImportSource(file: ImportFile, unit: ImportSourceUnit | null) {
  const { format, filename } = requireImportFile(file, unit)
  const selectedBytes = new Uint8Array(await file.arrayBuffer())
  if (selectedBytes.byteLength !== file.size) throw new ImportFileError("budget")
  const originalDigest = await sha256(selectedBytes)
  const f3d = format === "f3d" ? await prepareF3dSource(selectedBytes) : undefined
  const bytes = f3d ? new TextEncoder().encode(f3d.step) : selectedBytes
  const digest = f3d ? await sha256(bytes) : originalDigest
  const common = { bytes, filename }
  if (format === "stl" || format === "3mf")
    return {
      ...common,
      representation: "triangle-mesh" as const,
      digest,
      input: inspectMeshImportInputSchema.parse({
        format,
        bytes,
        ...(unit === null ? {} : { units: meshUnits[unit] }),
      }),
    }
  return {
    ...common,
    representation: "exact-solid" as const,
    source: exactSourceMetadata(format, bytes, digest, unit),
    f3d,
    originalBytes: format === "f3d" ? selectedBytes : undefined,
    originalByteLength: selectedBytes.byteLength,
    originalDigest,
  }
}
export type ImportDocumentContext = Readonly<{
  documentId: string
  revision: number
  authorityVersion: 2 | 3 | 4 | 5 | 6
  historyAfter: HistoryItemRef | null
  hiddenPartIds?: readonly string[]
}>
export function importContextIsStale(
  current: ImportDocumentContext,
  inspected: ImportDocumentContext | undefined,
) {
  return (
    inspected !== undefined &&
    (inspected.documentId !== current.documentId || inspected.revision !== current.revision)
  )
}
function capturedImportFeature(
  prepared: PreparedImportSource,
  inspection: SourceImportInspection | MeshImportInspection,
  label: string,
  uuid: () => string,
) {
  const assetId = sourceAssetIdSchema.parse(uuid())
  const capture =
    prepared.representation === "exact-solid"
      ? captureExactSource(prepared, sourceImportInspectionSchema.parse(inspection), assetId, uuid)
      : captureMeshSource(prepared, meshImportInspectionSchema.parse(inspection), assetId, uuid)
  const asset = sourceAssetSchema.parse({
    id: assetId,
    ...capture.metadata,
    filename: prepared.filename,
    representation: prepared.representation,
    outputs: capture.outputs,
  })
  const feature = featureRecordSchema.parse({
    schemaVersion: 0,
    id: featureIdSchema.parse(uuid()),
    type: capture.type,
    parameters: capture.parameters,
    dependencies: [],
    references: [],
    suppressed: false,
    label,
  })
  return { asset, feature }
}
function captureExactSource(
  prepared: Extract<PreparedImportSource, { representation: "exact-solid" }>,
  inspection: SourceImportInspection,
  assetId: string,
  uuid: () => string,
) {
  const outputs = inspection.outputs.map(({ signature }) => ({
    outputId: sourceAssetOutputIdSchema.parse(uuid()),
    signature,
  }))
  const { digest, byteLength, format, normalization } = prepared.source
  return {
    metadata: { digest, byteLength, format, normalization },
    outputs: outputs.map(({ outputId }) => outputId),
    type: importedFeatureType.type,
    parameters: importedFeatureParametersSchema.parse({
      sourceAssetId: assetId,
      source: prepared.source,
      outputs,
      matchingPolicyVersion: 1,
    }),
  }
}
function captureMeshSource(
  prepared: Extract<PreparedImportSource, { representation: "triangle-mesh" }>,
  inspection: MeshImportInspection,
  assetId: string,
  uuid: () => string,
) {
  const outputs = inspection.outputs.map(({ nodeKey }) => ({
    outputId: sourceAssetOutputIdSchema.parse(uuid()),
    nodeKey,
  }))
  const metadata = {
    digest: prepared.digest,
    byteLength: prepared.bytes.byteLength,
    format: prepared.input.format,
    normalization: inspection.normalization,
  }
  return {
    metadata,
    outputs: outputs.map(({ outputId }) => outputId),
    type: meshImportFeatureType.type,
    parameters: meshImportFeatureParametersSchema.parse({
      sourceAssetId: assetId,
      source: { ...metadata, parserPolicyVersion: 1 },
      outputs,
    }),
  }
}
export function createImportTransaction(
  context: ImportDocumentContext,
  prepared: PreparedImportSource,
  inspection: SourceImportInspection | MeshImportInspection,
  label: string,
  uuid = browserAuthoredUuid,
  actor: CommandActor = { type: "user", userId: null },
  hideSourcePartId?: string,
) {
  const authoredActor = commandActorSchema.parse(actor)
  const { asset, feature } = capturedImportFeature(prepared, inspection, label, uuid)
  const issuedAt = new Date().toISOString()
  let revision = context.revision
  const envelope = () => ({
    commandId: uuid(),
    documentId: context.documentId,
    baseRevision: revision++,
    issuedAt,
    actor: authoredActor,
  })
  const upgrades = sourceAuthorityUpgradeCommands(context.authorityVersion, envelope)
  const mapped =
    prepared.representation === "exact-solid" && prepared.f3d
      ? authorF3dRecords(
          prepared.f3d,
          context,
          sourceImportInspectionSchema.parse(inspection),
          envelope,
          uuid,
        )
      : null
  const committedFeature = mapped?.editableFeature ?? feature
  const commands = [
    ...upgrades,
    ...(mapped?.commands ?? []),
    documentV4CommandSchema.parse({
      ...envelope(),
      schemaVersion: 4,
      kind: "org.vibeshape.document.add-source-assets",
      payload: { assets: [asset] },
    }),
    ...(hideSourcePartId && !context.hiddenPartIds?.includes(hideSourcePartId)
      ? [
          documentV2MetadataCommandSchema.parse({
            ...envelope(),
            schemaVersion: 2,
            kind: "org.vibeshape.document.metadata-command",
            payload: { kind: "part.set-visibility", partId: hideSourcePartId, visible: false },
          }),
        ]
      : []),
    insertFeatureInHistoryCommandSchema.parse({
      ...envelope(),
      schemaVersion: 1,
      kind: "org.vibeshape.history.insert-feature",
      payload: {
        feature: committedFeature,
        historyAfter: mapped?.historyAfter ?? context.historyAfter,
      },
    }),
  ]
  return {
    transactionId: draftIdSchema.parse(uuid()),
    commands,
    assetBlobs: [{ digest: asset.digest, bytes: Uint8Array.from(prepared.bytes) }],
  }
}
