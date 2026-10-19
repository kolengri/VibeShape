import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPendingUpdateWork } from "./update-work"
import { createDesktopUpdateClient, type DesktopRelease } from "./updates"

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

describe("update shutdown work", () => {
  it("waits for aborted download cleanup before allowing exit and never publishes its partial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibeshape-update-shutdown-"))
    directories.push(directory)
    const destination = join(directory, "update.dmg")
    const bytes = new Uint8Array([1, 2, 3, 4])
    const release: DesktopRelease = {
      version: "2.0.0",
      fileName: "VibeShape-2.0.0-mac-arm64.dmg",
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: "https://github.com/kolengri/VibeShape/releases/download/desktop-v2.0.0/VibeShape-2.0.0-mac-arm64.dmg",
      releaseUrl: "https://github.com/kolengri/VibeShape/releases/tag/desktop-v2.0.0",
    }
    const cleanupStarted = deferred(),
      releaseCleanup = deferred()
    const client = createDesktopUpdateClient(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(bytes.subarray(0, 2))
            },
            cancel() {
              cleanupStarted.resolve()
              return releaseCleanup.promise
            },
          }),
        ),
    )
    const work = createPendingUpdateWork(),
      controller = new AbortController()
    const downloading = work.run(() =>
      client.downloadDesktopUpdate(release, destination, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    )
    void downloading.catch(() => undefined)
    let stopped = false
    try {
      await cleanupStarted.promise
      const files = await readdir(directory)
      expect(files).toHaveLength(1)
      expect(files[0]).toEndWith(".partial")
      const shutdown = work.stop().then(() => {
        stopped = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(stopped).toBe(false)
      releaseCleanup.resolve()
      await shutdown
      expect(stopped).toBe(true)
      await expect(downloading).rejects.toThrow()
      expect(await readdir(directory)).toEqual([])
    } finally {
      releaseCleanup.resolve()
      await work.stop()
    }
  })
  it("retains successful results, awaits rejected cleanup and rejects new work during shutdown", async () => {
    const work = createPendingUpdateWork()
    expect(await work.run(async () => 42)).toBe(42)
    const cleanup = deferred(),
      started = deferred()
    const failing = work.run(async () => {
      started.resolve()
      try {
        throw new Error("Fixture request failure")
      } finally {
        await cleanup.promise
      }
    })
    void failing.catch(() => undefined)
    await started.promise
    let stopped = false
    const shutdown = work.stop().then(() => {
      stopped = true
    })
    let launched = false
    await expect(
      work.run(async () => {
        launched = true
      }),
    ).rejects.toThrow("stopped")
    expect(launched).toBe(false)
    expect(stopped).toBe(false)
    cleanup.resolve()
    await shutdown
    await expect(failing).rejects.toThrow("Fixture request failure")
    await work.stop()
  })
})
