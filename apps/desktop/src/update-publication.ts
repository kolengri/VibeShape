import { createReadStream, type Stats } from "node:fs"
import { type FileHandle, lstat, open, rm } from "node:fs/promises"
import { pipeline } from "node:stream/promises"

type Copy = (source: string, destination: FileHandle, signal: AbortSignal) => Promise<void>
const copy: Copy = async (source, destination, signal) => {
  await pipeline(createReadStream(source), destination.createWriteStream(), { signal })
}
async function removeOwnedDestination(path: string, owned: Stats) {
  const current = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (current?.ino === owned.ino && current.dev === owned.dev) await rm(path, { force: true })
}

/** Exclusive stream copy is portable but non-atomic; Ready must wait for copy and close. */
export async function publishVerifiedUpdate(
  source: string,
  destination: string,
  signal: AbortSignal,
  copyBytes: Copy = copy,
) {
  signal.throwIfAborted()
  const file = await open(destination, "wx", 0o600)
  let owned: Stats | undefined
  let complete = false
  try {
    owned = await file.stat()
    await copyBytes(source, file, signal)
    signal.throwIfAborted()
    await file.close()
    complete = true
  } finally {
    try {
      await file.close()
    } finally {
      if (!complete && owned) await removeOwnedDestination(destination, owned)
    }
  }
}
