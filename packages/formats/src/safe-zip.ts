import { strFromU8, strToU8, unzip, type Unzipped } from "fflate"

export type SafeZipDiagnosticCode = "invalid-archive" | "resource-limit" | "unsafe-path"

export class SafeZipError extends Error {
  constructor(
    readonly code: SafeZipDiagnosticCode,
    message: string,
  ) {
    super(message)
  }
}

export type SafeZipLimits = Readonly<{
  archiveBytes: number
  entryBytes: number
  expandedBytes: number
  entryCount: number
  pathLength: number
  compressionRatio: number
}>

type ZipEntryMetadata = Readonly<{
  name: string
  compressedSize: number
  originalSize: number
  compression: number
}>

function requireZip(
  condition: boolean,
  code: SafeZipDiagnosticCode,
  message: string,
): asserts condition {
  if (!condition) throw new SafeZipError(code, message)
}

function viewOf(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function decodeCanonicalUtf8(bytes: Uint8Array) {
  const value = strFromU8(bytes)
  const encoded = strToU8(value)
  const matches =
    encoded.byteLength === bytes.byteLength && encoded.every((byte, index) => byte === bytes[index])
  requireZip(matches, "unsafe-path", "The archive contains an invalid UTF-8 path.")
  return value
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = viewOf(bytes)
  const lowerBound = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) return offset
  }
  throw new SafeZipError("invalid-archive", "The ZIP directory footer is missing.")
}

function normalizedArchivePath(name: string, normalizedNames: Set<string>, pathLength: number) {
  const segments = name.split("/")
  const normalized = name.normalize("NFC")
  const safe = [
    name.length > 0,
    name.length <= pathLength,
    normalized === name,
    !name.startsWith("/"),
    !name.includes("\\"),
    !name.includes("\0"),
    !name.endsWith("/"),
    segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
  ].every(Boolean)
  requireZip(safe, "unsafe-path", `Unsafe archive path: ${name || "<empty>"}.`)
  const collisionKey = normalized.toLocaleLowerCase("en-US")
  requireZip(
    !normalizedNames.has(collisionKey),
    "unsafe-path",
    `Duplicate normalized archive path: ${name}.`,
  )
  normalizedNames.add(collisionKey)
  return normalized
}

function isUnixSymlink(versionMadeBy: number, externalAttributes: number) {
  const hostSystem = versionMadeBy >>> 8
  const unixMode = externalAttributes >>> 16
  return hostSystem === 3 && (unixMode & 0o170000) === 0o120000
}

function parseZipEntry(
  bytes: Uint8Array,
  offset: number,
  normalizedNames: Set<string>,
  pathLength: number,
) {
  const view = viewOf(bytes)
  requireZip(offset + 46 <= bytes.byteLength, "invalid-archive", "Truncated ZIP directory entry.")
  requireZip(
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
  requireZip(nextOffset <= bytes.byteLength, "invalid-archive", "Truncated ZIP entry name.")
  requireZip((flags & 1) === 0, "invalid-archive", "Encrypted ZIP entries are unsupported.")
  requireZip(
    compression === 0 || compression === 8,
    "invalid-archive",
    "Unsupported ZIP compression method.",
  )
  requireZip(
    !isUnixSymlink(versionMadeBy, externalAttributes),
    "unsafe-path",
    "Symbolic links are forbidden in project archives.",
  )
  const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
  const name = decodeCanonicalUtf8(nameBytes)
  return {
    metadata: {
      name: normalizedArchivePath(name, normalizedNames, pathLength),
      compressedSize,
      originalSize,
      compression,
    } satisfies ZipEntryMetadata,
    nextOffset,
  }
}

function inspectZipDirectory(bytes: Uint8Array, limits: SafeZipLimits) {
  requireZip(
    bytes.byteLength <= limits.archiveBytes,
    "resource-limit",
    "The archive exceeds the compressed-size limit.",
  )
  const view = viewOf(bytes)
  const footerOffset = findEndOfCentralDirectory(bytes)
  const diskNumber = view.getUint16(footerOffset + 4, true)
  const directoryDisk = view.getUint16(footerOffset + 6, true)
  const diskEntryCount = view.getUint16(footerOffset + 8, true)
  const entryCount = view.getUint16(footerOffset + 10, true)
  const directorySize = view.getUint32(footerOffset + 12, true)
  const directoryOffset = view.getUint32(footerOffset + 16, true)
  const commentLength = view.getUint16(footerOffset + 20, true)
  requireZip(
    diskNumber === 0 && directoryDisk === 0 && diskEntryCount === entryCount,
    "invalid-archive",
    "Multi-disk ZIP archives are unsupported.",
  )
  requireZip(commentLength === 0, "invalid-archive", "ZIP archive comments are unsupported.")
  requireZip(entryCount > 0, "invalid-archive", "The project archive is empty.")
  requireZip(
    entryCount <= limits.entryCount,
    "resource-limit",
    "The project archive has too many entries.",
  )
  requireZip(
    directoryOffset + directorySize === footerOffset,
    "invalid-archive",
    "The ZIP central directory bounds are invalid.",
  )
  const normalizedNames = new Set<string>()
  const entries: ZipEntryMetadata[] = []
  let offset = directoryOffset
  let expandedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    const parsed = parseZipEntry(bytes, offset, normalizedNames, limits.pathLength)
    entries.push(parsed.metadata)
    offset = parsed.nextOffset
    expandedBytes += parsed.metadata.originalSize
    requireZip(
      parsed.metadata.originalSize <= limits.entryBytes,
      "resource-limit",
      `Archive entry exceeds its size limit: ${parsed.metadata.name}.`,
    )
    const ratio = parsed.metadata.originalSize / Math.max(1, parsed.metadata.compressedSize)
    requireZip(
      ratio <= limits.compressionRatio,
      "resource-limit",
      `Archive entry exceeds the compression-ratio limit: ${parsed.metadata.name}.`,
    )
  }
  requireZip(offset === footerOffset, "invalid-archive", "The ZIP entry count is inconsistent.")
  requireZip(
    expandedBytes <= limits.expandedBytes,
    "resource-limit",
    "The archive exceeds the expanded-size limit.",
  )
  return entries
}

function extractInspectedFiles(bytes: Uint8Array, entries: readonly ZipEntryMetadata[]) {
  const metadata = new Map(entries.map((entry) => [entry.name, entry]))
  return new Promise<Unzipped>((resolve, reject) => {
    try {
      unzip(
        bytes,
        {
          filter(file) {
            const inspected = metadata.get(file.name)
            const matches = [
              inspected !== undefined,
              inspected?.compressedSize === file.size,
              inspected?.originalSize === file.originalSize,
              inspected?.compression === file.compression,
            ].every(Boolean)
            requireZip(matches, "invalid-archive", "ZIP metadata changed during extraction.")
            return true
          },
        },
        (error, files) => {
          if (error) reject(new SafeZipError("invalid-archive", "The ZIP payload is invalid."))
          else resolve(files)
        },
      )
    } catch (error) {
      reject(error)
    }
  })
}

export async function readSafeZip(bytesInput: unknown, limits: SafeZipLimits) {
  if (!(bytesInput instanceof Uint8Array)) {
    throw new SafeZipError("invalid-archive", "Expected ZIP bytes.")
  }
  const bytes = Uint8Array.from(bytesInput)
  const entries = inspectZipDirectory(bytes, limits)
  return extractInspectedFiles(bytes, entries)
}
