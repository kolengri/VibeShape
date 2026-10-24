export function createSectionCapWorker() {
  return new Worker(new URL("./section-cap.worker.ts", import.meta.url), { type: "module" })
}
