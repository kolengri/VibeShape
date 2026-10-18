import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  readUiPluginPackage,
  UI_PLUGIN_FILE_BYTES,
  type UiPluginError,
  type UiPluginPackage,
} from "./ui-plugin-package"
import { createBrowserUiPluginStore, type InstalledUiPlugin } from "./ui-plugin-store"

export function useUiPluginManager() {
  const [store] = useState(createBrowserUiPluginStore)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [candidate, setCandidate] = useState<UiPluginPackage | null>(null)
  const [error, setError] = useState<UiPluginError | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [target, setTarget] = useState<{
    integrity: string
    panelId: string
    generation: number
  } | null>(null)
  useEffect(() => store.start(), [store])
  const active =
    snapshot.status === "ready" && target
      ? snapshot.plugins.find(
          (entry) => entry.package.integrity === target.integrity && entry.enabled,
        )
      : undefined
  useEffect(() => {
    if (target && !active) setTarget(null)
  }, [target, active])
  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      await action()
    } catch {
      setError("storage-unavailable")
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  const install = () =>
    run(async () => {
      if (!candidate) return
      const result = await store.install(candidate, candidate.manifest.capabilities)
      if (!result.ok) setError(result.error)
      else setCandidate(null)
    })
  const selectedFile = (file: File) =>
    run(async () => {
      setCandidate(null)
      if (file.size > UI_PLUGIN_FILE_BYTES) {
        setError("package-too-large")
        return
      }
      const result = await readUiPluginPackage(new Uint8Array(await file.arrayBuffer()))
      if (result.ok) setCandidate(result.value)
      else setError(result.error)
    })
  const invoke = (entry: InstalledUiPlugin, panelId: string) => {
    if (
      !store.authorized(entry.package.integrity, "ui.command") ||
      !store.authorized(entry.package.integrity, "ui.panel")
    ) {
      setError("permission-denied")
      return
    }
    setTarget({ integrity: entry.package.integrity, panelId, generation: 0 })
  }
  const changeEntry = (entry: InstalledUiPlugin, remove: boolean) =>
    run(async () => {
      const result = remove
        ? await store.remove(entry.package.integrity)
        : await store.setEnabled(entry.package.integrity, !entry.enabled)
      if (!result.ok) setError(result.error)
    })
  const reset = () =>
    run(async () => {
      const result = await store.reset()
      if (!result.ok) setError(result.error)
    })
  return {
    store,
    snapshot,
    candidate,
    setCandidate,
    error,
    pending,
    target,
    setTarget,
    active,
    install,
    selectedFile,
    invoke,
    changeEntry,
    reset,
  }
}
