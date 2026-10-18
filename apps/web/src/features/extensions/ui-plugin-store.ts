import { z } from "zod"
import { parseUiPluginJson } from "./ui-plugin-json"
import {
  readUiPluginPackage,
  type UiPluginCapability,
  type UiPluginError,
  type UiPluginPackage,
  type UiPluginResult,
  uiPluginCapabilitySchema,
} from "./ui-plugin-package"

const STORAGE_KEY = "vibeshape-ui-plugins-v1"
const STORE_BYTES = 1_100_000
const persistedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  plugins: z
    .array(
      z.strictObject({
        source: z.string().max(64 * 1024),
        integrity: z.string().regex(/^[0-9a-f]{64}$/),
        enabled: z.boolean(),
        grants: z
          .array(uiPluginCapabilitySchema)
          .length(2)
          .refine((grants) => new Set(grants).size === 2),
      }),
    )
    .max(16),
})

export type InstalledUiPlugin = Readonly<{
  package: UiPluginPackage
  enabled: boolean
  grants: readonly UiPluginCapability[]
}>
type StoreSnapshot = Readonly<{
  status: "loading" | "ready" | "error"
  plugins: readonly InstalledUiPlugin[]
  error: UiPluginError | null
}>
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">
type MutationOperation = () => Promise<UiPluginResult<undefined>>
type MutationLock = (operation: MutationOperation) => Promise<UiPluginResult<undefined>>

function decodeStoreEnvelope(raw: string | null): UiPluginResult<z.infer<typeof persistedSchema>> {
  if (raw === null) return { ok: true, value: { schemaVersion: 1, plugins: [] } }
  if (raw.length > STORE_BYTES || new TextEncoder().encode(raw).byteLength > STORE_BYTES)
    return { ok: false, error: "invalid-store" }
  let decoded: unknown
  try {
    decoded = parseUiPluginJson(raw)
  } catch {
    return { ok: false, error: "invalid-store" }
  }
  const parsed = persistedSchema.safeParse(decoded)
  if (!parsed.success) return { ok: false, error: "invalid-store" }
  return { ok: true, value: parsed.data }
}

async function decodeStoredPlugin(
  entry: z.infer<typeof persistedSchema>["plugins"][number],
): Promise<UiPluginResult<InstalledUiPlugin>> {
  const pkg = await readUiPluginPackage(new TextEncoder().encode(entry.source))
  if (!pkg.ok || pkg.value.integrity !== entry.integrity)
    return { ok: false, error: "invalid-store" }
  return { ok: true, value: { package: pkg.value, enabled: entry.enabled, grants: entry.grants } }
}

async function decodeStore(
  raw: string | null,
): Promise<UiPluginResult<readonly InstalledUiPlugin[]>> {
  const parsed = decodeStoreEnvelope(raw)
  if (!parsed.ok) return parsed
  const plugins: InstalledUiPlugin[] = []
  const identities = new Set<string>()
  for (const entry of parsed.value.plugins) {
    const decoded = await decodeStoredPlugin(entry)
    if (!decoded.ok) return decoded
    const manifest = decoded.value.package.manifest
    const identity = `${manifest.id}@${manifest.version}`
    if (identities.has(identity)) return { ok: false, error: "invalid-store" }
    identities.add(identity)
    plugins.push(decoded.value)
  }
  return { ok: true, value: plugins }
}

