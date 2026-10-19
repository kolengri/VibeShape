import { constants } from "node:fs"
import { lstat, mkdir, open, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import {
  type DesktopMcpDescriptor,
  desktopMcpDescriptorSchema,
} from "@vibeshape/automation-api/desktop-host"

export async function publishMcpDescriptor(path: string, descriptor: DesktopMcpDescriptor) {
  const value = desktopMcpDescriptorSchema.parse(descriptor)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify(value))
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
  const owned = await lstat(path)
  return async () => {
    const current = await lstat(path).catch(() => null)
    if (current?.ino === owned.ino && current.dev === owned.dev) await rm(path, { force: true })
  }
}

export async function readMcpDescriptor(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (
      !metadata.isFile() ||
      metadata.size > 4096 ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid())
    )
      throw new Error("The desktop MCP descriptor must be a private file owned by this user.")
    const buffer = Buffer.alloc(4097)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== metadata.size || bytesRead > 4096)
      throw new Error("The desktop MCP descriptor is invalid.")
    return desktopMcpDescriptorSchema.parse(
      JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")),
    )
  } finally {
    await file.close()
  }
}
