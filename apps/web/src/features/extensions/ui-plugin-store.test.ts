import { describe, expect, it } from "bun:test"
import { readUiPluginPackage } from "./ui-plugin-package"
import { sampleUiPlugin } from "./ui-plugin-sample"
import { createUiPluginStore } from "./ui-plugin-store"

const key = "vibeshape-ui-plugins-v1"
async function sample(suffix = "") {
  const result = await readUiPluginPackage(
    new TextEncoder().encode(`${JSON.stringify(sampleUiPlugin)}${suffix}`),
  )
  if (!result.ok) throw new Error(result.error)
  return result.value
}
function memory() {
  const entries = new Map<string, string>()
  let failWrites = false
  return {
    entries,
    fail: () => {
      failWrites = true
    },
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("Quota")
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}
async function ready(store: ReturnType<typeof createUiPluginStore>) {
  const stop = store.start()
  for (let attempts = 0; store.getSnapshot().status === "loading" && attempts < 100; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 0))
  return stop
}

function sharedMutationLock() {
  type Operation = Parameters<NonNullable<Parameters<typeof createUiPluginStore>[2]>>[0]
  let queue = Promise.resolve()
  let gate: { entered: () => void; released: Promise<void> } | null = null
  const lock = (operation: Operation) => {
    const result = queue.then(async () => {
      const current = gate
      gate = null
      if (current) {
        current.entered()
        await current.released
      }
      return operation()
    })
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const pauseNext = () => {
    let entered!: () => void
    let release!: () => void
    const entry = new Promise<void>((resolve) => {
      entered = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    gate = { entered, released }
    return { entered: entry, release }
  }
  return { lock, pauseNext }
}

describe("local UI plugin installation ownership", () => {
  it("serializes two-tab install, revocation, and reset under the shared mutation lock", async () => {
    const storage = memory()
    const shared = sharedMutationLock()
    const first = createUiPluginStore(storage, undefined, shared.lock)
    const second = createUiPluginStore(storage, undefined, shared.lock)
    const stopFirst = await ready(first)
    const stopSecond = await ready(second)
    const original = await sample()
    await first.install(original, ["ui.command", "ui.panel"])
    const changed = await readUiPluginPackage(
      new TextEncoder().encode(JSON.stringify({ ...sampleUiPlugin, version: "1.0.1" })),
    )
    if (!changed.ok) throw new Error(changed.error)
    const gate = shared.pauseNext()
    const revoking = first.setEnabled(original.integrity, false)
    await gate.entered
    const installing = second.install(changed.value, ["ui.command", "ui.panel"])
    gate.release()
    expect(await revoking).toEqual({ ok: true, value: undefined })
    expect(await installing).toEqual({ ok: true, value: undefined })
    expect(second.getSnapshot().plugins).toHaveLength(2)
    expect(
      second.getSnapshot().plugins.find((entry) => entry.package.integrity === original.integrity)
        ?.enabled,
    ).toBe(false)
    const resettingGate = shared.pauseNext()
    const resetting = first.reset()
    await resettingGate.entered
    const reinstalling = second.install(original, ["ui.command", "ui.panel"])
    resettingGate.release()
    expect(await resetting).toEqual({ ok: true, value: undefined })
    expect(await reinstalling).toEqual({ ok: true, value: undefined })
    expect(second.getSnapshot().plugins.map((entry) => entry.package.integrity)).toEqual([
      original.integrity,
    ])
    stopFirst()
    stopSecond()
  })

  it("keeps reads available and rejects writes when the host cannot provide a mutation lock", async () => {
    const storage = memory()
    const store = createUiPluginStore(storage, undefined, async () => ({
      ok: false,
      error: "storage-unavailable",
    }))
    const stop = await ready(store)
    expect(store.getSnapshot().status).toBe("ready")
    const pkg = await sample()
    expect(await store.install(pkg, ["ui.command", "ui.panel"])).toEqual({
      ok: false,
      error: "storage-unavailable",
    })
    expect(await store.reset()).toEqual({ ok: false, error: "storage-unavailable" })
    expect(storage.entries.size).toBe(0)
    stop()
  })
  it("requires both reviewed grants, persists exact content, and survives reload without launching panels", async () => {
    const storage = memory()
    const store = createUiPluginStore(storage)
    const stop = await ready(store)
    const pkg = await sample()
    expect(await store.install(pkg, [])).toEqual({ ok: false, error: "permission-denied" })
    expect(storage.entries.size).toBe(0)
    expect(await store.install(pkg, ["ui.command", "ui.panel"])).toEqual({
      ok: true,
      value: undefined,
    })
    expect(store.authorized(pkg.integrity, "ui.panel")).toBe(true)
    stop()
    const reopened = createUiPluginStore(storage)
    const stopReopened = await ready(reopened)
    expect(reopened.getSnapshot().plugins).toHaveLength(1)
    expect(reopened.getSnapshot().plugins[0]?.package.source).toBe(pkg.source)
    expect(reopened.authorized(pkg.integrity, "ui.command")).toBe(true)
    stopReopened()
  })

  it("rejects changed bytes under the same ID/version and detects a forged prepared integrity", async () => {
    const store = createUiPluginStore(memory())
    const stop = await ready(store)
    const pkg = await sample()
    await store.install(pkg, ["ui.command", "ui.panel"])
    expect(await store.install(await sample("\n"), ["ui.command", "ui.panel"])).toEqual({
      ok: false,
      error: "identity-conflict",
    })
    expect(
      await store.install({ ...pkg, integrity: "0".repeat(64) }, ["ui.command", "ui.panel"]),
    ).toEqual({ ok: false, error: "integrity-mismatch" })
    expect(store.getSnapshot().plugins[0]?.package.integrity).toBe(pkg.integrity)
    stop()
  })

  it("revokes authorization immediately for disable/remove and across tabs before refresh", async () => {
    const storage = memory()
    const first = createUiPluginStore(storage)
    const stopFirst = await ready(first)
    const pkg = await sample()
    await first.install(pkg, ["ui.command", "ui.panel"])
    const second = createUiPluginStore(storage)
    const stopSecond = await ready(second)
    await second.setEnabled(pkg.integrity, false)
    expect(first.authorized(pkg.integrity, "ui.panel")).toBe(false)
    expect(second.authorized(pkg.integrity, "ui.panel")).toBe(false)
    await second.setEnabled(pkg.integrity, true)
    expect(second.authorized(pkg.integrity, "ui.panel")).toBe(true)
    await second.remove(pkg.integrity)
    expect(second.authorized(pkg.integrity, "ui.panel")).toBe(false)
    expect(second.getSnapshot().plugins).toHaveLength(0)
    stopFirst()
    stopSecond()
  })

  it("fails closed on corrupted or excessive storage and resets only plugin-owned data", async () => {
    for (const raw of [
      "{",
      " ".repeat(1_100_001),
      JSON.stringify({ schemaVersion: 99, plugins: [] }),
    ]) {
      const storage = memory()
      storage.entries.set(key, raw)
      storage.entries.set("unrelated-project", "preserve")
      const store = createUiPluginStore(storage)
      const stop = await ready(store)
      expect(store.getSnapshot().status).toBe("error")
      expect(store.authorized("0".repeat(64), "ui.panel")).toBe(false)
      expect(await store.reset()).toEqual({ ok: true, value: undefined })
      expect(store.getSnapshot().status).toBe("ready")
      expect(storage.entries.get("unrelated-project")).toBe("preserve")
      stop()
    }
  })

  it("revalidates persisted checksums and leaves the previous installation after a failed save", async () => {
    const storage = memory()
    const store = createUiPluginStore(storage)
    const stop = await ready(store)
    const pkg = await sample()
    await store.install(pkg, ["ui.command", "ui.panel"])
    const original = storage.entries.get(key)
    storage.fail()
    expect(await store.setEnabled(pkg.integrity, false)).toEqual({
      ok: false,
      error: "storage-unavailable",
    })
    expect(storage.entries.get(key)).toBe(original)
    expect(store.authorized(pkg.integrity, "ui.panel")).toBe(true)
    storage.entries.set(key, (original ?? "").replace(pkg.integrity, "0".repeat(64)))
    expect(await store.setEnabled(pkg.integrity, false)).toEqual({
      ok: false,
      error: "invalid-store",
    })
    expect(store.getSnapshot().status).toBe("error")
    const corrupted = createUiPluginStore(storage)
    const stopCorrupted = await ready(corrupted)
    expect(corrupted.getSnapshot().error).toBe("invalid-store")
    stop()
    stopCorrupted()
  })
})
