import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isError } from "is-what"

const HANDOFF_DIRECTORY_PREFIX = "handoff-"
const RETAIN_HANDOFF_MS = 12 * 60 * 60 * 1_000
const STALE_HANDOFF_MS = 24 * 60 * 60 * 1_000

export type PersistedHandoffFile = Readonly<{
  path: string
  scheduleCleanup(): void
}>

export type HandoffFileStore = Readonly<{
  persist(filename: string, bytes: Uint8Array): Promise<PersistedHandoffFile>
}>

export function defaultHandoffDirectory() {
  return join(tmpdir(), "vibeshape-slicer-handoff")
}

async function directoryUsage(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true })
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const details = await lstat(join(directory, entry.name))
    if (!details.isFile()) continue
    files += 1
    bytes += details.size
  }
  return { files, bytes }
}

export async function getHandoffFileUsage(baseDirectory = defaultHandoffDirectory()) {
  const entries = await readdir(baseDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if (isError(error) && Reflect.get(error, "code") === "ENOENT") return []
    throw error
  })
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(HANDOFF_DIRECTORY_PREFIX)) continue
    const usage = await directoryUsage(join(baseDirectory, entry.name))
    files += usage.files
    bytes += usage.bytes
  }
  return { files, bytes }
}

export async function cleanupStaleHandoffFiles(
  baseDirectory = defaultHandoffDirectory(),
  now = Date.now(),
) {
  const entries = await readdir(baseDirectory, { withFileTypes: true, encoding: "utf8" }).catch(
    () => [],
  )
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || !entry.name.startsWith(HANDOFF_DIRECTORY_PREFIX)) return
      const path = join(baseDirectory, entry.name)
      const details = await stat(path).catch(() => null)
      if (!details || now - details.mtimeMs <= STALE_HANDOFF_MS) return
      await rm(path, { recursive: true, force: true })
    }),
  )
}

export function createHandoffFileStore(
  baseDirectory = defaultHandoffDirectory(),
): HandoffFileStore {
  return {
    async persist(filename, bytes) {
      await mkdir(baseDirectory, { recursive: true, mode: 0o700 })
      const directory = join(baseDirectory, `${HANDOFF_DIRECTORY_PREFIX}${randomUUID()}`)
      await mkdir(directory, { mode: 0o700 })
      const path = join(directory, filename)
      try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 })
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return {
        path,
        scheduleCleanup() {
          const timer = setTimeout(() => {
            void rm(directory, { recursive: true, force: true }).catch(() => undefined)
          }, RETAIN_HANDOFF_MS)
          timer.unref()
        },
      }
    },
  }
}
