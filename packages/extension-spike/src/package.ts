import { strFromU8, unzipSync } from "fflate"
import { isError } from "is-what"
import { sha256Bytes } from "./hash"
import {
  type ExtensionManifest,
  type ExtensionSignature,
  extensionManifestSchema,
  extensionSignatureSchema,
} from "./schemas"

const ARCHIVE_LIMITS = {
  archiveBytes: 1 * 1024 * 1024,
  entryBytes: 512 * 1024,
  expandedBytes: 2 * 1024 * 1024,
  entryCount: 32,
  pathLength: 160,
  compressionRatio: 100,
} as const

type PackageDiagnosticCode =
  | "invalid-archive"
  | "unsafe-path"
  | "resource-limit"
  | "invalid-manifest"
  | "integrity-mismatch"
  | "undeclared-file"

interface ZipEntryMetadata {
  name: string
  compressedSize: number
  originalSize: number
  compression: number
}

export interface ValidatedExtensionPackage {
  archiveBytes: Uint8Array
  integrity: string
  manifestBytes: Uint8Array
  manifest: ExtensionManifest
  signature: ExtensionSignature | null
  files: Readonly<Record<string, Uint8Array>>
}

export type ExtensionPackageResult =
  | { ok: true; value: ValidatedExtensionPackage }
  | { ok: false; diagnostic: { code: PackageDiagnosticCode; message: string } }

class ExtensionPackageError extends Error {
  constructor(
    readonly code: PackageDiagnosticCode,
    message: string,
  ) {
    super(message)
  }
}

function requirePackage(
  condition: boolean,
  code: PackageDiagnosticCode,
  message: string,
): asserts condition {
  if (!condition) throw new ExtensionPackageError(code, message)
}

function viewOf(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = viewOf(bytes)
  const lowerBound = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) return offset
  }
  throw new ExtensionPackageError("invalid-archive", "The ZIP directory footer is missing.")
}

function normalizedPackagePath(name: string, normalizedNames: Set<string>) {
  const segments = name.split("/")
  const normalized = name.normalize("NFC")
  const safe = [
    name.length > 0,
    name.length <= ARCHIVE_LIMITS.pathLength,
    normalized === name,
    !name.startsWith("/"),
    !name.includes("\\"),
    !name.includes("\0"),
    !name.endsWith("/"),
    segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
  ].every(Boolean)
  requirePackage(safe, "unsafe-path", `Unsafe extension path: ${name || "<empty>"}.`)
  const collisionKey = normalized.toLocaleLowerCase("en-US")
  requirePackage(
    !normalizedNames.has(collisionKey),
    "unsafe-path",
    `Duplicate normalized extension path: ${name}.`,
  )
  normalizedNames.add(collisionKey)
  return normalized
}

function isUnixSymlink(versionMadeBy: number, externalAttributes: number) {
  const hostSystem = versionMadeBy >>> 8
  const unixMode = externalAttributes >>> 16
  return hostSystem === 3 && (unixMode & 0o170000) === 0o120000
}

function parseZipEntry(bytes: Uint8Array, offset: number, normalizedNames: Set<string>) {
  const view = viewOf(bytes)
  requirePackage(
    offset + 46 <= bytes.byteLength,
    "invalid-archive",
    "Truncated ZIP directory entry.",
  )
  requirePackage(
    view.getUint32(offset, true) === 0x0201_4b50,
    "invalid-archive",
    "Invalid ZIP directory entry.",
  )
  const versionMadeBy = view.getUint16(offset + 4, true)
  const flags = view.getUint16(offset + 8, true)
  const compression = view.getUint16(offset + 10, true)
  const compressedSize = view.getUint32(offset + 20, true)
  const originalSize = view.getUint32(offset + 24, true)
  const nameLength = view.getUint16(offset + 28, true)
  const extraLength = view.getUint16(offset + 30, true)
  const commentLength = view.getUint16(offset + 32, true)
  const externalAttributes = view.getUint32(offset + 38, true)
  const nextOffset = offset + 46 + nameLength + extraLength + commentLength
  requirePackage(nextOffset <= bytes.byteLength, "invalid-archive", "Truncated ZIP entry name.")
  requirePackage((flags & 1) === 0, "invalid-archive", "Encrypted ZIP entries are unsupported.")
  requirePackage(
    compression === 0 || compression === 8,
    "invalid-archive",
    "Unsupported ZIP compression method.",
  )
  requirePackage(
    !isUnixSymlink(versionMadeBy, externalAttributes),
    "unsafe-path",
    "Symbolic links are forbidden in extension packages.",
  )
  const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
  const name = normalizedPackagePath(
    new TextDecoder("utf-8", { fatal: true }).decode(nameBytes),
    normalizedNames,
  )
  return {
    metadata: { name, compressedSize, originalSize, compression } satisfies ZipEntryMetadata,
    nextOffset,
  }
}