export function createUiPluginStore(
  storage: StoragePort,
  storageEvents?: (changed: () => void) => () => void,
  withMutationLock: MutationLock = (operation) => operation(),
) {
  let snapshot: StoreSnapshot = { status: "loading", plugins: [], error: null }
  let stamp: string | null = null
  let generation = 0
  let queue = Promise.resolve()
  const listeners = new Set<() => void>()
  const publish = (next: StoreSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const read = async () => {
    try {
      const raw = storage.getItem(STORAGE_KEY)
      return { raw, result: await decodeStore(raw) }
    } catch {
      return { raw: null, result: { ok: false, error: "storage-unavailable" } as const }
    }
  }
  const refresh = async () => {
    const current = ++generation
    publish({ status: "loading", plugins: [], error: null })
    const loaded = await read()
    if (current !== generation) return
    stamp = loaded.raw
    publish(
      loaded.result.ok
        ? { status: "ready", plugins: loaded.result.value, error: null }
        : { status: "error", plugins: [], error: loaded.result.error },
    )
  }
  const write = (
    plugins: readonly InstalledUiPlugin[],
    expected: string | null,
  ): UiPluginResult<undefined> => {
    if (plugins.length > 16) return { ok: false, error: "store-full" }
    const raw = JSON.stringify({
      schemaVersion: 1,
      plugins: plugins.map((entry) => ({
        source: entry.package.source,
        integrity: entry.package.integrity,
        enabled: entry.enabled,
        grants: entry.grants,
      })),
    })
    if (new TextEncoder().encode(raw).byteLength > STORE_BYTES)
      return { ok: false, error: "store-full" }
    try {
      if (storage.getItem(STORAGE_KEY) !== expected) return { ok: false, error: "stale-store" }
      storage.setItem(STORAGE_KEY, raw)
      if (storage.getItem(STORAGE_KEY) !== raw) return { ok: false, error: "stale-store" }
      stamp = raw
      ++generation
      publish({ status: "ready", plugins, error: null })
      return { ok: true, value: undefined }
    } catch {
      return { ok: false, error: "storage-unavailable" }
    }
  }
  const enqueue = (operation: MutationOperation) => {
    const run = async (): Promise<UiPluginResult<undefined>> => {
      try {
        return await withMutationLock(operation)
      } catch {
        return { ok: false, error: "storage-unavailable" }
      }
    }
    const result = queue.then(run, run)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const mutate = (
    change: (
      plugins: readonly InstalledUiPlugin[],
    ) =>
      | Promise<UiPluginResult<readonly InstalledUiPlugin[]>>
      | UiPluginResult<readonly InstalledUiPlugin[]>,
  ) => {
    const run = async (): Promise<UiPluginResult<undefined>> => {
      const loaded = await read()
      if (!loaded.result.ok) {
        await refresh()
        return loaded.result
      }
      const changed = await change(loaded.result.value)
      if (!changed.ok) return changed
      const result = write(changed.value, loaded.raw)
      if (!result.ok) await refresh()
      return result
    }
    return enqueue(run)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      void refresh()
      const stop = storageEvents?.(() => {
        void refresh()
      })
      return () => {
        generation += 1
        stop?.()
      }
    },
    authorized(integrity: string, capability: UiPluginCapability) {
      try {
        if (snapshot.status !== "ready" || storage.getItem(STORAGE_KEY) !== stamp) return false
        return snapshot.plugins.some(
          (entry) =>
            entry.package.integrity === integrity &&
            entry.enabled &&
            entry.grants.includes(capability),
        )
      } catch {
        return false
      }
    },
    install(candidate: UiPluginPackage, grants: readonly UiPluginCapability[]) {
      return mutate(async (plugins) => {
        const checked = await readUiPluginPackage(new TextEncoder().encode(candidate.source))
        if (!checked.ok) return checked
        if (checked.value.integrity !== candidate.integrity)
          return { ok: false, error: "integrity-mismatch" }
        if (
          grants.length !== 2 ||
          new Set(grants).size !== 2 ||
          !checked.value.manifest.capabilities.every((capability) => grants.includes(capability))
        )
          return { ok: false, error: "permission-denied" }
        const existing = plugins.find(
          ({ package: pkg }) =>
            pkg.manifest.id === checked.value.manifest.id &&
            pkg.manifest.version === checked.value.manifest.version,
        )
        if (existing)
          return existing.package.integrity === checked.value.integrity
            ? {
                ok: true,
                value: plugins.map((entry) =>
                  entry === existing ? { ...entry, enabled: true, grants: [...grants] } : entry,
                ),
              }
            : { ok: false, error: "identity-conflict" }
        return {
          ok: true,
          value: [...plugins, { package: checked.value, enabled: true, grants: [...grants] }],
        }
      })
    },
    setEnabled(integrity: string, enabled: boolean) {
      return mutate((plugins) =>
        plugins.some((entry) => entry.package.integrity === integrity)
          ? {
              ok: true,
              value: plugins.map((entry) =>
                entry.package.integrity === integrity ? { ...entry, enabled } : entry,
              ),
            }
          : { ok: false, error: "not-installed" },
      )
    },
    remove(integrity: string) {
      return mutate((plugins) => ({
        ok: true,
        value: plugins.filter((entry) => entry.package.integrity !== integrity),
      }))
    },
    reset() {
      return enqueue(async () => {
        storage.removeItem(STORAGE_KEY)
        await refresh()
        return snapshot.status === "ready"
          ? { ok: true, value: undefined }
          : { ok: false, error: snapshot.error ?? "storage-unavailable" }
      })
    },
  }
}

export function createBrowserUiPluginStore() {
  const storage: StoragePort = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  }
  const withBrowserLock: MutationLock = (operation) => {
    const locks = window.navigator.locks
    if (!locks) return Promise.resolve({ ok: false, error: "storage-unavailable" })
    return locks.request(STORAGE_KEY, { mode: "exclusive" }, operation)
  }
  return createUiPluginStore(
    storage,
    (changed) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === null) changed()
      }
      window.addEventListener("storage", onStorage)
      return () => window.removeEventListener("storage", onStorage)
    },
    withBrowserLock,
  )
}
