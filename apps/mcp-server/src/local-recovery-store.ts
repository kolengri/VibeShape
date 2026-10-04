import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  localConnectResponseSchema,
  localDocumentSchema,
} from "@vibeshape/automation-api/local-session"
import { z } from "zod"

export const localRecoveryRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: z.string().url(),
    connection: localConnectResponseSchema,
    document: localDocumentSchema,
    previousResume: z
      .object({
        token: localConnectResponseSchema.shape.token,
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type LocalRecoveryRecord = z.infer<typeof localRecoveryRecordSchema>
export type LocalRecoveryStore = {
  load: () => LocalRecoveryRecord | null
  save: (record: LocalRecoveryRecord) => void
  clear: () => void
}

/** The local launcher owns recovery credentials; project files never contain them. */
export function createLocalRecoveryStore(
  origin: string,
  file = join(
    process.env.VIBESHAPE_LOCAL_RECOVERY_DIRECTORY ??
      join(homedir(), ".local", "state", "vibeshape", "local-mcp"),
    `${new URL(origin).port}.json`,
  ),
): LocalRecoveryStore {
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const parent = lstatSync(directory)
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0)
    throw new Error("Local MCP recovery requires a private directory owned by the current user.")
  function validateFile() {
    try {
      const stat = lstatSync(file)
      if (!privateFile(stat, parent.uid))
        throw new Error("The local MCP recovery file is not private.")
      return stat
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      throw error
    }
  }
  return {
    load() {
      if (!validateFile()) return null
      const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = fstatSync(handle)
        if (!privateFile(stat, parent.uid) || stat.size > 16_384) return null
        const parsed = localRecoveryRecordSchema.safeParse(JSON.parse(readFileSync(handle, "utf8")))
        return parsed.success && parsed.data.origin === origin ? parsed.data : null
      } catch {
        return null
      } finally {
        closeSync(handle)
      }
    },
    save(record) {
      validateFile()
      const value = localRecoveryRecordSchema.parse(record)
      if (value.origin !== origin) throw new Error("The recovery origin changed.")
      const temporary = `${file}.${randomUUID()}.tmp`
      const handle = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      )
      try {
        writeFileSync(handle, JSON.stringify(value))
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      try {
        renameSync(temporary, file)
      } catch (error) {
        try {
          unlinkSync(temporary)
        } catch {
          /* Preserve the original storage failure. */
        }
        throw error
      }
    },
    clear() {
      if (!validateFile()) return
      let invalidated = false
      let handle: number | undefined
      try {
        handle = openSync(file, constants.O_WRONLY | constants.O_NOFOLLOW)
        if (!privateFile(fstatSync(handle), parent.uid))
          throw new Error("The local MCP recovery file is not private.")
        writeFileSync(handle, "null")
        ftruncateSync(handle, 4)
        fsyncSync(handle)
        invalidated = true
      } catch {
        // Removing a read-only file can still revoke its durable authority.
      } finally {
        if (handle !== undefined) closeSync(handle)
      }
      try {
        unlinkSync(file)
      } catch (error) {
        if (!invalidated) throw error
      }
    },
  }
}

function privateFile(stat: Stats, owner: number) {
  return stat.isFile() && stat.nlink === 1 && stat.uid === owner && (stat.mode & 0o077) === 0
}
