import "../../tests/unit/support/vite-imports"
import { afterEach, expect, it } from "bun:test"
import { vi } from "../../tests/unit/support/bun-test"

afterEach(() => vi.unstubAllGlobals())

it("preserves Vite's worker constructor contract and resolves the test's worker at construction", async () => {
  const calls: unknown[][] = []
  class WorkerFixture {
    constructor(...arguments_: unknown[]) {
      calls.push(arguments_)
    }
  }
  vi.stubGlobal("Worker", WorkerFixture)
  const workerModule = "../../packages/document-worker/src/worker-entry?worker"
  const { default: WorkerConstructor } = (await import(workerModule)) as {
    default: new (options?: WorkerOptions) => Worker
  }
  const worker = new WorkerConstructor({ name: "document-test" })
  expect(worker).toBeInstanceOf(WorkerFixture)
  expect(calls).toEqual([
    [
      new URL("../../packages/document-worker/src/worker-entry.ts", import.meta.url).href,
      { name: "document-test", type: "module" },
    ],
  ])
})
