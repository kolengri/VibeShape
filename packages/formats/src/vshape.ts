import {
  type DocumentAuthorityEvent,
  type DocumentAuthoritySnapshot,
  type DocumentAuthorityV2Event,
  type DocumentAuthorityV2Snapshot,
  type DocumentSnapshotV2,
  type DocumentSnapshotV3,
  type DocumentSnapshotV4,
  documentAuthorityEventSchema,
  documentAuthoritySnapshotSchema,
  documentAuthorityV2EventSchema,
  documentAuthorityV2SnapshotSchema,
  documentSnapshotV2Schema,
  documentSnapshotV3Schema,
  documentSnapshotV4Schema,
  documentSourceAssetClosure,
  projectDocumentSnapshotV4ToV3,
  replayDocumentAuthorityEvents,
  replayVersionedDocumentEvents,
  type SourceAssetBlob,
  sourceAssetBlobSchema,
  sourceAssetDigestSchema,
  type VersionedDocumentEvent,
  versionedDocumentEventSchema,
} from "@vibeshape/domain"
import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type DocumentEvent,
  documentEventSchema,
  replayDocumentEvents,
} from "@vibeshape/domain/commands"
import {
  type DocumentSnapshot,
  type DocumentSnapshotV1,
  documentSnapshotSchema,
  documentSnapshotV1Schema,
} from "@vibeshape/domain/document"
import { migrateDocumentSnapshot } from "@vibeshape/domain/document-migration"
import {
  type DocumentSnapshotV5,
  documentSnapshotV5Schema,
  validateRepairAuthorityBoundaries,
} from "@vibeshape/domain/document-v5"
import {
  type DocumentSnapshotV6,
  documentSnapshotV6Schema,
  validateAppearanceAuthorityBoundary,
} from "@vibeshape/domain/document-v6"
import { documentIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { strFromU8, strToU8, type Zippable, zipSync } from "fflate"
import { z } from "zod"
import { readSafeZip, SafeZipError } from "./safe-zip"

export const VSHAPE_MEDIA_TYPE = "application/vnd.vibeshape.project+zip" as const
export const VSHAPE_FORMAT_VERSION = 0 as const
export const VSHAPE_V1_FORMAT_VERSION = 1 as const
export const VSHAPE_V2_FORMAT_VERSION = 2 as const
export const VSHAPE_MAX_ARCHIVE_BYTES = Infinity

const MANIFEST_PATH = "manifest.json"
const DOCUMENT_PATH = "document.json"
const JOURNAL_PATH = "journal/events.jsonl"
const V2_SEED_PATH = "journal/seed.json"
const V2_LEGACY_PATH = "journal/legacy-prefix.jsonl"
const V2_SUFFIX_PATH = "journal/versioned-suffix.jsonl"
const REQUIRED_PATHS = [MANIFEST_PATH, DOCUMENT_PATH, JOURNAL_PATH] as const
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0)
const MAX_EVENTS = 100_000
const V2_REQUIRED_PATHS = [
  MANIFEST_PATH,
  DOCUMENT_PATH,
  V2_SEED_PATH,
  V2_LEGACY_PATH,
  V2_SUFFIX_PATH,
] as const
const MAX_MANIFEST_BYTES = 64 * 1024
const VSHAPE_LIMITS = {
  archiveBytes: VSHAPE_MAX_ARCHIVE_BYTES,
  entryBytes: Infinity,
  expandedBytes: Infinity,
  entryCount: 16,
  pathLength: 160,
  compressionRatio: 200,
} as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const semanticPathSchema = z.enum([DOCUMENT_PATH, JOURNAL_PATH])
const v2SemanticPathSchema = z.enum([DOCUMENT_PATH, V2_SEED_PATH, V2_LEGACY_PATH, V2_SUFFIX_PATH])
const semanticEntrySchema = z
  .object({
    path: semanticPathSchema,
    mediaType: z.enum(["application/json", "application/x-ndjson"]),
    bytes: z.number().int().nonnegative().max(VSHAPE_LIMITS.entryBytes),
    sha256: sha256Schema,
  })
  .strict()
const v2SemanticEntrySchema = z
  .object({
    path: v2SemanticPathSchema,
    mediaType: z.enum(["application/json", "application/x-ndjson"]),
    bytes: z.number().int().nonnegative().max(VSHAPE_LIMITS.entryBytes),
    sha256: sha256Schema,
  })
  .strict()

const engineSchema = z
  .object({
    adapter: z.string().min(1).max(120),
    adapterVersion: z.string().min(1).max(64),
    kernel: z.string().min(1).max(120),
    kernelVersion: z.string().min(1).max(64),
    buildHash: sha256Schema.nullable(),
    tolerancePolicyVersion: z.number().int().nonnegative().safe(),
  })
  .strict()

const createdBySchema = z
  .object({
    application: z.string().min(1).max(120),
    version: z.string().min(1).max(64),
    build: z.string().min(1).max(128).nullable(),
  })
  .strict()

const manifestMetadataSchema = z
  .object({
    requiredCapabilities: z.array(z.string().min(1).max(120)).max(64),
    extensionsLockChecksum: sha256Schema.nullable(),
    createdAt: timestampSchema,
    exportedAt: timestampSchema,
    units: z.literal("millimeter"),
    coordinateSystem: z.literal("right-handed-z-up"),
  })
  .strict()

function validateSemanticEntries(
  manifest: { semanticEntries: readonly z.infer<typeof semanticEntrySchema>[] },
  context: z.RefinementCtx,
) {
  const entries = new Map(manifest.semanticEntries.map((entry) => [entry.path, entry]))
  if (entries.size !== 2)
    context.addIssue({
      code: "custom",
      path: ["semanticEntries"],
      message: "Every semantic project entry must be declared exactly once.",
    })
  if (entries.get(DOCUMENT_PATH)?.mediaType !== "application/json")
    context.addIssue({
      code: "custom",
      path: ["semanticEntries"],
      message: "The root document must use application/json.",
    })
  if (entries.get(JOURNAL_PATH)?.mediaType !== "application/x-ndjson")
    context.addIssue({
      code: "custom",
      path: ["semanticEntries"],
      message: "The event journal must use application/x-ndjson.",
    })
}

export const vShapeManifestSchema = z
  .object({
    schemaVersion: z.literal(0),
    format: z.literal("vshape"),
    formatVersion: z.literal(VSHAPE_FORMAT_VERSION),
    minimumReaderVersion: z.literal(VSHAPE_FORMAT_VERSION),
    documentId: documentIdSchema,
    documentRevision: z.number().int().positive().safe(),
    createdBy: createdBySchema,
    engine: engineSchema.nullable(),
    rootDocument: z.literal(DOCUMENT_PATH),
    eventJournal: z.literal(JOURNAL_PATH),
    compression: z.literal("deflate"),
    semanticEntries: z.array(semanticEntrySchema).length(2),
    ...manifestMetadataSchema.shape,
  })
  .strict()
  .superRefine(validateSemanticEntries)

export const vShapeManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal("vshape"),
    formatVersion: z.literal(VSHAPE_V1_FORMAT_VERSION),
    minimumReaderVersion: z.literal(VSHAPE_V1_FORMAT_VERSION),
    documentId: documentIdSchema,
    documentRevision: z.number().int().positive().safe(),
    createdBy: createdBySchema,
    engine: engineSchema.nullable(),
    rootDocument: z.literal(DOCUMENT_PATH),
    eventJournal: z.literal(JOURNAL_PATH),
    compression: z.literal("deflate"),
    semanticEntries: z.array(semanticEntrySchema).length(2),
    ...manifestMetadataSchema.shape,
  })
  .strict()
  .superRefine(validateSemanticEntries)

const v2HistoryModeSchema = z.enum(["complete", "checkpoint"])
const v2DiagnosticSchema = z
  .object({ code: z.string().min(1).max(128), message: z.string().min(1).max(512) })
  .strict()

function validateV2ManifestEntries(
  manifest: { semanticEntries: readonly z.infer<typeof v2SemanticEntrySchema>[] },
  context: z.RefinementCtx,
) {
  const entries = new Map(manifest.semanticEntries.map((entry) => [entry.path, entry]))
  if (entries.size !== 4)
    context.addIssue({
      code: "custom",
      path: ["semanticEntries"],
      message: "Every V2 semantic entry must be declared exactly once.",
    })
  const mediaTypes = [
    entries.get(DOCUMENT_PATH)?.mediaType === "application/json",
    entries.get(V2_SEED_PATH)?.mediaType === "application/json",
    entries.get(V2_LEGACY_PATH)?.mediaType === "application/x-ndjson",
    entries.get(V2_SUFFIX_PATH)?.mediaType === "application/x-ndjson",
  ]
  if (!mediaTypes.every(Boolean))
    context.addIssue({
      code: "custom",
      path: ["semanticEntries"],
      message: "Every V2 semantic entry must use its required media type.",
    })
}

function validateV2ManifestHistory(
  manifest: {
    documentRevision: number
    historyMode: z.infer<typeof v2HistoryModeSchema>
    migrationDiagnostic: z.infer<typeof v2DiagnosticSchema> | null
    promotionRevision: number
    unavailableRecords: readonly string[]
  },
  context: z.RefinementCtx,
) {
  if (manifest.promotionRevision > manifest.documentRevision)
    context.addIssue({
      code: "custom",
      path: ["promotionRevision"],
      message: "The promotion revision cannot exceed the document revision.",
    })
  const hasEvidence =
    manifest.migrationDiagnostic !== null && manifest.unavailableRecords.length > 0
  const hasAnyEvidence =
    manifest.migrationDiagnostic !== null || manifest.unavailableRecords.length > 0
  if (manifest.historyMode === "checkpoint" && !hasEvidence)
    context.addIssue({
      code: "custom",
      path: ["historyMode"],
      message: "Checkpoint history requires bounded recovery evidence.",
    })
  if (manifest.historyMode === "complete" && hasAnyEvidence)
    context.addIssue({
      code: "custom",
      path: ["historyMode"],
      message: "Complete history cannot contain checkpoint recovery evidence.",
    })
}

