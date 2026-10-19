import { afterEach, describe, expect, it } from "bun:test"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  cleanupStaleHandoffFiles,
  createHandoffFileStore,
  getHandoffFileUsage,
} from "./handoff-files"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-handoff-files-"))
  roots.push(root)
  return root
}

describe("slicer handoff temporary files", () => {
  it("writes owned bytes below the dedicated temporary directory", async () => {
    const baseDirectory = await directory()
    const persisted = await createHandoffFileStore(baseDirectory).persist(
      "Bracket.3mf",
      new Uint8Array([80, 75, 3, 4]),
    )

    expect(persisted.path.startsWith(join(baseDirectory, "handoff-"))).toBe(true)
    expect(new Uint8Array(await readFile(persisted.path))).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it("removes only stale bridge-owned directories", async () => {
    const baseDirectory = await directory()
    const staleDirectory = join(baseDirectory, "handoff-stale")
    const retainedDirectory = join(baseDirectory, "handoff-retained")
    const unrelatedDirectory = join(baseDirectory, "unrelated")
    await mkdir(staleDirectory)
    await mkdir(retainedDirectory)
    await mkdir(unrelatedDirectory)
    await writeFile(join(staleDirectory, "Stale.3mf"), new Uint8Array(8))
    await writeFile(join(retainedDirectory, "Retained.3mf"), new Uint8Array(4))
    const staleTime = new Date("2026-08-01T00:00:00.000Z")
    const retainedTime = new Date("2026-08-02T06:00:00.001Z")
    await utimes(staleDirectory, staleTime, staleTime)
    await utimes(retainedDirectory, retainedTime, retainedTime)

    expect(await getHandoffFileUsage(baseDirectory)).toEqual({ files: 2, bytes: 12 })

    await cleanupStaleHandoffFiles(baseDirectory, Date.parse("2026-08-03T00:00:00.001Z"))

    await expect(stat(staleDirectory)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(stat(retainedDirectory)).resolves.toBeDefined()
    await expect(stat(unrelatedDirectory)).resolves.toBeDefined()
    expect(await getHandoffFileUsage(baseDirectory)).toEqual({ files: 1, bytes: 4 })
  })

  it("counts owned regular files without traversing foreign directories or symlinks", async () => {
    const baseDirectory = await directory()
    const foreignDirectory = await directory()
    const ownedDirectory = join(baseDirectory, "handoff-owned")
    await mkdir(ownedDirectory)
    await mkdir(join(baseDirectory, "unrelated"))
    await writeFile(join(baseDirectory, "unrelated", "Foreign.3mf"), new Uint8Array(32))
    await writeFile(join(baseDirectory, "handoff-loose-file"), new Uint8Array(32))
    const foreign = join(foreignDirectory, "Foreign.3mf")
    await writeFile(foreign, new Uint8Array(64))
    await symlink(foreignDirectory, join(baseDirectory, "handoff-linked-directory"))
    await symlink(foreign, join(ownedDirectory, "Linked.3mf"))
    await writeFile(join(ownedDirectory, "First.3mf"), new Uint8Array(4))
    await writeFile(join(ownedDirectory, "Second.stl"), new Uint8Array(7))

    expect(await getHandoffFileUsage(baseDirectory)).toEqual({ files: 2, bytes: 11 })
    expect((await stat(foreign)).size).toBe(64)
  })

  it("treats a missing base as empty and rejects inspection failures", async () => {
    const baseDirectory = await directory()
    expect(await getHandoffFileUsage(join(baseDirectory, "missing"))).toEqual({
      files: 0,
      bytes: 0,
    })
    const file = join(baseDirectory, "not-a-directory")
    await writeFile(file, "file")
    await expect(getHandoffFileUsage(file)).rejects.toMatchObject({ code: "ENOTDIR" })
  })

  it.skipIf(process.getuid?.() === 0)("rejects unreadable owned directories", async () => {
    const baseDirectory = await directory()
    const ownedDirectory = join(baseDirectory, "handoff-unreadable")
    await mkdir(ownedDirectory)
    await writeFile(join(ownedDirectory, "Bracket.3mf"), new Uint8Array(4))
    await chmod(ownedDirectory, 0)
    try {
      await expect(getHandoffFileUsage(baseDirectory)).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await chmod(ownedDirectory, 0o700)
    }
  })
})
