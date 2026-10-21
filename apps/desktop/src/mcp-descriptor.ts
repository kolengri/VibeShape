import { lstat, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import {
  type DesktopMcpDescriptor,
  desktopMcpDescriptorSchema,
} from "@vibeshape/automation-api/desktop-host"
import { preparePrivateDirectory, readPrivateFile, writePrivateFile } from "./private-files"

export async function publishMcpDescriptor(path: string, descriptor: DesktopMcpDescriptor) {
  const value = desktopMcpDescriptorSchema.parse(descriptor)
  preparePrivateDirectory(dirname(path))
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writePrivateFile(temporary, JSON.stringify(value))
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
  const buffer = await readPrivateFile(path, 4096)
  return desktopMcpDescriptorSchema.parse(JSON.parse(buffer.toString("utf8")))
}
