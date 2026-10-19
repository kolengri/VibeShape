import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { publishVerifiedUpdate } from "./update-publication"
import { createPendingUpdateWork } from "./update-work"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-update-publication-"))
  roots.push(root)
  const source = join(root, ".verified.partial"),
    destination = join(root, "update.dmg")
  const bytes = Buffer.from("Verified update fixture")
  await writeFile(source, bytes, { mode: 0o600 })
  return { source, destination, bytes }
}
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("portable verified update publication", () => {
  it("copies to a distinct private file without requiring hard links", async () => {
    const context = await fixture()
    await publishVerifiedUpdate(context.source, context.destination, new AbortController().signal)
    expect(await readFile(context.destination)).toEqual(context.bytes)
    expect((await stat(context.destination)).mode & 0o777).toBe(0o600)
    expect((await stat(context.destination)).ino).not.toBe((await stat(context.source)).ino)
  })
  it("removes its incomplete visible destination after a failed copy", async () => {
    const context = await fixture()
    await expect(
      publishVerifiedUpdate(
        context.source,
        context.destination,
        new AbortController().signal,
        async (_source, file) => {
          await file.writeFile("Incomplete copy")
          throw new Error("Fixture write failure")
        },
      ),
    ).rejects.toThrow("Fixture write failure")
    await expect(stat(context.destination)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(context.source)).toEqual(context.bytes)
  })
  it("preserves a different file that replaces the destination during a failed copy", async () => {
    const context = await fixture()
    await expect(
      publishVerifiedUpdate(
        context.source,
        context.destination,
        new AbortController().signal,
        async (_source, file) => {
          await file.writeFile("Incomplete copy")
          await unlink(context.destination)
          await writeFile(context.destination, "User replacement")
          throw new Error("Fixture write failure")
        },
      ),
    ).rejects.toThrow("Fixture write failure")
    expect(await readFile(context.destination, "utf8")).toBe("User replacement")
  })
  it("waits for actual publication I/O and its owned cleanup when quit aborts the copy", async () => {
    const context = await fixture(),
      started = deferred(),
      release = deferred()
    const work = createPendingUpdateWork(),
      controller = new AbortController()
    const publishing = work.run(() =>
      publishVerifiedUpdate(
        context.source,
        context.destination,
        controller.signal,
        async (_source, file, signal) => {
          await file.writeFile("Incomplete copy")
          started.resolve()
          await release.promise
          signal.throwIfAborted()
        },
      ),
    )
    void publishing.catch(() => undefined)
    try {
      await started.promise
      controller.abort()
      let settled = false
      const stopping = work.stop().then(() => {
        settled = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(await readFile(context.destination, "utf8")).toBe("Incomplete copy")
      release.resolve()
      await stopping
      await expect(publishing).rejects.toThrow()
      await expect(stat(context.destination)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(context.source)).toEqual(context.bytes)
    } finally {
      release.resolve()
      await work.stop()
    }
  })
})
