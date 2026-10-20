import { EdgePreparationClient } from "./edge-preparation"

export function createBrowserEdgePreparation(onError: (error: Error) => void) {
  return new EdgePreparationClient(
    () => new Worker(new URL("./edge-preparation.worker.ts", import.meta.url), { type: "module" }),
    onError,
  )
}
