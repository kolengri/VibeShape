// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Extrudo c05d910395f514f4810d3fc76504ce6bb1c73da8; see NOTICE.md.
/**
 * The `.f3d` container: a ZIP archive. Entries are stored, deflated or (since
 * 2025) Zstandard-compressed (method 93), which fflate does not read, so the
 * central directory is walked here and each entry inflated by its own method.
 *
 * The file is untrusted: a crafted archive can declare a huge size, hold a
 * decompression bomb or point two entries at one local header. Every limit
 * below is enforced before the bytes are inflated, and only the entries the
 * importer actually reads are decompressed at all.
 */
import { Inflate } from "fflate"
import { Decompress as ZstdDecompress } from "fzstd"
import { F3dFormatError } from "./bytes"
import { F3dTextDecoder } from "./text-decoder"

export type Entries = ReadonlyMap<string, Uint8Array>

/** The most one entry may declare, and inflate to. */
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
/** The most all entries together may declare, and inflate to. */
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
/** The most entries an archive may hold. */
const MAX_ENTRIES = 4096
/**
 * The most an entry may declare per compressed byte. The files' entries
 * unpack to at most 16 times their compressed size (MetaStream/BulkStream
 * 15.8, B-rep streams 10.8); a bomb gets far past this.
 */
const MAX_RATIO = 200
/** The largest Zstandard window a frame may ask for (the files use 2 MB). */
const MAX_ZSTD_WINDOW = 32 * 1024 * 1024
/** Compressed bytes fed to the inflater at a time: a deflate chunk unpacks to at most about 1,000 times its size. */
const CHUNK = 4 * 1024

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/**
 * The entries the import reads: the design streams, the B-rep streams and the
 * preview. Everything else is skipped rather than decompressed (H3).
 */
const READ_ENTRY = /(?:^|\/)(?:MetaStream\.dat|BulkStream\.dat)$|\.smbh?$/

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))

/**
 * Decompresses one entry into a buffer of its declared size, streaming, so it
 * stops as soon as the data runs past that size, and checks it fills it
 * exactly. Nothing is allocated before the declared size is plausible for the
 * compressed bytes.
 */
function decodeCompressed(
  data: Uint8Array,
  method: number,
  name: string,
  take: (chunk: Uint8Array) => void,
) {
  try {
    if (method === 8) {
      const stream = new Inflate(take)
      for (let i = 0; i === 0 || i < data.length; i += CHUNK)
        stream.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length)
    } else new ZstdDecompress(take).push(data, true)
  } catch (error) {
    if (error instanceof F3dFormatError) throw error
    throw new F3dFormatError(`Bad compressed data in ${name}: ${(error as Error).message}`)
  }
}
function inflate(data: Uint8Array, method: number, size: number, name: string): Uint8Array {
  if (method === 0) return data
  if (method !== 8 && method !== 93)
    throw new F3dFormatError(`Unsupported ZIP compression method ${method} for ${name}.`)
  if (size > data.length * MAX_RATIO + 4096)
    throw new F3dFormatError(
      `Bad ZIP: ${name} claims to unpack to ${size} bytes from ${data.length} (more than ${MAX_RATIO} to 1).`,
    )
  if (method === 93) zstdFrame(data, size, name)
  const out = new Uint8Array(size)
  let at = 0
  const take = (chunk: Uint8Array) => {
    if (at + chunk.length > size)
      throw new F3dFormatError(`Bad ZIP: ${name} unpacks to more than its declared ${size} bytes.`)
    out.set(chunk, at)
    at += chunk.length
  }
  decodeCompressed(data, method, name, take)
  if (at !== size) throw new F3dFormatError(`Wrong size after decompressing ${name}.`)
  return out
}

/**
 * Checks a Zstandard entry is one frame, without a dictionary, whose window is
 * at most `MAX_ZSTD_WINDOW` and whose content size (when given) is the declared
 * one: the decoder allocates the window from the header's few bytes, and a
 * further frame would allocate another unchecked. Walks the block headers.
 */
