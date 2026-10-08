import { mock } from "bun:test"

// Vite exports a constructor wrapper for these imports; the worker owns a separate realm.
for (const entry of [
  "../../../packages/document-worker/src/worker-entry.ts",
  "../../../packages/geometry-worker/src/worker-entry.ts",
  "../../../apps/web/src/spikes/selected-geometry-worker.ts",
]) {
  const url = new URL(entry, import.meta.url)
  mock.module(`${url.pathname}?worker`, () => ({
    default: function WorkerConstructor(options?: WorkerOptions) {
      return new globalThis.Worker(url.href, { ...options, type: "module" })
    },
  }))
}