function inspectZipDirectory(bytes: Uint8Array) {
  requirePackage(
    bytes.byteLength <= ARCHIVE_LIMITS.archiveBytes,
    "resource-limit",
    "The extension archive exceeds the compressed-size limit.",
  )
  const view = viewOf(bytes)
  const footerOffset = findEndOfCentralDirectory(bytes)
  const entryCount = view.getUint16(footerOffset + 10, true)
  const directorySize = view.getUint32(footerOffset + 12, true)
  const directoryOffset = view.getUint32(footerOffset + 16, true)
  const commentLength = view.getUint16(footerOffset + 20, true)
  requirePackage(commentLength === 0, "invalid-archive", "ZIP archive comments are unsupported.")
  requirePackage(entryCount > 0, "invalid-archive", "The extension archive is empty.")
  requirePackage(
    entryCount <= ARCHIVE_LIMITS.entryCount,
    "resource-limit",
    "The extension archive has too many entries.",
  )
  requirePackage(
    directoryOffset + directorySize === footerOffset,
    "invalid-archive",
    "The ZIP central directory bounds are invalid.",
  )
  const normalizedNames = new Set<string>()
  const entries: ZipEntryMetadata[] = []
  let offset = directoryOffset
  let expandedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    const parsed = parseZipEntry(bytes, offset, normalizedNames)
    entries.push(parsed.metadata)
    offset = parsed.nextOffset
    expandedBytes += parsed.metadata.originalSize
    requirePackage(
      parsed.metadata.originalSize <= ARCHIVE_LIMITS.entryBytes,
      "resource-limit",
      `Extension entry exceeds its size limit: ${parsed.metadata.name}.`,
    )
    const ratio = parsed.metadata.originalSize / Math.max(1, parsed.metadata.compressedSize)
    requirePackage(
      ratio <= ARCHIVE_LIMITS.compressionRatio,
      "resource-limit",
      `Extension entry exceeds the compression-ratio limit: ${parsed.metadata.name}.`,
    )
  }
  requirePackage(offset === footerOffset, "invalid-archive", "The ZIP entry count is inconsistent.")
  requirePackage(
    expandedBytes <= ARCHIVE_LIMITS.expandedBytes,
    "resource-limit",
    "The extension archive exceeds the expanded-size limit.",
  )
  return entries
}

function extractInspectedFiles(bytes: Uint8Array, entries: readonly ZipEntryMetadata[]) {
  const metadata = new Map(entries.map((entry) => [entry.name, entry]))
  return unzipSync(bytes, {
    filter(file) {
      const inspected = metadata.get(file.name)
      const matches = [
        inspected !== undefined,
        inspected?.compressedSize === file.size,
        inspected?.originalSize === file.originalSize,
        inspected?.compression === file.compression,
      ].every(Boolean)
      requirePackage(matches, "invalid-archive", "ZIP metadata changed during extraction.")
      return true
    },
  })
}

function parseManifest(files: Record<string, Uint8Array>) {
  const manifestBytes = files["vibeshape-extension.json"]
  requirePackage(
    manifestBytes !== undefined,
    "invalid-manifest",
    "The extension manifest is missing.",
  )
  try {
    return {
      manifestBytes,
      manifest: extensionManifestSchema.parse(JSON.parse(strFromU8(manifestBytes))),
    }
  } catch (error) {
    if (error instanceof ExtensionPackageError) throw error
    throw new ExtensionPackageError("invalid-manifest", "The extension manifest is invalid.")
  }
}

function parseSignature(files: Record<string, Uint8Array>) {
  const bytes = files["signature.json"]
  if (!bytes) return null
  try {
    return extensionSignatureSchema.parse(JSON.parse(strFromU8(bytes)))
  } catch {
    throw new ExtensionPackageError(
      "invalid-manifest",
      "The extension signature envelope is invalid.",
    )
  }
}

function requireDeclaredFiles(manifest: ExtensionManifest, files: Record<string, Uint8Array>) {
  const archiveFiles = Object.keys(files).filter(
    (name) => name !== "vibeshape-extension.json" && name !== "signature.json",
  )
  const declaredFiles = Object.keys(manifest.files)
  requirePackage(
    [
      archiveFiles.length === declaredFiles.length,
      declaredFiles.every((name) => archiveFiles.includes(name)),
    ].every(Boolean),
    "undeclared-file",
    "Every extension file must be declared exactly once.",
  )
  requirePackage(
    Object.values(manifest.entrypoints)
      .filter((path): path is string => path !== undefined)
      .every((path) => declaredFiles.includes(path)),
    "invalid-manifest",
    "Every extension entry point must be declared.",
  )
  requirePackage(
    declaredFiles.includes("LICENSE"),
    "invalid-manifest",
    "A LICENSE file is required.",
  )
}

async function requireFileIntegrity(
  manifest: ExtensionManifest,
  files: Record<string, Uint8Array>,
) {
  for (const [name, checksum] of Object.entries(manifest.files)) {
    const bytes = files[name]
    requirePackage(
      bytes !== undefined,
      "undeclared-file",
      `Declared extension file is missing: ${name}.`,
    )
    requirePackage(
      (await sha256Bytes(bytes)) === checksum,
      "integrity-mismatch",
      `Extension file checksum mismatch: ${name}.`,
    )
  }
}

function packageDiagnostic(error: unknown) {
  if (error instanceof ExtensionPackageError) return { code: error.code, message: error.message }
  return {
    code: "invalid-archive" as const,
    message: isError(error)
      ? "The extension archive could not be decoded."
      : "Invalid extension archive.",
  }
}

export async function validateExtensionPackage(
  bytesInput: unknown,
): Promise<ExtensionPackageResult> {
  if (!(bytesInput instanceof Uint8Array)) {
    return { ok: false, diagnostic: { code: "invalid-archive", message: "Expected ZIP bytes." } }
  }
  const archiveBytes = Uint8Array.from(bytesInput)
  try {
    const entries = inspectZipDirectory(archiveBytes)
    const files = extractInspectedFiles(archiveBytes, entries)
    const { manifestBytes, manifest } = parseManifest(files)
    requireDeclaredFiles(manifest, files)
    await requireFileIntegrity(manifest, files)
    return {
      ok: true,
      value: {
        archiveBytes,
        integrity: await sha256Bytes(archiveBytes),
        manifestBytes,
        manifest,
        signature: parseSignature(files),
        files,
      },
    }
  } catch (error) {
    return { ok: false, diagnostic: packageDiagnostic(error) }
  }
}