function zstdFrame(data: Uint8Array, size: number, name: string): void {
  const bad = (why: string) => new F3dFormatError(`Bad Zstandard data in ${name}: ${why}.`)
  const u = (at: number, n: number) => {
    if (at + n > data.length) throw bad("it ends early")
    let v = 0
    for (let i = 0; i < n; i++) v += (data[at + i] as number) * 2 ** (8 * i)
    return v
  }
  if (u(0, 4) !== 0xfd2fb528) throw bad("not a Zstandard frame")
  const flags = u(4, 1)
  const single = (flags >> 5) & 1
  const sizeBytes = flags >> 6 ? 1 << (flags >> 6) : single
  if (flags & 0x0b) throw bad("a dictionary or a reserved bit")
  function readWindow() {
    let p = 5
    let window = 0
    if (!single) {
      const descriptor = u(p++, 1)
      const base = 2 ** (10 + (descriptor >> 3))
      window = base + (base / 8) * (descriptor & 7)
    }
    if (sizeBytes) {
      const content = u(p, sizeBytes) + (sizeBytes === 2 ? 256 : 0)
      if (content !== size) throw bad(`it holds ${content} bytes, not ${size}`)
      if (single) window = content
      p += sizeBytes
    }
    if (window > MAX_ZSTD_WINDOW) throw bad(`a ${window}-byte window`)

    return p
  }
  let p = readWindow()
  for (let last = 0; !last; ) {
    const header = u(p, 3)
    last = header & 1
    const type = (header >> 1) & 3
    if (type === 3) throw bad("a reserved block type")
    p += 3 + (type === 1 ? 1 : header >> 3)
  }
  if (flags & 4) p += 4 // the checksum
  if (p !== data.length) throw bad("more than one frame")
}