export const vShapeManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    format: z.literal("vshape"),
    formatVersion: z.literal(VSHAPE_V2_FORMAT_VERSION),
    minimumReaderVersion: z.literal(VSHAPE_V2_FORMAT_VERSION),
    documentId: documentIdSchema,
    documentRevision: z.number().int().positive().safe(),
    createdBy: createdBySchema,
    engine: engineSchema.nullable(),
    rootDocument: z.literal(DOCUMENT_PATH),
    historySeed: z.literal(V2_SEED_PATH),
    legacyEventJournal: z.literal(V2_LEGACY_PATH),
    versionedEventJournal: z.literal(V2_SUFFIX_PATH),
    eventJournal: z.literal(V2_SUFFIX_PATH),
    compression: z.literal("deflate"),
    historyMode: v2HistoryModeSchema,
    promotionRevision: z.number().int().nonnegative().safe(),
    migrationDiagnostic: v2DiagnosticSchema.nullable(),
    unavailableRecords: z.array(z.string().min(1).max(256)).max(256),
    semanticEntries: z.array(v2SemanticEntrySchema).length(4),
    ...manifestMetadataSchema.shape,
  })
  .strict()
  .superRefine((manifest, context) => {
    validateV2ManifestEntries(manifest, context)
    validateV2ManifestHistory(manifest, context)
  })

const writeVShapeInputSchema = z
  .object({
    snapshot: documentSnapshotSchema,
    events: z.array(documentEventSchema).min(1).max(MAX_EVENTS),
    exportedAt: timestampSchema,
    createdBy: createdBySchema,
    engine: engineSchema.nullable().default(null),
  })
  .strict()

const writeVShapeV1InputSchema = writeVShapeInputSchema.extend({
  snapshot: documentSnapshotV1Schema,
})

type V2HistoryInput = Readonly<{
  historyMode: z.infer<typeof v2HistoryModeSchema>
  legacyEvents: readonly DocumentEvent[]
  migrationDiagnostic: z.infer<typeof v2DiagnosticSchema> | null
  promotionRevision: number
  seed: DocumentSnapshotV1 | null
  snapshot: DocumentSnapshotV1
  unavailableRecords: readonly string[]
  versionedEvents: readonly VersionedDocumentEvent[]
}>

function checkpointHistoryInputIsValid(input: V2HistoryInput) {
  return (
    input.seed !== null &&
    input.seed.revision === input.promotionRevision &&
    input.legacyEvents.length === 0 &&
    input.migrationDiagnostic !== null &&
    input.unavailableRecords.length > 0
  )
}

function completeHistoryInputIsValid(input: V2HistoryInput) {
  const unpromoted = input.promotionRevision === 0 && input.seed === null
  const promoted = input.promotionRevision > 0 && input.seed?.revision === input.promotionRevision
  return (
    (unpromoted || promoted) &&
    (!unpromoted || input.legacyEvents.length === 0) &&
    input.migrationDiagnostic === null &&
    input.unavailableRecords.length === 0
  )
}

function validateV2WriteHistory(input: V2HistoryInput, context: z.RefinementCtx) {
  if (input.legacyEvents.length + input.versionedEvents.length > MAX_EVENTS)
    context.addIssue({
      code: "custom",
      path: ["versionedEvents"],
      message: "The V2 event history exceeds its aggregate record limit.",
    })
  if (input.promotionRevision > input.snapshot.revision)
    context.addIssue({
      code: "custom",
      path: ["promotionRevision"],
      message: "The promotion revision cannot exceed the document revision.",
    })
  const modeIsValid =
    input.historyMode === "checkpoint"
      ? checkpointHistoryInputIsValid(input)
      : completeHistoryInputIsValid(input)
  if (!modeIsValid)
    context.addIssue({
      code: "custom",
      path: ["historyMode"],
      message: "The V2 history mode does not match its replay boundary and evidence.",
    })
}

const writeVShapeV2InputSchema = z
  .object({
    snapshot: documentSnapshotV1Schema,
    exportedAt: timestampSchema,
    createdBy: writeVShapeInputSchema.shape.createdBy,
    engine: engineSchema.nullable().default(null),
    historyMode: v2HistoryModeSchema,
    promotionRevision: z.number().int().nonnegative().safe(),
    seed: documentSnapshotV1Schema.nullable(),
    legacyEvents: z.array(documentEventSchema).max(MAX_EVENTS),
    versionedEvents: z.array(versionedDocumentEventSchema).max(MAX_EVENTS),
    migrationDiagnostic: v2DiagnosticSchema.nullable().default(null),
    unavailableRecords: z.array(z.string().min(1).max(256)).max(256).default([]),
  })
  .strict()
  .superRefine(validateV2WriteHistory)

const vShapeManifestHeaderSchema = z
  .object({
    format: z.literal("vshape"),
    formatVersion: z.number().int().nonnegative().safe(),
    minimumReaderVersion: z.number().int().nonnegative().safe(),
  })
  .passthrough()

export type VShapeManifest = Readonly<z.infer<typeof vShapeManifestSchema>>
export type VShapeManifestV1 = Readonly<z.infer<typeof vShapeManifestV1Schema>>
export type VShapeManifestV2 = Readonly<z.infer<typeof vShapeManifestV2Schema>>
export type VShapeEngine = Readonly<z.infer<typeof engineSchema>>
export type VShapeProject = Readonly<{
  manifest: VShapeManifest
  snapshot: DocumentSnapshot
  events: readonly DocumentEvent[]
}>
export type VShapeProjectV1 = Readonly<{
  manifest: VShapeManifestV1
  snapshot: DocumentSnapshotV1
  events: readonly DocumentEvent[]
}>
export type VShapeProjectV2 = Readonly<{
  manifest: VShapeManifestV2
  snapshot: DocumentSnapshotV1
  seed: DocumentSnapshotV1 | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly VersionedDocumentEvent[]
}>

export type VShapeDiagnosticCode =
  | "history-mismatch"
  | "integrity-mismatch"
  | "invalid-archive"
  | "invalid-document"
  | "invalid-journal"
  | "invalid-manifest"
  | "resource-limit"
  | "undeclared-entry"
  | "unsafe-path"
  | "unsupported-version"

export type VShapeResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; diagnostic: { code: VShapeDiagnosticCode; message: string } }

class VShapeError extends Error {
  constructor(
    readonly code: VShapeDiagnosticCode,
    message: string,
  ) {
    super(message)
  }
}

function requireVShape(
  condition: boolean,
  code: VShapeDiagnosticCode,
  message: string,
): asserts condition {
  if (!condition) throw new VShapeError(code, message)
}

