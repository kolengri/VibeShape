import {
  replayVersionedDocumentEvents,
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
import { documentIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { strFromU8, strToU8, type Zippable, zipSync } from "fflate"
import { z } from "zod"
import { readSafeZip, SafeZipError } from "./safe-zip"

export const VSHAPE_MEDIA_TYPE = "application/vnd.vibeshape.project+zip" as const
export const VSHAPE_FORMAT_VERSION = 0 as const
export const VSHAPE_V1_FORMAT_VERSION = 1 as const
export const VSHAPE_V2_FORMAT_VERSION = 2 as const
export const VSHAPE_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

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
  entryBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
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

async function requireV2SemanticIntegrity(manifest: VShapeManifestV2, files: UnzippedProjectFiles) {
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

function encodeV2SemanticProject(
  input: z.output<typeof writeVShapeV2InputSchema>,
): V2SemanticBytes {
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
  input: z.output<typeof writeVShapeV2InputSchema>,
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

function encodeVShapeV2Archive(manifest: VShapeManifestV2, bytes: V2SemanticBytes) {
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