interface ZipEntry {
  name: string
  flags: number
  method: number
  compressed: number
  size: number
  crc: number
  local: number
}
function zipEnd(bytes: Uint8Array, view: DataView) {
  if (bytes.length < 22)
    throw new F3dFormatError("Not a ZIP archive (no end of central directory).")
  function findEnd() {
    let end = -1
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === EOCD) {
        end = i
        break
      }
    }
    if (end < 0) throw new F3dFormatError("Not a ZIP archive (no end of central directory).")

    return end
  }
  const end = findEnd()
  if (end + 22 + view.getUint16(end + 20, true) !== bytes.length)
    throw new F3dFormatError("Invalid ZIP end record.")
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    throw new F3dFormatError("Unsupported split ZIP archive.")
  const count = view.getUint16(end + 10, true)
  if (count !== view.getUint16(end + 8, true))
    throw new F3dFormatError("Unsupported split ZIP archive.")
  if (count > MAX_ENTRIES)
    throw new F3dFormatError(
      `This .f3d file has too many entries (${count}; the limit is ${MAX_ENTRIES}).`,
    )
  const start = view.getUint32(end + 16, true)
  if (start + view.getUint32(end + 12, true) !== end)
    throw new F3dFormatError("Bad ZIP central directory extent.")
  return { start, end, count }
}
function validateName(name: string, names: Set<string>) {
  if (
    !name ||
    name.includes("\\") ||
    /^(?:[A-Za-z]:|\/)/.test(name) ||
    Array.from(name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new F3dFormatError("Unsafe ZIP entry path.")
  if (name.split("/").some((part) => part === ".." || part === "."))
    throw new F3dFormatError("Unsafe ZIP entry path.")
  if (names.has(name)) throw new F3dFormatError("Duplicate ZIP entry path.")
  names.add(name)
}
function centralEntry(bytes: Uint8Array, view: DataView, at: number, end: number) {
  if (at + 46 > end || view.getUint32(at, true) !== CENTRAL)
    throw new F3dFormatError("Bad ZIP central directory.")
  const flags = view.getUint16(at + 8, true)
  if (flags & 0x41) throw new F3dFormatError("Encrypted F3D archives are unsupported.")
  if (view.getUint16(at + 34, true) !== 0)
    throw new F3dFormatError("Unsupported split ZIP archive.")
  const nameLength = view.getUint16(at + 28, true)
  const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  if (next > end) throw new F3dFormatError("Bad ZIP central directory.")
  const entry: ZipEntry = {
    name: new F3dTextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    flags,
    method: view.getUint16(at + 10, true),
    compressed: view.getUint32(at + 20, true),
    size: view.getUint32(at + 24, true),
    crc: view.getUint32(at + 16, true),
    local: view.getUint32(at + 42, true),
  }
  return { entry, next }
}
function readDirectory(bytes: Uint8Array, view: DataView) {
  const directory = zipEnd(bytes, view)
  let at = directory.start
  let total = 0
  const names = new Set<string>()
  const entries: ZipEntry[] = []
  for (let i = 0; i < directory.count; i++) {
    const { entry, next } = centralEntry(bytes, view, at, directory.end)
    at = next
    validateName(entry.name, names)
    if (entry.size > MAX_ENTRY_BYTES)
      throw new F3dFormatError(
        `This .f3d file is too large to import (${entry.name} unpacks to more than ${mb(MAX_ENTRY_BYTES)} MB).`,
      )
    total += entry.size
    if (total > MAX_TOTAL_BYTES)
      throw new F3dFormatError(
        `This .f3d file is too large to import (its entries unpack to more than ${mb(MAX_TOTAL_BYTES)} MB).`,
      )
    entries.push(entry)
  }
  if (at !== directory.end)
    throw new F3dFormatError("ZIP entry count does not match its directory.")
  return { start: directory.start, entries }
}
function localRange(bytes: Uint8Array, view: DataView, entry: ZipEntry, centralStart: number) {
  const { name, local, flags, method } = entry
  if (local + 30 > centralStart || view.getUint32(local, true) !== LOCAL)
    throw new F3dFormatError(`Bad ZIP local header for ${name}.`)
  if (view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags)
    throw new F3dFormatError(`ZIP local compression or flags disagree for ${name}.`)
  const nameLength = view.getUint16(local + 26, true)
  const start = local + 30 + nameLength + view.getUint16(local + 28, true)
  const end = start + entry.compressed
  if (end > centralStart) throw new F3dFormatError(`Bad ZIP local header for ${name}.`)
  const localName = new F3dTextDecoder("utf-8").decode(
    bytes.subarray(local + 30, local + 30 + nameLength),
  )
  if (localName !== name)
    throw new F3dFormatError(`Bad ZIP: ${name} does not match its local header.`)
  return { local, start, end, entry }
}

/** Only required design/B-rep streams are inflated; no path is extracted to disk. */
export function unzip(bytes: Uint8Array): Entries {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const directory = readDirectory(bytes, view)
  const ranges = directory.entries
    .map((entry) => localRange(bytes, view, entry, directory.start))
    .sort((a, b) => a.local - b.local)
  const out = new Map<string, Uint8Array>()
  let previousEnd = 0
  for (const range of ranges) {
    if (range.local < previousEnd)
      throw new F3dFormatError("ZIP entries overlap or share a local header.")
    previousEnd = range.end
    const { entry } = range
    if (!READ_ENTRY.test(entry.name)) continue
    const content = inflate(
      bytes.subarray(range.start, range.end),
      entry.method,
      entry.size,
      entry.name,
    )
    if (content.length !== entry.size)
      throw new F3dFormatError(`Wrong size after decompressing ${entry.name}.`)
    if (crc32(content) !== entry.crc)
      throw new F3dFormatError(`Bad ZIP checksum for ${entry.name}.`)
    out.set(entry.name, content)
  }
  return out
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 255] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

/** One design segment: its record stream and the index that describes it. */
export interface SegmentFiles {
  /** The folder the two streams are in, e.g. `…AssetName[Active]/Design1`. */
  folder: string
  meta: Uint8Array
  bulk: Uint8Array
}

/** Asset prefix shared by semantic and exact B-rep reads, including root-level Design1. */
export function designAssetPrefix(folder: string): string {
  const slash = folder.lastIndexOf("/")
  return slash < 0 ? "" : folder.slice(0, slash + 1)
}

/**
 * The Design segments of an archive: `Design1/` in older files,
 * `…DesignSegmentType1/` since 2025. The component-tree segment
 * (`…ACTSegmentType1/`) is not a design segment.
 */
export function designSegments(entries: Entries): SegmentFiles[] {
  const out: SegmentFiles[] = []
  for (const [name, meta] of entries) {
    if (!name.endsWith("/MetaStream.dat")) continue
    const folder = name.slice(0, -"/MetaStream.dat".length)
    const leaf = folder.slice(folder.lastIndexOf("/") + 1)
    if (!/^(Design\d+|[A-Za-z]*DesignSegmentType\d+)$/.test(leaf)) continue
    const bulk = entries.get(`${folder}/BulkStream.dat`)
    if (!bulk) throw new F3dFormatError(`${folder} has no BulkStream.dat.`)
    out.push({ folder, meta, bulk })
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder))
}