async function sha256Bytes(value: Uint8Array) {
  const runtime = globalThis as typeof globalThis & {
    crypto?: {
      subtle?: { digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer> }
    }
  }
  const subtle = runtime.crypto?.subtle
  if (!subtle) throw new VShapeError("invalid-archive", "SHA-256 is unavailable in this runtime.")
  const digest = await subtle.digest("SHA-256", Uint8Array.from(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function encodeSemanticProject(snapshot: unknown, events: readonly DocumentEvent[]) {
  return {
    documentBytes: strToU8(canonicalJson(snapshot)),
    journalBytes: strToU8(`${events.map(canonicalJson).join("\n")}\n`),
  }
}

function encodeNdjson(events: readonly unknown[]) {
  return strToU8(events.length === 0 ? "" : `${events.map(canonicalJson).join("\n")}\n`)
}

function replayMatchesSnapshot(events: readonly DocumentEvent[], snapshot: DocumentSnapshot) {
  const replayed = replayDocumentEvents(events)
  return replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(snapshot)
}

function requirePortableHistory(snapshot: DocumentSnapshot, events: readonly DocumentEvent[]) {
  requireVShape(
    replayMatchesSnapshot(events, snapshot),
    "history-mismatch",
    "The event journal does not reproduce the document snapshot.",
  )
}

async function createManifest(
  input: z.output<typeof writeVShapeInputSchema>,
  documentBytes: Uint8Array,
  journalBytes: Uint8Array,
) {
  return vShapeManifestSchema.parse({
    schemaVersion: 0,
    format: "vshape",
    formatVersion: VSHAPE_FORMAT_VERSION,
    minimumReaderVersion: VSHAPE_FORMAT_VERSION,
    documentId: input.snapshot.id,
    documentRevision: input.snapshot.revision,
    createdBy: input.createdBy,
    engine: input.engine,
    rootDocument: DOCUMENT_PATH,
    eventJournal: JOURNAL_PATH,
    compression: "deflate",
    semanticEntries: [
      {
        path: DOCUMENT_PATH,
        mediaType: "application/json",
        bytes: documentBytes.byteLength,
        sha256: await sha256Bytes(documentBytes),
      },
      {
        path: JOURNAL_PATH,
        mediaType: "application/x-ndjson",
        bytes: journalBytes.byteLength,
        sha256: await sha256Bytes(journalBytes),
      },
    ],
    requiredCapabilities: [],
    extensionsLockChecksum: null,
    createdAt: input.snapshot.createdAt,
    exportedAt: input.exportedAt,
    units: "millimeter",
    coordinateSystem: "right-handed-z-up",
  })
}

async function createManifestV1(
  input: Pick<z.output<typeof writeVShapeInputSchema>, "createdBy" | "engine" | "exportedAt">,
  snapshot: DocumentSnapshotV1,
  documentBytes: Uint8Array,
  journalBytes: Uint8Array,
) {
  return vShapeManifestV1Schema.parse({
    schemaVersion: VSHAPE_V1_FORMAT_VERSION,
    format: "vshape",
    formatVersion: VSHAPE_V1_FORMAT_VERSION,
    minimumReaderVersion: VSHAPE_V1_FORMAT_VERSION,
    documentId: snapshot.id,
    documentRevision: snapshot.revision,
    createdBy: input.createdBy,
    engine: input.engine,
    rootDocument: DOCUMENT_PATH,
    eventJournal: JOURNAL_PATH,
    compression: "deflate",
    semanticEntries: [
      {
        path: DOCUMENT_PATH,
        mediaType: "application/json",
        bytes: documentBytes.byteLength,
        sha256: await sha256Bytes(documentBytes),
      },
      {
        path: JOURNAL_PATH,
        mediaType: "application/x-ndjson",
        bytes: journalBytes.byteLength,
        sha256: await sha256Bytes(journalBytes),
      },
    ],
    requiredCapabilities: [],
    extensionsLockChecksum: null,
    createdAt: snapshot.createdAt,
    exportedAt: input.exportedAt,
    units: "millimeter",
    coordinateSystem: "right-handed-z-up",
  })
}

function vShapeDiagnostic(error: unknown) {
  if (error instanceof VShapeError) return { code: error.code, message: error.message }
  if (error instanceof SafeZipError) return { code: error.code, message: error.message }
  return {
    code: "invalid-archive" as const,
    message: "The VibeShape project archive could not be decoded.",
  }
}

export async function writeVShape(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeInputSchema.safeParse(inputValue)
  if (!input.success) {
    return {
      ok: false,
      diagnostic: { code: "invalid-document", message: "The portable project input is invalid." },
    }
  }
  try {
    requirePortableHistory(input.data.snapshot, input.data.events)
    const semantic = encodeSemanticProject(input.data.snapshot, input.data.events)
    const manifest = await createManifest(input.data, semantic.documentBytes, semantic.journalBytes)
    const archive: Zippable = {
      [MANIFEST_PATH]: strToU8(canonicalJson(manifest)),
      [DOCUMENT_PATH]: semantic.documentBytes,
      [JOURNAL_PATH]: semantic.journalBytes,
    }
    const bytes = zipSync(archive, { level: 6, mtime: ZIP_MTIME })
    requireVShape(
      bytes.byteLength <= VSHAPE_LIMITS.archiveBytes,
      "resource-limit",
      "The project archive exceeds the compressed-size limit.",
    )
    return { ok: true, value: bytes }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

function requireExactEntries(files: UnzippedProjectFiles) {
  const paths = Object.keys(files).sort()
  requireVShape(
    paths.length === REQUIRED_PATHS.length && REQUIRED_PATHS.every((path) => paths.includes(path)),
    "undeclared-entry",
    "The v0 project archive must contain exactly its three declared semantic entries.",
  )
}

type UnzippedProjectFiles = Record<string, Uint8Array>

function decodeUtf8(
  bytes: Uint8Array,
  code: "invalid-document" | "invalid-manifest" | "invalid-journal",
) {
  const text = strFromU8(bytes)
  const encoded = strToU8(text)
  requireVShape(
    encoded.byteLength === bytes.byteLength &&
      encoded.every((byte, index) => byte === bytes[index]),
    code,
    "The project entry is not valid UTF-8.",
  )
  return text
}

function parseJsonFile<Output>(
  files: UnzippedProjectFiles,
  path: string,
  schema: z.ZodType<Output>,
  code: "invalid-document" | "invalid-manifest",
) {
  const bytes = files[path]
  requireVShape(bytes !== undefined, code, `Required project entry is missing: ${path}.`)
  try {
    return schema.parse(JSON.parse(decodeUtf8(bytes, code)))
  } catch {
    throw new VShapeError(code, `Project entry is invalid: ${path}.`)
  }
}

function parseManifest(files: UnzippedProjectFiles) {
  const input = parseManifestInput(files)
  const header = vShapeManifestHeaderSchema.safeParse(input)
  requireVShape(header.success, "invalid-manifest", "The project manifest header is invalid.")
  requireVShape(
    header.data.formatVersion === VSHAPE_FORMAT_VERSION &&
      header.data.minimumReaderVersion <= VSHAPE_FORMAT_VERSION,
    "unsupported-version",
    "This project requires a newer VibeShape reader.",
  )
  const manifest = vShapeManifestSchema.safeParse(input)
  requireVShape(manifest.success, "invalid-manifest", "The project manifest is invalid.")
  return manifest.data
}

function parseManifestInput(files: UnzippedProjectFiles) {
  const bytes = files[MANIFEST_PATH]
  requireVShape(bytes !== undefined, "invalid-manifest", "The project manifest is missing.")
  requireVShape(
    bytes.byteLength <= MAX_MANIFEST_BYTES,
    "resource-limit",
    "The project manifest exceeds its size limit.",
  )
  let input: unknown
  try {
    input = JSON.parse(decodeUtf8(bytes, "invalid-manifest"))
  } catch (error) {
    if (error instanceof VShapeError) throw error
    throw new VShapeError("invalid-manifest", "The project manifest is invalid.")
  }
  return input
}

function parseManifestV1(files: UnzippedProjectFiles) {
  const manifest = vShapeManifestV1Schema.safeParse(parseManifestInput(files))
  requireVShape(manifest.success, "invalid-manifest", "The project manifest is invalid.")
  return manifest.data
}

function parseManifestV2(files: UnzippedProjectFiles) {
  const manifest = vShapeManifestV2Schema.safeParse(parseManifestInput(files))
  requireVShape(manifest.success, "invalid-manifest", "The V2 project manifest is invalid.")
  return manifest.data
}

function parseManifestHeader(files: UnzippedProjectFiles) {
  const header = vShapeManifestHeaderSchema.safeParse(parseManifestInput(files))
  requireVShape(header.success, "invalid-manifest", "The project manifest header is invalid.")
  return header.data
}

function parseJournal(files: UnzippedProjectFiles) {
  const bytes = files[JOURNAL_PATH]
  requireVShape(bytes !== undefined, "invalid-journal", "The project event journal is missing.")
  const text = strFromU8(bytes)
  const encoded = strToU8(text)
  requireVShape(
    encoded.byteLength === bytes.byteLength &&
      encoded.every((byte, index) => byte === bytes[index]),
    "invalid-journal",
    "The project event journal is not valid UTF-8.",
  )
  requireVShape(
    text.endsWith("\n"),
    "invalid-journal",
    "The event journal must end with a newline.",
  )
  const lines = text.slice(0, -1).split("\n")
  requireVShape(
    lines.length >= 1 && lines.length <= MAX_EVENTS && lines.every((line) => line.length > 0),
    "invalid-journal",
    "The event journal has an invalid number of records.",
  )
  try {
    return lines.map((line) => documentEventSchema.parse(JSON.parse(line)))
  } catch {
    throw new VShapeError("invalid-journal", "The project event journal is invalid.")
  }
}

function parseNdjson<T>(files: UnzippedProjectFiles, path: string, schema: z.ZodType<T>) {
  const bytes = files[path]
  requireVShape(
    bytes !== undefined,
    "invalid-journal",
    `The project event journal is missing: ${path}.`,
  )
  const text = decodeUtf8(bytes, "invalid-journal")
  if (text === "") return [] as T[]
  requireVShape(
    text.endsWith("\n"),
    "invalid-journal",
    "The event journal must end with a newline.",
  )
  const lines = text.slice(0, -1).split("\n")
  requireVShape(
    lines.length <= MAX_EVENTS && lines.every((line) => line.length > 0),
    "invalid-journal",
    "The event journal has too many or invalid records.",
  )
  try {
    return lines.map((line) => schema.parse(JSON.parse(line)))
  } catch {
    throw new VShapeError("invalid-journal", `The project event journal is invalid: ${path}.`)
  }
}

async function requireSemanticIntegrity(
  manifest: Pick<VShapeManifest, "semanticEntries">,
  files: UnzippedProjectFiles,
) {
  const declaredPaths = manifest.semanticEntries.map(({ path }) => path)
  requireVShape(
    declaredPaths.length === 2 && new Set(declaredPaths).size === 2,
    "invalid-manifest",
    "Every semantic project entry must be declared exactly once.",
  )
  for (const entry of manifest.semanticEntries) {
    const bytes = files[entry.path]
    requireVShape(
      bytes !== undefined,
      "invalid-manifest",
      `Declared entry is missing: ${entry.path}.`,
    )
    requireVShape(
      bytes.byteLength === entry.bytes && (await sha256Bytes(bytes)) === entry.sha256,
      "integrity-mismatch",
      `Semantic project entry failed integrity verification: ${entry.path}.`,
    )
  }
}

async function requireV2SemanticIntegrity(
  manifest: Pick<VShapeManifestV2, "semanticEntries">,
  files: UnzippedProjectFiles,
) {
  requireVShape(
    new Set(manifest.semanticEntries.map(({ path }) => path)).size === 4,
    "invalid-manifest",
    "Every V2 semantic entry must be declared exactly once.",
  )
  for (const entry of manifest.semanticEntries) {
    const bytes = files[entry.path]
    requireVShape(
      bytes !== undefined &&
        bytes.byteLength === entry.bytes &&
        (await sha256Bytes(bytes)) === entry.sha256,
      "integrity-mismatch",
      `Semantic project entry failed integrity verification: ${entry.path}.`,
    )
  }
}

function requireManifestRelationship(
  manifest: Pick<VShapeManifest, "createdAt" | "documentId" | "documentRevision">,
  snapshot: Pick<DocumentSnapshot, "createdAt" | "id" | "revision">,
) {
  requireVShape(
    manifest.documentId === snapshot.id && manifest.documentRevision === snapshot.revision,
    "history-mismatch",
    "The manifest does not identify the enclosed document revision.",
  )
  requireVShape(
    manifest.createdAt === snapshot.createdAt,
    "history-mismatch",
    "The manifest creation timestamp does not match the enclosed document.",
  )
}

function requireV1ReplayProof(snapshot: DocumentSnapshotV1, events: readonly DocumentEvent[]) {
  const replayed = replayDocumentEvents(events)
  requireVShape(
    replayed.ok,
    "history-mismatch",
    "The event journal could not be replayed to a legacy document.",
  )
  const migrated = migrateDocumentSnapshot(replayed.snapshot, events)
  requireVShape(
    migrated.ok && canonicalJson(migrated.snapshot) === canonicalJson(snapshot),
    "history-mismatch",
    "The event journal migration does not reproduce the document snapshot.",
  )
}

async function decodeVShape(files: UnzippedProjectFiles): Promise<VShapeProject> {
  requireExactEntries(files)
  const manifest = parseManifest(files)
  await requireSemanticIntegrity(manifest, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotSchema, "invalid-document")
  const events = parseJournal(files)
  requireManifestRelationship(manifest, snapshot)
  requirePortableHistory(snapshot, events)
  return { manifest, snapshot, events }
}

async function decodeVShapeV1(files: UnzippedProjectFiles): Promise<VShapeProjectV1> {
  requireExactEntries(files)
  const manifest = parseManifestV1(files)
  await requireSemanticIntegrity(manifest, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV1Schema, "invalid-document")
  const events = parseJournal(files)
  requireManifestRelationship(manifest, snapshot)
  requireV1ReplayProof(snapshot, events)
  return { manifest, snapshot, events }
}

function requireV2History(
  manifest: VShapeManifestV2,
  snapshot: DocumentSnapshotV1,
  seed: DocumentSnapshotV1 | null,
  legacyEvents: readonly DocumentEvent[],
  suffix: readonly VersionedDocumentEvent[],
) {
  if (manifest.historyMode === "complete") {
    requireVShape(
      manifest.migrationDiagnostic === null && manifest.unavailableRecords.length === 0,
      "history-mismatch",
      "Complete history cannot contain checkpoint recovery metadata.",
    )
    if (manifest.promotionRevision === 0 && seed === null)
      requireVShape(
        legacyEvents.length === 0,
        "history-mismatch",
        "An unpromoted complete history cannot contain legacy records.",
      )
    else {
      requireVShape(
        seed !== null && seed.revision === manifest.promotionRevision,
        "history-mismatch",
        "The complete-history seed is invalid.",
      )
      requireV1ReplayProof(seed, legacyEvents)
    }
  } else {
    requireVShape(
      seed !== null && seed.revision === manifest.promotionRevision,
      "history-mismatch",
      "The checkpoint seed is invalid.",
    )
    requireVShape(
      legacyEvents.length === 0,
      "history-mismatch",
      "Checkpoint history cannot contain legacy records.",
    )
  }
  const replayed = replayVersionedDocumentEvents(seed, suffix)
  requireVShape(
    replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(snapshot),
    "history-mismatch",
    "The versioned event suffix does not reproduce the document snapshot.",
  )
}

async function decodeVShapeV2(files: UnzippedProjectFiles): Promise<VShapeProjectV2> {
  const paths = Object.keys(files).sort()
  requireVShape(
    paths.length === V2_REQUIRED_PATHS.length &&
      V2_REQUIRED_PATHS.every((path) => paths.includes(path)),
    "undeclared-entry",
    "The V2 project archive must contain exactly its declared entries.",
  )
  const manifest = parseManifestV2(files)
  await requireV2SemanticIntegrity(manifest, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV1Schema, "invalid-document")
  const seedBytes = files[V2_SEED_PATH]
  requireVShape(seedBytes !== undefined, "invalid-document", "The V2 seed entry is missing.")
  let seed: DocumentSnapshotV1 | null
  try {
    const input: unknown = JSON.parse(decodeUtf8(seedBytes, "invalid-document"))
    if (input === null) seed = null
    else {
      const parsed = documentSnapshotV1Schema.safeParse(input)
      requireVShape(parsed.success, "invalid-document", "The V2 seed entry is invalid.")
      seed = parsed.data
    }
  } catch {
    throw new VShapeError("invalid-document", "The V2 seed entry is invalid.")
  }
  const legacyEvents = parseNdjson(files, V2_LEGACY_PATH, documentEventSchema)
  const suffix = parseNdjson(files, V2_SUFFIX_PATH, versionedDocumentEventSchema)
  requireVShape(
    legacyEvents.length + suffix.length <= MAX_EVENTS,
    "resource-limit",
    "The V2 event history exceeds its aggregate record limit.",
  )
  requireManifestRelationship(manifest, snapshot)
  requireV2History(manifest, snapshot, seed, legacyEvents, suffix)
  return { manifest, snapshot, seed, legacyEvents, versionedEvents: suffix }
}

export async function readVShape(bytes: unknown): Promise<VShapeResult<VShapeProject>> {
  try {
    return { ok: true, value: await decodeVShape(await readSafeZip(bytes, VSHAPE_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export async function writeVShapeV1(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeV1InputSchema.safeParse(inputValue)
  if (!input.success) {
    return {
      ok: false,
      diagnostic: { code: "invalid-document", message: "The portable project input is invalid." },
    }
  }
  try {
    const semantic = encodeSemanticProject(input.data.snapshot, input.data.events)
    requireV1ReplayProof(input.data.snapshot, input.data.events)
    const manifest = await createManifestV1(
      input.data,
      input.data.snapshot,
      semantic.documentBytes,
      semantic.journalBytes,
    )
    const archive: Zippable = {
      [MANIFEST_PATH]: strToU8(canonicalJson(manifest)),
      [DOCUMENT_PATH]: semantic.documentBytes,
      [JOURNAL_PATH]: semantic.journalBytes,
    }
    const result = zipSync(archive, { level: 6, mtime: ZIP_MTIME })
    requireVShape(
      result.byteLength <= VSHAPE_LIMITS.archiveBytes,
      "resource-limit",
      "The project archive exceeds the compressed-size limit.",
    )
    return { ok: true, value: result }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export async function readVShapeV1(bytes: unknown): Promise<VShapeResult<VShapeProjectV1>> {
  try {
    return { ok: true, value: await decodeVShapeV1(await readSafeZip(bytes, VSHAPE_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

type V2SemanticBytes = Readonly<{
  document: Uint8Array
  legacy: Uint8Array
  seed: Uint8Array
  suffix: Uint8Array
}>

function encodeV2SemanticProject(input: {
  snapshot: unknown
  seed: unknown
  legacyEvents: readonly unknown[]
  versionedEvents: readonly unknown[]
}): V2SemanticBytes {
  return {
    document: strToU8(canonicalJson(input.snapshot)),
    seed: strToU8(input.seed === null ? "null" : canonicalJson(input.seed)),
    legacy: encodeNdjson(input.legacyEvents),
    suffix: encodeNdjson(input.versionedEvents),
  }
}

async function v2SemanticEntries(bytes: V2SemanticBytes) {
  return [
    {
      path: DOCUMENT_PATH,
      mediaType: "application/json",
      bytes: bytes.document.byteLength,
      sha256: await sha256Bytes(bytes.document),
    },
    {
      path: V2_SEED_PATH,
      mediaType: "application/json",
      bytes: bytes.seed.byteLength,
      sha256: await sha256Bytes(bytes.seed),
    },
    {
      path: V2_LEGACY_PATH,
      mediaType: "application/x-ndjson",
      bytes: bytes.legacy.byteLength,
      sha256: await sha256Bytes(bytes.legacy),
    },
    {
      path: V2_SUFFIX_PATH,
      mediaType: "application/x-ndjson",
      bytes: bytes.suffix.byteLength,
      sha256: await sha256Bytes(bytes.suffix),
    },
  ]
}

async function createManifestV2(
  input: Pick<
    z.output<typeof writeVShapeV2InputSchema>,
    | "createdBy"
    | "engine"
    | "historyMode"
    | "promotionRevision"
    | "migrationDiagnostic"
    | "unavailableRecords"
    | "exportedAt"
  > & { snapshot: Pick<DocumentSnapshotV1, "id" | "revision" | "createdAt"> },
  bytes: V2SemanticBytes,
) {
  return vShapeManifestV2Schema.parse({
    schemaVersion: 2,
    format: "vshape",
    formatVersion: 2,
    minimumReaderVersion: 2,
    documentId: input.snapshot.id,
    documentRevision: input.snapshot.revision,
    createdBy: input.createdBy,
    engine: input.engine,
    rootDocument: DOCUMENT_PATH,
    historySeed: V2_SEED_PATH,
    legacyEventJournal: V2_LEGACY_PATH,
    versionedEventJournal: V2_SUFFIX_PATH,
    eventJournal: V2_SUFFIX_PATH,
    compression: "deflate",
    historyMode: input.historyMode,
    promotionRevision: input.promotionRevision,
    migrationDiagnostic: input.migrationDiagnostic,
    unavailableRecords: input.unavailableRecords,
    semanticEntries: await v2SemanticEntries(bytes),
    requiredCapabilities: [],
    extensionsLockChecksum: null,
    createdAt: input.snapshot.createdAt,
    exportedAt: input.exportedAt,
    units: "millimeter",
    coordinateSystem: "right-handed-z-up",
  })
}

function encodeVShapeV2Archive(manifest: unknown, bytes: V2SemanticBytes) {
  return zipSync(
    {
      [MANIFEST_PATH]: strToU8(canonicalJson(manifest)),
      [DOCUMENT_PATH]: bytes.document,
      [V2_SEED_PATH]: bytes.seed,
      [V2_LEGACY_PATH]: bytes.legacy,
      [V2_SUFFIX_PATH]: bytes.suffix,
    },
    { level: 6, mtime: ZIP_MTIME },
  )
}

export async function writeVShapeV2(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeV2InputSchema.safeParse(inputValue)
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-document",
        message: "The V2 portable project input is invalid.",
      },
    }
  try {
    const bytes = encodeV2SemanticProject(input.data)
    const manifest = await createManifestV2(input.data, bytes)
    requireV2History(
      manifest,
      input.data.snapshot,
      input.data.seed,
      input.data.legacyEvents,
      input.data.versionedEvents,
    )
    const result = encodeVShapeV2Archive(manifest, bytes)
    requireVShape(
      result.byteLength <= VSHAPE_LIMITS.archiveBytes,
      "resource-limit",
      "The project archive exceeds the compressed-size limit.",
    )
    return { ok: true, value: result }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export async function readVShapeV2(bytes: unknown): Promise<VShapeResult<VShapeProjectV2>> {
  try {
    return { ok: true, value: await decodeVShapeV2(await readSafeZip(bytes, VSHAPE_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export type VersionedVShapeProject =
  | Readonly<{ version: 0; project: VShapeProject }>
  | Readonly<{ version: 1; project: VShapeProjectV1 }>
  | Readonly<{ version: 2; project: VShapeProjectV2 }>

export async function readVersionedVShape(
  bytes: unknown,
): Promise<VShapeResult<VersionedVShapeProject>> {
  try {
    const files = await readSafeZip(bytes, VSHAPE_LIMITS)
    const header = parseManifestHeader(files)
    if (header.formatVersion === VSHAPE_FORMAT_VERSION)
      return { ok: true, value: { version: 0, project: await decodeVShape(files) } }
    if (header.formatVersion === VSHAPE_V1_FORMAT_VERSION)
      return { ok: true, value: { version: 1, project: await decodeVShapeV1(files) } }
    if (header.formatVersion === VSHAPE_V2_FORMAT_VERSION)
      return { ok: true, value: { version: 2, project: await decodeVShapeV2(files) } }
    throw new VShapeError("unsupported-version", "This project requires a newer VibeShape reader.")
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

function manifestVersionFields<V extends number>(version: V) {
  return {
    schemaVersion: z.literal(version),
    formatVersion: z.literal(version),
    minimumReaderVersion: z.literal(version),
  }
}
const authoredManifestShape = {
  ...vShapeManifestV2Schema.shape,
  upgradeRevision: z.number().int().positive().safe(),
}

export const VSHAPE_V3_FORMAT_VERSION = 3 as const
export const vShapeManifestV3Schema = z
  .object({
    ...authoredManifestShape,
    ...manifestVersionFields(3),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateV2ManifestEntries(manifest, context)
    validateV2ManifestHistory(manifest, context)
    if (manifest.upgradeRevision > manifest.documentRevision)
      context.addIssue({
        code: "custom",
        message: "The upgrade revision exceeds the document revision.",
      })
  })
export type VShapeManifestV3 = Readonly<z.infer<typeof vShapeManifestV3Schema>>
export type VShapeProjectV3 = Readonly<{
  manifest: VShapeManifestV3
  snapshot: DocumentSnapshotV2
  seed: DocumentAuthorityV2Snapshot | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly DocumentAuthorityV2Event[]
}>
const writeVShapeV3InputSchema = z
  .object({
    ...writeVShapeV2InputSchema.shape,
    snapshot: documentSnapshotV2Schema,
    seed: documentAuthorityV2SnapshotSchema.nullable(),
    versionedEvents: z.array(documentAuthorityV2EventSchema).max(MAX_EVENTS),
    upgradeRevision: z.number().int().positive().safe(),
  })
  .strict()

function requireV3Boundary(project: VShapeProjectV3) {
  const { manifest, snapshot, legacyEvents, versionedEvents } = project
  const events = [...legacyEvents, ...versionedEvents]
  requireVShape(
    events.length <= MAX_EVENTS,
    "resource-limit",
    "The mixed journal exceeds its aggregate record budget.",
  )
  requireVShape(
    new Set(events.map((event) => event.commandId)).size === events.length,
    "history-mismatch",
    "The mixed journal repeats a command identity.",
  )
  requireVShape(
    snapshot.id === manifest.documentId &&
      snapshot.revision === manifest.documentRevision &&
      snapshot.createdAt === manifest.createdAt,
    "history-mismatch",
    "The manifest and authored snapshot disagree.",
  )
  requireV3Seed(project)
  requireV3Upgrade(project)
}

function requireV3Seed({ manifest, seed, legacyEvents }: VShapeProjectV3) {
  if (manifest.historyMode === "checkpoint") {
    requireVShape(
      seed !== null && seed.revision === manifest.promotionRevision && legacyEvents.length === 0,
      "history-mismatch",
      "The checkpoint seed does not match its history boundary.",
    )
  } else if (seed) {
    requireVShape(
      seed.schemaVersion === 1 &&
        seed.revision === manifest.promotionRevision &&
        legacyEvents.length === manifest.promotionRevision,
      "history-mismatch",
      "The complete history requires its original V1 promotion seed.",
    )
    requireV1ReplayProof(seed, legacyEvents)
  } else
    requireVShape(
      manifest.promotionRevision === 0 && legacyEvents.length === 0,
      "history-mismatch",
      "Native history cannot declare a legacy prefix.",
    )
}

function requireV3Upgrade({ manifest, seed, versionedEvents }: VShapeProjectV3) {
  const upgrades = versionedEvents.filter(
    (event) => event.type === "org.vibeshape.document.upgraded-v2",
  )
  const validUpgrade =
    seed?.schemaVersion === 2
      ? manifest.upgradeRevision <= seed.revision && upgrades.length === 0
      : upgrades.length === 1 && upgrades[0]?.revision === manifest.upgradeRevision
  requireVShape(validUpgrade, "history-mismatch", "The authored upgrade boundary is inconsistent.")
}

function requireV3History(project: VShapeProjectV3) {
  requireV3Boundary(project)
  const replayed = replayDocumentAuthorityEvents(project.seed, project.versionedEvents)
  requireVShape(
    replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(project.snapshot),
    "history-mismatch",
    "The mixed journal does not reproduce the authored snapshot.",
  )
}

async function createManifestV3(
  input: z.output<typeof writeVShapeV3InputSchema>,
  bytes: V2SemanticBytes,
) {
  return vShapeManifestV3Schema.parse({
    schemaVersion: 3,
    format: "vshape",
    formatVersion: 3,
    minimumReaderVersion: 3,
    documentId: input.snapshot.id,
    documentRevision: input.snapshot.revision,
    createdBy: input.createdBy,
    engine: input.engine,
    rootDocument: DOCUMENT_PATH,
    historySeed: V2_SEED_PATH,
    legacyEventJournal: V2_LEGACY_PATH,
    versionedEventJournal: V2_SUFFIX_PATH,
    eventJournal: V2_SUFFIX_PATH,
    compression: "deflate",
    historyMode: input.historyMode,
    promotionRevision: input.promotionRevision,
    upgradeRevision: input.upgradeRevision,
    migrationDiagnostic: input.migrationDiagnostic,
    unavailableRecords: input.unavailableRecords,
    semanticEntries: await v2SemanticEntries(bytes),
    requiredCapabilities: [],
    extensionsLockChecksum: null,
    createdAt: input.snapshot.createdAt,
    exportedAt: input.exportedAt,
    units: "millimeter",
    coordinateSystem: "right-handed-z-up",
  })
}

export async function writeVShapeV3(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeV3InputSchema.safeParse(inputValue)
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-document",
        message: "The V3 portable project input is invalid.",
      },
    }
  try {
    const bytes = encodeV2SemanticProject(input.data)
    const manifest = await createManifestV3(input.data, bytes)
    requireV3History({ ...input.data, manifest })
    const archive = encodeVShapeV2Archive(manifest, bytes)
    // Apply the same expansion, path, and ratio limits enforced by readers to writer output.
    await readSafeZip(archive, VSHAPE_LIMITS)
    return { ok: true, value: archive }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

async function decodeVShapeV3(files: UnzippedProjectFiles): Promise<VShapeProjectV3> {
  const paths = Object.keys(files)
  requireVShape(
    paths.length === V2_REQUIRED_PATHS.length &&
      V2_REQUIRED_PATHS.every((path) => paths.includes(path)),
    "undeclared-entry",
    "The V3 archive must contain exactly its declared entries.",
  )
  const parsed = vShapeManifestV3Schema.safeParse(parseManifestInput(files))
  requireVShape(parsed.success, "invalid-manifest", "The V3 manifest is invalid.")
  const manifest = parsed.data
  await requireV2SemanticIntegrity(manifest, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV2Schema, "invalid-document")
  const seed = parseJsonFile(
    files,
    V2_SEED_PATH,
    documentAuthorityV2SnapshotSchema.nullable(),
    "invalid-document",
  )
  const legacyEvents = parseNdjson(files, V2_LEGACY_PATH, documentEventSchema)
  const versionedEvents = parseNdjson(files, V2_SUFFIX_PATH, documentAuthorityV2EventSchema)
  const project = { manifest, snapshot, seed, legacyEvents, versionedEvents }
  requireV3History(project)
  return project
}

export async function readVShapeV3(bytes: unknown): Promise<VShapeResult<VShapeProjectV3>> {
  try {
    return { ok: true, value: await decodeVShapeV3(await readSafeZip(bytes, VSHAPE_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export const VSHAPE_V4_FORMAT_VERSION = 4 as const
export const vShapeManifestV4Schema = z
  .object({
    ...authoredManifestShape,
    ...manifestVersionFields(4),
    textureUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateV2ManifestEntries(manifest, context)
    validateV2ManifestHistory(manifest, context)
    if (
      manifest.textureUpgradeRevision <= manifest.upgradeRevision ||
      manifest.textureUpgradeRevision > manifest.documentRevision ||
      manifest.upgradeRevision > manifest.documentRevision
    )
      context.addIssue({
        code: "custom",
        message: "The upgrade revision exceeds the document revision.",
      })
  })
export type VShapeManifestV4 = Readonly<z.infer<typeof vShapeManifestV4Schema>>
export type VShapeProjectV4 = Readonly<{
  manifest: VShapeManifestV4
  snapshot: DocumentSnapshotV3
  seed: DocumentAuthoritySnapshot | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly DocumentAuthorityEvent[]
}>
const writeVShapeV4InputSchema = z
  .object({
    ...writeVShapeV2InputSchema.shape,
    snapshot: documentSnapshotV3Schema,
    seed: documentAuthoritySnapshotSchema.nullable(),
    versionedEvents: z.array(documentAuthorityEventSchema).max(MAX_EVENTS),
    upgradeRevision: z.number().int().positive().safe(),
    textureUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()

function requireV4Boundary(project: VShapeProjectV4) {
  const { manifest, snapshot, legacyEvents, versionedEvents } = project
  const events = [...legacyEvents, ...versionedEvents]
  requireVShape(
    events.length <= MAX_EVENTS,
    "resource-limit",
    "The mixed journal exceeds its aggregate record budget.",
  )
  requireVShape(
    new Set(events.map((event) => event.commandId)).size === events.length,
    "history-mismatch",
    "The mixed journal repeats a command identity.",
  )
  requireVShape(
    snapshot.id === manifest.documentId &&
      snapshot.revision === manifest.documentRevision &&
      snapshot.createdAt === manifest.createdAt,
    "history-mismatch",
    "The manifest and authored snapshot disagree.",
  )
  requireV4Seed(project)
  requireV4Upgrade(project)
}

function requireV4Seed({
  manifest,
  seed,
  legacyEvents,
}: {
  manifest: Pick<VShapeManifestV4, "historyMode" | "promotionRevision">
  seed: DocumentAuthoritySnapshot | null
  legacyEvents: readonly DocumentEvent[]
}) {
  if (manifest.historyMode === "checkpoint") {
    requireVShape(
      seed !== null && seed.revision === manifest.promotionRevision && legacyEvents.length === 0,
      "history-mismatch",
      "The checkpoint seed does not match its history boundary.",
    )
  } else if (seed) {
    requireVShape(
      seed.schemaVersion === 1 &&
        seed.revision === manifest.promotionRevision &&
        legacyEvents.length === manifest.promotionRevision,
      "history-mismatch",
      "The complete history requires its original V1 promotion seed.",
    )
    requireV1ReplayProof(seed, legacyEvents)
  } else
    requireVShape(
      manifest.promotionRevision === 0 && legacyEvents.length === 0,
      "history-mismatch",
      "Native history cannot declare a legacy prefix.",
    )
}

function requireV4Upgrade({ manifest, seed, versionedEvents }: VShapeProjectV4) {
  const upgrades = versionedEvents.filter(
    (event) => event.type === "org.vibeshape.document.upgraded-v2",
  )
  const validUpgrade =
    seed && seed.schemaVersion !== 1
      ? manifest.upgradeRevision <= seed.revision && upgrades.length === 0
      : upgrades.length === 1 && upgrades[0]?.revision === manifest.upgradeRevision
  requireVShape(validUpgrade, "history-mismatch", "The authored upgrade boundary is inconsistent.")
  requireV4TextureUpgrade({ manifest, seed, versionedEvents })
}

function requireV4TextureUpgrade({
  manifest,
  seed,
  versionedEvents,
}: Pick<VShapeProjectV4, "manifest" | "seed" | "versionedEvents">) {
  const textureUpgrades = versionedEvents.filter(
    (event) => event.type === "org.vibeshape.document.upgraded-v3",
  )
  const validTextureUpgrade =
    seed?.schemaVersion === 3
      ? manifest.textureUpgradeRevision <= seed.revision && textureUpgrades.length === 0
      : textureUpgrades.length === 1 &&
        textureUpgrades[0]?.revision === manifest.textureUpgradeRevision
  requireVShape(
    validTextureUpgrade,
    "history-mismatch",
    "The texture authority upgrade boundary is inconsistent.",
  )
}

function requireV4History(project: VShapeProjectV4) {
  requireV4Boundary(project)
  const replayed = replayDocumentAuthorityEvents(project.seed, project.versionedEvents)
  requireVShape(
    replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(project.snapshot),
    "history-mismatch",
    "The mixed journal does not reproduce the authored snapshot.",
  )
}

async function createManifestV4(
  input: z.output<typeof writeVShapeV4InputSchema>,
  bytes: V2SemanticBytes,
) {
  return vShapeManifestV4Schema.parse({
    schemaVersion: 4,
    format: "vshape",
    formatVersion: 4,
    minimumReaderVersion: 4,
    documentId: input.snapshot.id,
    documentRevision: input.snapshot.revision,
    createdBy: input.createdBy,
    engine: input.engine,
    rootDocument: DOCUMENT_PATH,
    historySeed: V2_SEED_PATH,
    legacyEventJournal: V2_LEGACY_PATH,
    versionedEventJournal: V2_SUFFIX_PATH,
    eventJournal: V2_SUFFIX_PATH,
    compression: "deflate",
    historyMode: input.historyMode,
    promotionRevision: input.promotionRevision,
    upgradeRevision: input.upgradeRevision,
    textureUpgradeRevision: input.textureUpgradeRevision,
    migrationDiagnostic: input.migrationDiagnostic,
    unavailableRecords: input.unavailableRecords,
    semanticEntries: await v2SemanticEntries(bytes),
    requiredCapabilities: [],
    extensionsLockChecksum: null,
    createdAt: input.snapshot.createdAt,
    exportedAt: input.exportedAt,
    units: "millimeter",
    coordinateSystem: "right-handed-z-up",
  })
}

export async function writeVShapeV4(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeV4InputSchema.safeParse(inputValue)
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-document",
        message: "The V4 portable project input is invalid.",
      },
    }
  try {
    const bytes = encodeV2SemanticProject(input.data)
    const manifest = await createManifestV4(input.data, bytes)
    requireV4History({ ...input.data, manifest })
    const archive = encodeVShapeV2Archive(manifest, bytes)
    // Apply the same expansion, path, and ratio limits enforced by readers to writer output.
    await readSafeZip(archive, VSHAPE_LIMITS)
    return { ok: true, value: archive }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

async function decodeVShapeV4(files: UnzippedProjectFiles): Promise<VShapeProjectV4> {
  const paths = Object.keys(files)
  requireVShape(
    paths.length === V2_REQUIRED_PATHS.length &&
      V2_REQUIRED_PATHS.every((path) => paths.includes(path)),
    "undeclared-entry",
    "The V4 archive must contain exactly its declared entries.",
  )
  const parsed = vShapeManifestV4Schema.safeParse(parseManifestInput(files))
  requireVShape(parsed.success, "invalid-manifest", "The V4 manifest is invalid.")
  const manifest = parsed.data
  await requireV2SemanticIntegrity(manifest, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV3Schema, "invalid-document")
  const seed = parseJsonFile(
    files,
    V2_SEED_PATH,
    documentAuthoritySnapshotSchema.nullable(),
    "invalid-document",
  )
  const legacyEvents = parseNdjson(files, V2_LEGACY_PATH, documentEventSchema)
  const versionedEvents = parseNdjson(files, V2_SUFFIX_PATH, documentAuthorityEventSchema)
  const project = { manifest, snapshot, seed, legacyEvents, versionedEvents }
  requireV4History(project)
  return project
}

export async function readVShapeV4(bytes: unknown): Promise<VShapeResult<VShapeProjectV4>> {
  try {
    return { ok: true, value: await decodeVShapeV4(await readSafeZip(bytes, VSHAPE_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export type AuthoredVShapeProject =
  | VersionedVShapeProject
  | Readonly<{ version: 3; project: VShapeProjectV3 }>
  | Readonly<{ version: 4; project: VShapeProjectV4 }>
  | Readonly<{ version: 5; project: VShapeProjectV5 }>
  | Readonly<{ version: 6; project: VShapeProjectV6 }>
  | Readonly<{ version: 7; project: VShapeProjectV7 }>
export async function readAuthoredVShape(
  bytes: unknown,
): Promise<VShapeResult<AuthoredVShapeProject>> {
  try {
    const files = await readSafeZip(bytes, VSHAPE_V5_LIMITS)
    const header = parseManifestHeader(files)
    requireVShape(
      header.minimumReaderVersion <= 7,
      "unsupported-version",
      "This project requires a newer VibeShape reader.",
    )
    if (header.formatVersion === 7)
      return { ok: true, value: { version: 7, project: await decodeVShapeV7(files) } }
    if (header.formatVersion === 6)
      return { ok: true, value: { version: 6, project: await decodeVShapeV6(files) } }
    if (header.formatVersion === 5)
      return { ok: true, value: { version: 5, project: await decodeVShapeV5(files) } }
    if (header.formatVersion === 4)
      return { ok: true, value: { version: 4, project: await decodeVShapeV4(files) } }
    if (header.formatVersion === 3)
      return { ok: true, value: { version: 3, project: await decodeVShapeV3(files) } }
    if (header.formatVersion === 2)
      return { ok: true, value: { version: 2, project: await decodeVShapeV2(files) } }
    if (header.formatVersion === 1)
      return { ok: true, value: { version: 1, project: await decodeVShapeV1(files) } }
    if (header.formatVersion === 0)
      return { ok: true, value: { version: 0, project: await decodeVShape(files) } }
    throw new VShapeError("unsupported-version", "This project requires a newer VibeShape reader.")
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export const VSHAPE_V5_FORMAT_VERSION = 5 as const
const VSHAPE_V5_LIMITS = { ...VSHAPE_LIMITS, entryCount: 1029 }
const assetEntrySchema = z
  .object({
    digest: sourceAssetDigestSchema,
    bytes: z.number().int().positive().max(VSHAPE_LIMITS.entryBytes),
  })
  .strict()

export const vShapeManifestV5Schema = z
  .object({
    ...vShapeManifestV4Schema.shape,
    schemaVersion: z.literal(5),
    formatVersion: z.literal(5),
    minimumReaderVersion: z.literal(5),
    sourceUpgradeRevision: z.number().int().positive().safe(),
    assetEntries: z.array(assetEntrySchema).max(1024),
  })
  .strict()
  .superRefine((manifest, context) => {
    const { sourceUpgradeRevision, assetEntries, ...previous } = manifest
    const parsed = vShapeManifestV4Schema.safeParse({
      ...previous,
      schemaVersion: 4,
      formatVersion: 4,
      minimumReaderVersion: 4,
    })
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      sourceUpgradeRevision <= manifest.textureUpgradeRevision ||
      sourceUpgradeRevision > manifest.documentRevision
    )
      context.addIssue({
        code: "custom",
        message: "The source upgrade boundary must follow the authored upgrade.",
      })
    if (new Set(assetEntries.map((entry) => entry.digest)).size !== assetEntries.length)
      context.addIssue({
        code: "custom",
        message: "Every source digest must be declared exactly once.",
      })
  })
export type VShapeManifestV5 = Readonly<z.infer<typeof vShapeManifestV5Schema>>
export type VShapeProjectV5 = Readonly<{
  manifest: VShapeManifestV5
  snapshot: DocumentSnapshotV4
  seed: DocumentAuthoritySnapshot | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly DocumentAuthorityEvent[]
  assetBlobs: readonly SourceAssetBlob[]
}>
const writeVShapeV5InputSchema = z
  .object({
    ...writeVShapeV4InputSchema.shape,
    snapshot: documentSnapshotV4Schema,
    sourceUpgradeRevision: z.number().int().positive().safe(),
    assetBlobs: z.array(sourceAssetBlobSchema).max(1024),
  })
  .strict()

function requireV5History(project: VShapeProjectV5) {
  const { manifest, seed, snapshot, versionedEvents } = project
  const events = [...project.legacyEvents, ...versionedEvents]
  requireVShape(
    events.length <= MAX_EVENTS &&
      new Set(events.map((event) => event.commandId)).size === events.length,
    "history-mismatch",
    "The V5 journal exceeds its budget or repeats a command identity.",
  )
  requireVShape(
    snapshot.id === manifest.documentId &&
      snapshot.revision === manifest.documentRevision &&
      snapshot.createdAt === manifest.createdAt,
    "history-mismatch",
    "The V5 manifest and snapshot disagree.",
  )
  requireV4Seed(project)
  requireV5Upgrades(project)
  const replayed = replayDocumentAuthorityEvents(seed, versionedEvents)
  requireVShape(
    replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(snapshot),
    "history-mismatch",
    "The V5 journal does not reproduce its snapshot.",
  )
}

function upgradeBoundaryMatches(
  seedRevision: number | null,
  events: readonly DocumentAuthorityEvent[],
  type:
    | "org.vibeshape.document.upgraded-v2"
    | "org.vibeshape.document.upgraded-v3"
    | "org.vibeshape.document.upgraded-v4",
  revision: number,
) {
  const upgrades = events.filter((event) => event.type === type)
  if (seedRevision !== null) return revision <= seedRevision && upgrades.length === 0
  return upgrades.length === 1 && upgrades[0]?.revision === revision
}
function requireV5Upgrades({ manifest, seed, versionedEvents }: VShapeProjectV5) {
  const authoredSeed = seed && seed.schemaVersion !== 1 ? seed.revision : null
  const sourceSeed = seed?.schemaVersion === 4 ? seed.revision : null
  const authored = upgradeBoundaryMatches(
    authoredSeed,
    versionedEvents,
    "org.vibeshape.document.upgraded-v2",
    manifest.upgradeRevision,
  )
  const sources = upgradeBoundaryMatches(
    sourceSeed,
    versionedEvents,
    "org.vibeshape.document.upgraded-v4",
    manifest.sourceUpgradeRevision,
  )
  requireVShape(
    authored &&
      sources &&
      upgradeBoundaryMatches(
        seed && seed.schemaVersion >= 3 ? seed.revision : null,
        versionedEvents,
        "org.vibeshape.document.upgraded-v3",
        manifest.textureUpgradeRevision,
      ),
    "history-mismatch",
    "The V5 authority upgrade provenance is inconsistent.",
  )
}

async function requireV5AssetClosure(
  project: Pick<
    VShapeProjectV5 | VShapeProjectV6 | VShapeProjectV7,
    "seed" | "snapshot" | "versionedEvents" | "assetBlobs" | "manifest"
  >,
) {
  const closure = documentSourceAssetClosure(
    project.seed,
    project.versionedEvents,
    project.snapshot,
  )
  const sizes = new Map(closure.map((asset) => [asset.digest, asset.byteLength]))
  const blobs = new Map(project.assetBlobs.map((blob) => [blob.digest, blob.bytes]))
  const entries = new Map(project.manifest.assetEntries.map((entry) => [entry.digest, entry.bytes]))
  requireVShape(
    blobs.size === project.assetBlobs.length &&
      blobs.size === sizes.size &&
      entries.size === sizes.size,
    "integrity-mismatch",
    "The archive must contain the exact full-history source closure.",
  )
  for (const [digest, byteLength] of sizes) {
    const bytes = blobs.get(digest)
    requireVShape(
      bytes !== undefined &&
        bytes.byteLength === byteLength &&
        entries.get(digest) === byteLength &&
        (await sha256Bytes(bytes)) === digest,
      "integrity-mismatch",
      "A required historical source asset is missing or corrupt.",
    )
  }
}

function assetPath(digest: string) {
  return `assets/${digest}.bin`
}

export async function writeVShapeV5(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  const input = writeVShapeV5InputSchema.safeParse(inputValue)
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-document",
        message: "The V5 portable project input is invalid.",
      },
    }
  try {
    // Own the bytes across asynchronous digest verification and ZIP encoding.
    const assetBlobs = input.data.assetBlobs.map((blob) => ({
      digest: blob.digest,
      bytes: Uint8Array.from(blob.bytes),
    }))
    const bytes = encodeV2SemanticProject(input.data)
    const previous = await createManifestV4(
      {
        ...input.data,
        snapshot: documentSnapshotV3Schema.parse(
          projectDocumentSnapshotV4ToV3(input.data.snapshot),
        ),
      },
      bytes,
    )
    const manifest = vShapeManifestV5Schema.parse({
      ...previous,
      schemaVersion: 5,
      formatVersion: 5,
      minimumReaderVersion: 5,
      sourceUpgradeRevision: input.data.sourceUpgradeRevision,
      assetEntries: assetBlobs.map((blob) => ({
        digest: blob.digest,
        bytes: blob.bytes.byteLength,
      })),
    })
    const project = { ...input.data, assetBlobs, manifest }
    requireV5History(project)
    await requireV5AssetClosure(project)
    const files: Zippable = {
      [MANIFEST_PATH]: strToU8(canonicalJson(manifest)),
      [DOCUMENT_PATH]: bytes.document,
      [V2_SEED_PATH]: bytes.seed,
      [V2_LEGACY_PATH]: bytes.legacy,
      [V2_SUFFIX_PATH]: bytes.suffix,
    }
    // Stored sources remain readable even when their repetition exceeds the safe ZIP ratio.
    for (const blob of assetBlobs) files[assetPath(blob.digest)] = [blob.bytes, { level: 0 }]
    requireVShape(
      strToU8(canonicalJson(manifest)).byteLength <= MAX_MANIFEST_BYTES,
      "resource-limit",
      "The V5 manifest exceeds its byte budget.",
    )
    const archive = zipSync(files, { level: 6, mtime: ZIP_MTIME })
    await readSafeZip(archive, VSHAPE_V5_LIMITS)
    return { ok: true, value: archive }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

async function decodeVShapeV5(files: UnzippedProjectFiles): Promise<VShapeProjectV5> {
  const manifest = vShapeManifestV5Schema.safeParse(parseManifestInput(files))
  requireVShape(manifest.success, "invalid-manifest", "The V5 manifest is invalid.")
  const paths = [
    ...V2_REQUIRED_PATHS,
    ...manifest.data.assetEntries.map((entry) => assetPath(entry.digest)),
  ]
  requireVShape(
    Object.keys(files).length === paths.length && paths.every((path) => Object.hasOwn(files, path)),
    "undeclared-entry",
    "The V5 archive must contain exactly its declared entries.",
  )
  await requireV2SemanticIntegrity(manifest.data, files)
  const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV4Schema, "invalid-document")
  const seed = parseJsonFile(
    files,
    V2_SEED_PATH,
    documentAuthoritySnapshotSchema.nullable(),
    "invalid-document",
  )
  const legacyEvents = parseNdjson(files, V2_LEGACY_PATH, documentEventSchema)
  const versionedEvents = parseNdjson(files, V2_SUFFIX_PATH, documentAuthorityEventSchema)
  const assetBlobs = manifest.data.assetEntries.map((entry) =>
    sourceAssetBlobSchema.parse({ digest: entry.digest, bytes: files[assetPath(entry.digest)] }),
  )
  const project = {
    manifest: manifest.data,
    snapshot,
    seed,
    legacyEvents,
    versionedEvents,
    assetBlobs,
  }
  requireV5History(project)
  await requireV5AssetClosure(project)
  return project
}

export async function readVShapeV5(bytes: unknown): Promise<VShapeResult<VShapeProjectV5>> {
  try {
    return { ok: true, value: await decodeVShapeV5(await readSafeZip(bytes, VSHAPE_V5_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

export const vShapeManifestV6Schema = z
  .object({
    ...vShapeManifestV5Schema.shape,
    ...manifestVersionFields(6),
    repairUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((manifest, context) => {
    validateV2ManifestEntries(manifest, context)
    validateV2ManifestHistory(manifest, context)
    const boundaries = [
      manifest.upgradeRevision,
      manifest.textureUpgradeRevision,
      manifest.sourceUpgradeRevision,
      manifest.repairUpgradeRevision,
    ]
    if (
      !boundaries.every(
        (revision, index) =>
          revision <= manifest.documentRevision &&
          (index === 0 || revision >= (boundaries[index - 1] ?? revision)),
      )
    )
      context.addIssue({
        code: "custom",
        message: "The repair authority adoption boundaries must be ordered.",
      })
    if (
      new Set(manifest.assetEntries.map((entry) => entry.digest)).size !==
      manifest.assetEntries.length
    )
      context.addIssue({
        code: "custom",
        message: "Every source digest must be declared exactly once.",
      })
  })
export type VShapeProjectV6 = Readonly<{
  manifest: z.infer<typeof vShapeManifestV6Schema>
  snapshot: DocumentSnapshotV5
  seed: DocumentAuthoritySnapshot | null
  legacyEvents: readonly DocumentEvent[]
  versionedEvents: readonly DocumentAuthorityEvent[]
  assetBlobs: readonly SourceAssetBlob[]
}>
const writeVShapeV6InputSchema = z
  .object({
    ...writeVShapeV5InputSchema.shape,
    snapshot: documentSnapshotV5Schema,
    repairUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()
function requireV6History(project: RepairPortableProject) {
  const { snapshot, manifest } = project
  const events = [...project.legacyEvents, ...project.versionedEvents]
  requireVShape(
    events.length <= MAX_EVENTS &&
      new Set(events.map((event) => event.commandId)).size === events.length,
    "history-mismatch",
    "The V6 journal exceeds its budget or repeats a command identity.",
  )
  requireVShape(
    snapshot.id === manifest.documentId &&
      snapshot.revision === manifest.documentRevision &&
      snapshot.createdAt === manifest.createdAt,
    "history-mismatch",
    "The V6 manifest and snapshot disagree.",
  )
  requireV4Seed(project)
  requireVShape(
    validateRepairAuthorityBoundaries({ ...project, ...manifest }) === null,
    "history-mismatch",
    "The V6 adoption boundaries do not match its journal.",
  )
  if (snapshot.schemaVersion === 6) {
    requireVShape(
      "appearanceUpgradeRevision" in manifest,
      "history-mismatch",
      "Appearance authority requires its adoption boundary.",
    )
    requireVShape(
      validateAppearanceAuthorityBoundary({ ...project, ...manifest }) === null,
      "history-mismatch",
      "The appearance adoption boundary does not match its journal.",
    )
  }
  const replayed = replayDocumentAuthorityEvents(project.seed, project.versionedEvents)
  requireVShape(
    replayed.ok && canonicalJson(replayed.snapshot) === canonicalJson(snapshot),
    "history-mismatch",
    "The journal does not reproduce its authored authority.",
  )
}
async function writeRepairProject(
  inputValue: unknown,
  version: 6 | 7,
): Promise<VShapeResult<Uint8Array>> {
  const input = (version === 7 ? writeVShapeV7InputSchema : writeVShapeV6InputSchema).safeParse(
    inputValue,
  )
  if (!input.success)
    return {
      ok: false,
      diagnostic: {
        code: "invalid-document",
        message: "The authored portable project input is invalid.",
      },
    }
  try {
    const assetBlobs = input.data.assetBlobs.map((blob) => ({
      digest: blob.digest,
      bytes: Uint8Array.from(blob.bytes),
    }))
    const bytes = encodeV2SemanticProject(input.data)
    const previous = await createManifestV2(input.data, bytes)
    const manifest = (version === 7 ? vShapeManifestV7Schema : vShapeManifestV6Schema).parse({
      ...previous,
      schemaVersion: version,
      formatVersion: version,
      minimumReaderVersion: version,
      ...("appearanceUpgradeRevision" in input.data
        ? { appearanceUpgradeRevision: input.data.appearanceUpgradeRevision }
        : {}),
      upgradeRevision: input.data.upgradeRevision,
      textureUpgradeRevision: input.data.textureUpgradeRevision,
      sourceUpgradeRevision: input.data.sourceUpgradeRevision,
      repairUpgradeRevision: input.data.repairUpgradeRevision,
      assetEntries: assetBlobs.map((blob) => ({
        digest: blob.digest,
        bytes: blob.bytes.byteLength,
      })),
    })
    const project = { ...input.data, assetBlobs, manifest }
    requireV6History(project)
    await requireV5AssetClosure(project)
    const files: Zippable = {
      [MANIFEST_PATH]: strToU8(canonicalJson(manifest)),
      [DOCUMENT_PATH]: bytes.document,
      [V2_SEED_PATH]: bytes.seed,
      [V2_LEGACY_PATH]: bytes.legacy,
      [V2_SUFFIX_PATH]: bytes.suffix,
    }
    // Stored sources remain readable even when their repetition exceeds the safe ZIP ratio.
    for (const blob of assetBlobs) files[assetPath(blob.digest)] = [blob.bytes, { level: 0 }]
    requireVShape(
      strToU8(canonicalJson(manifest)).byteLength <= MAX_MANIFEST_BYTES,
      "resource-limit",
      "The V6 manifest exceeds its byte budget.",
    )
    const archive = zipSync(files, { level: 6, mtime: ZIP_MTIME })
    await readSafeZip(archive, VSHAPE_V5_LIMITS)
    return { ok: true, value: archive }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}
export async function writeVShapeV6(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  return writeRepairProject(inputValue, 6)
}
export async function writeVShapeV7(inputValue: unknown): Promise<VShapeResult<Uint8Array>> {
  return writeRepairProject(inputValue, 7)
}
function decodeRepairEntries(
  files: UnzippedProjectFiles,
  manifest: VShapeProjectV6["manifest"] | VShapeProjectV7["manifest"],
) {
  const paths = [
    ...V2_REQUIRED_PATHS,
    ...manifest.assetEntries.map((entry) => assetPath(entry.digest)),
  ]
  requireVShape(
    Object.keys(files).length === paths.length && paths.every((path) => Object.hasOwn(files, path)),
    "undeclared-entry",
    "The V6 archive must contain exactly its declared entries.",
  )
  return {
    seed: parseJsonFile(
      files,
      V2_SEED_PATH,
      documentAuthoritySnapshotSchema.nullable(),
      "invalid-document",
    ),
    legacyEvents: parseNdjson(files, V2_LEGACY_PATH, documentEventSchema),
    versionedEvents: parseNdjson(files, V2_SUFFIX_PATH, documentAuthorityEventSchema),
    assetBlobs: manifest.assetEntries.map((entry) =>
      sourceAssetBlobSchema.parse({ digest: entry.digest, bytes: files[assetPath(entry.digest)] }),
    ),
  }
}
async function decodeVShapeV6(files: UnzippedProjectFiles): Promise<VShapeProjectV6> {
  const parsed = vShapeManifestV6Schema.safeParse(parseManifestInput(files))
  requireVShape(parsed.success, "invalid-manifest", "The V6 manifest is invalid.")
  const manifest = parsed.data
  await requireV2SemanticIntegrity(manifest, files)
  const project = {
    ...decodeRepairEntries(files, manifest),
    manifest,
    snapshot: parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV5Schema, "invalid-document"),
  }
  requireV6History(project)
  await requireV5AssetClosure(project)
  return project
}
async function decodeVShapeV7(files: UnzippedProjectFiles): Promise<VShapeProjectV7> {
  const parsed = vShapeManifestV7Schema.safeParse(parseManifestInput(files))
  requireVShape(parsed.success, "invalid-manifest", "The V7 manifest is invalid.")
  const manifest = parsed.data
  await requireV2SemanticIntegrity(manifest, files)
  const project = {
    ...decodeRepairEntries(files, manifest),
    manifest,
    snapshot: parseJsonFile(files, DOCUMENT_PATH, documentSnapshotV6Schema, "invalid-document"),
  }
  requireV6History(project)
  await requireV5AssetClosure(project)
  return project
}
export async function readVShapeV6(bytes: unknown): Promise<VShapeResult<VShapeProjectV6>> {
  try {
    return { ok: true, value: await decodeVShapeV6(await readSafeZip(bytes, VSHAPE_V5_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}

/** V7 carries V6 authored appearance; older native readers reject its manifest before recovery. */
export const vShapeManifestV7Schema = z
  .object({
    ...vShapeManifestV6Schema.shape,
    ...manifestVersionFields(7),
    appearanceUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const { appearanceUpgradeRevision, ...previous } = manifest
    // The historical parser owns repair/source/entry invariants.
    const historical = vShapeManifestV6Schema.safeParse({
      ...previous,
      schemaVersion: 6,
      formatVersion: 6,
      minimumReaderVersion: 6,
    })
    if (!historical.success)
      for (const issue of historical.error.issues)
        context.addIssue({ code: "custom", path: issue.path, message: issue.message })
    if (
      appearanceUpgradeRevision < manifest.repairUpgradeRevision ||
      appearanceUpgradeRevision > manifest.documentRevision
    )
      context.addIssue({
        code: "custom",
        message: "Appearance adoption must follow repair authority within the saved history.",
      })
  })
export type VShapeProjectV7 = Readonly<
  Omit<VShapeProjectV6, "snapshot" | "manifest"> & {
    manifest: z.infer<typeof vShapeManifestV7Schema>
    snapshot: DocumentSnapshotV6
  }
>
type RepairPortableProject = Pick<VShapeProjectV6 | VShapeProjectV7, keyof VShapeProjectV6>
const writeVShapeV7InputSchema = z
  .object({
    ...writeVShapeV6InputSchema.shape,
    snapshot: documentSnapshotV6Schema,
    appearanceUpgradeRevision: z.number().int().positive().safe(),
  })
  .strict()
export async function readVShapeV7(bytes: unknown): Promise<VShapeResult<VShapeProjectV7>> {
  try {
    return { ok: true, value: await decodeVShapeV7(await readSafeZip(bytes, VSHAPE_V5_LIMITS)) }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}
