import { mkdir, mkdtemp, readFile, stat, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { cleanupStaleHandoffFiles, createHandoffFileStore } from "./handoff-files"

describe("slicer handoff temporary files", () => {
  it("writes owned bytes below the dedicated temporary directory", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "vibeshape-handoff-files-"))
    const persisted = await createHandoffFileStore(baseDirectory).persist(
      "Bracket.3mf",
      new Uint8Array([80, 75, 3, 4]),
    )

    expect(persisted.path.startsWith(join(baseDirectory, "handoff-"))).toBe(true)
    expect(new Uint8Array(await readFile(persisted.path))).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it("removes only stale bridge-owned directories", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "vibeshape-handoff-cleanup-"))
    const staleDirectory = join(baseDirectory, "handoff-stale")
    const unrelatedDirectory = join(baseDirectory, "unrelated")
    await mkdir(staleDirectory)
    await mkdir(unrelatedDirectory)
    const staleTime = new Date("2026-08-01T00:00:00.000Z")
    await utimes(staleDirectory, staleTime, staleTime)

    await cleanupStaleHandoffFiles(baseDirectory, Date.parse("2026-08-03T00:00:00.001Z"))

    await expect(stat(staleDirectory)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(stat(unrelatedDirectory)).resolves.toBeDefined()
  })
})
