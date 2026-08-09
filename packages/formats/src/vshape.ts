import { canonicalJson } from "@vibeshape/domain/canonical-json"
import {
  type DocumentEvent,
  documentEventSchema,
  replayDocumentEvents,
} from "@vibeshape/domain/commands"
import { type DocumentSnapshot, documentSnapshotSchema } from "@vibeshape/domain/document"
import { documentIdSchema, timestampSchema } from "@vibeshape/domain/identifiers"
import { strFromU8, strToU8, type Zippable, zipSync } from "fflate"
import { z } from "zod"
import { readSafeZip, SafeZipError } from "./safe-zip"

export const VSHAPE_MEDIA_TYPE = "application/vnd.vibeshape.project+zip" as const
export const VSHAPE_FORMAT_VERSION = 0 as const
export const VSHAPE_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

const MANIFEST_PATH = "manifest.json"
const DOCUMENT_PATH = "document.json"
const JOURNAL_PATH = "journal/events.jsonl"
const REQUIRED_PATHS = [MANIFEST_PATH, DOCUMENT_PATH, JOURNAL_PATH] as const
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0)
const MAX_EVENTS = 100_000
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
const semanticEntrySchema = z
  .object({
    path: semanticPathSchema,
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

export const vShapeManifestSchema = z
  .object({
    schemaVersion: z.literal(0),
    format: z.literal("vshape"),
    formatVersion: z.literal(VSHAPE_FORMAT_VERSION),
    minimumReaderVersion: z.literal(VSHAPE_FORMAT_VERSION),
    documentId: documentIdSchema,
    documentRevision: z.number().int().positive().safe(),
    createdBy: z
      .object({
        application: z.string().min(1).max(120),
        version: z.string().min(1).max(64),
        build: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    engine: engineSchema.nullable(),
    rootDocument: z.literal(DOCUMENT_PATH),
    eventJournal: z.literal(JOURNAL_PATH),
    compression: z.literal("deflate"),
    semanticEntries: z.array(semanticEntrySchema).length(2),
    requiredCapabilities: z.array(z.string().min(1).max(120)).max(64),
    extensionsLockChecksum: sha256Schema.nullable(),
    createdAt: timestampSchema,
    exportedAt: timestampSchema,
    units: z.literal("millimeter"),
    coordinateSystem: z.literal("right-handed-z-up"),
  })
  .strict()
  .superRefine((manifest, context) => {
    const entries = new Map(manifest.semanticEntries.map((entry) => [entry.path, entry]))
    if (entries.size !== 2) {
      context.addIssue({
        code: "custom",
        path: ["semanticEntries"],
        message: "Every semantic project entry must be declared exactly once.",
      })
    }
    if (entries.get(DOCUMENT_PATH)?.mediaType !== "application/json") {
      context.addIssue({
        code: "custom",
        path: ["semanticEntries"],
        message: "The root document must use application/json.",
      })
    }
    if (entries.get(JOURNAL_PATH)?.mediaType !== "application/x-ndjson") {
      context.addIssue({
        code: "custom",
        path: ["semanticEntries"],
        message: "The event journal must use application/x-ndjson.",
      })
    }
  })

const writeVShapeInputSchema = z
  .object({
    snapshot: documentSnapshotSchema,
    events: z.array(documentEventSchema).min(1).max(MAX_EVENTS),
    exportedAt: timestampSchema,
    createdBy: z
      .object({
        application: z.string().min(1).max(120),
        version: z.string().min(1).max(64),
        build: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    engine: engineSchema.nullable().default(null),
  })
  .strict()

const vShapeManifestHeaderSchema = z
  .object({
    format: z.literal("vshape"),
    formatVersion: z.number().int().nonnegative().safe(),
    minimumReaderVersion: z.number().int().nonnegative().safe(),
  })
  .passthrough()

export type VShapeManifest = Readonly<z.infer<typeof vShapeManifestSchema>>
export type VShapeEngine = Readonly<z.infer<typeof engineSchema>>
export type VShapeProject = Readonly<{
  manifest: VShapeManifest
  snapshot: DocumentSnapshot
  events: readonly DocumentEvent[]
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

function encodeSemanticProject(snapshot: DocumentSnapshot, events: readonly DocumentEvent[]) {
  return {
    documentBytes: strToU8(canonicalJson(snapshot)),
    journalBytes: strToU8(`${events.map(canonicalJson).join("\n")}\n`),
  }
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

function decodeUtf8(bytes: Uint8Array, code: "invalid-document" | "invalid-manifest") {
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

async function requireSemanticIntegrity(manifest: VShapeManifest, files: UnzippedProjectFiles) {
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

function requireManifestRelationship(manifest: VShapeManifest, snapshot: DocumentSnapshot) {
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

export async function readVShape(bytes: unknown): Promise<VShapeResult<VShapeProject>> {
  try {
    const files = await readSafeZip(bytes, VSHAPE_LIMITS)
    requireExactEntries(files)
    const manifest = parseManifest(files)
    await requireSemanticIntegrity(manifest, files)
    const snapshot = parseJsonFile(files, DOCUMENT_PATH, documentSnapshotSchema, "invalid-document")
    const events = parseJournal(files)
    requireManifestRelationship(manifest, snapshot)
    requirePortableHistory(snapshot, events)
    return { ok: true, value: { manifest, snapshot, events } }
  } catch (error) {
    return { ok: false, diagnostic: vShapeDiagnostic(error) }
  }
}
