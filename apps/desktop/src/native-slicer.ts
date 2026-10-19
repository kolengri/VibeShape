import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { cleanupStaleHandoffFiles, createHandoffFileStore } from "@vibeshape/slicer-bridge/native"
import {
  type NativeMeshRequest,
  type NativeMeshResult,
  type NativeSlicerApplicationsResult,
  type NativeSlicerChooseResult,
  nativeMeshRequestSchema,
  nativeSlicerFileIdSchema,
} from "@vibeshape/slicer-handoff/native"
import { createNativeSlicerApplications } from "./native-slicer-applications"
import { launchNativeSlicer, type NativeSlicerApplication } from "./native-slicer-launcher"

const RETAIN_MS = 12 * 60 * 60 * 1000
const MAX_RETAINED_BYTES = 512 * 1024 * 1024
const MAX_RETAINED_FILES = 32

type RetainedFile = { path: string; size: number; expiresAt: number }
export function createNativeSlicerService(options: {
  directory: string
  chooseApplication: () => Promise<string | null>
  reveal: (path: string) => void
  applications?: ReturnType<typeof createNativeSlicerApplications>
  files?: ReturnType<typeof createHandoffFileStore>
  launch?: typeof launchNativeSlicer
  now?: () => number
}) {
  const base = join(options.directory, "mesh-handoffs")
  const applications =
    options.applications ?? createNativeSlicerApplications({ directory: options.directory })
  const files = options.files ?? createHandoffFileStore(base)
  const ready = cleanupStaleHandoffFiles(base).catch(() => undefined)
  const retained = new Map<string, RetainedFile>()
  const now = options.now ?? Date.now
  let busy = false
  let disposed = false
  async function hasCapacity(size: number) {
    for (const [id, file] of retained) {
      if (file.expiresAt <= now() || !(await stat(file.path).catch(() => null))?.isFile())
        retained.delete(id)
    }
    const bytes = [...retained.values()].reduce((total, file) => total + file.size, 0)
    return retained.size < MAX_RETAINED_FILES && bytes + size <= MAX_RETAINED_BYTES
  }
  async function persistAndLaunch(
    request: NativeMeshRequest,
    application: NativeSlicerApplication,
  ): Promise<NativeMeshResult> {
    let persisted: Awaited<ReturnType<typeof files.persist>>
    try {
      persisted = await files.persist(request.filename, request.file)
    } catch {
      return { ok: false, reason: "write-failed" }
    }
    const fileId = randomUUID()
    persisted.scheduleCleanup()
    retained.set(fileId, {
      path: persisted.path,
      size: request.file.byteLength,
      expiresAt: now() + RETAIN_MS,
    })
    if (disposed) return { ok: false, reason: "unavailable", fileId }
    try {
      await (options.launch ?? launchNativeSlicer)(application, persisted.path)
    } catch {
      return { ok: false, reason: "launch-failed", fileId }
    }
    return { ok: true, fileId, slicerName: application.name }
  }
  return {
    async listApplications(): Promise<NativeSlicerApplicationsResult> {
      if (disposed) return { ok: false, reason: "unavailable" }
      try {
        return { ok: true, targets: await applications.list() }
      } catch {
        return { ok: false, reason: "unavailable" }
      }
    },
    async chooseApplication(): Promise<NativeSlicerChooseResult> {
      if (disposed) return { ok: false, reason: "unavailable" }
      if (busy) return { ok: false, reason: "busy" }
      busy = true
      try {
        const path = await options.chooseApplication()
        if (!path) return { ok: true, target: null }
        if (disposed) return { ok: false, reason: "unavailable" }
        const target = await applications.choose(path)
        return target ? { ok: true, target } : { ok: false, reason: "choose-failed" }
      } catch {
        return { ok: false, reason: "choose-failed" }
      } finally {
        busy = false
      }
    },
    async send(payload: unknown): Promise<NativeMeshResult> {
      const parsed = nativeMeshRequestSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, reason: "invalid-request" }
      if (disposed) return { ok: false, reason: "unavailable" }
      if (busy) return { ok: false, reason: "busy" }
      busy = true
      try {
        await ready
        const request = parsed.data
        if (!(await hasCapacity(request.file.byteLength))) return { ok: false, reason: "capacity" }
        const application = await applications.resolve(request.slicerId)
        if (!application) return { ok: false, reason: "not-installed" }
        if (disposed) return { ok: false, reason: "unavailable" }
        return await persistAndLaunch(request, application)
      } catch {
        return { ok: false, reason: "unavailable" }
      } finally {
        busy = false
      }
    },
    async reveal(payload: unknown) {
      const parsed = nativeSlicerFileIdSchema.safeParse(payload)
      if (disposed || !parsed.success) return false
      const file = retained.get(parsed.data)
      if (!file || file.expiresAt <= now()) return false
      if (!(await stat(file.path).catch(() => null))?.isFile()) {
        retained.delete(parsed.data)
        return false
      }
      options.reveal(file.path)
      return true
    },
    close() {
      disposed = true
      retained.clear()
    },
  }
}
