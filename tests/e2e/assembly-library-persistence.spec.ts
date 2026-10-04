import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import type {
  runAssemblyLibraryAuthorityEvidence,
  runAssemblyLibraryPersistenceEvidence,
} from "../../scripts/assembly-library-persistence-evidence"

const path = `/@fs${resolve(import.meta.dirname, "../../scripts/assembly-library-persistence-evidence.ts")}`
test("revoked reviewed library authority aborts asynchronous writes atomically", async ({
  page,
}) => {
  await page.route("**/assembly-library-authority.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Library authority</title>",
    }),
  )
  await page.goto("/assembly-library-authority.html")
  const report = await page.evaluate(
    async ({ path, name }) => {
      const evidence: {
        runAssemblyLibraryAuthorityEvidence: typeof runAssemblyLibraryAuthorityEvidence
      } = await import(path)
      return evidence.runAssemblyLibraryAuthorityEvidence(name)
    },
    { path, name: `assembly-library-authority-${test.info().project.name}` },
  )
  expect(report).toEqual({ publicationRollback: true, asyncMetadataReadRejected: true })
})
test("immutable library revisions survive restart and reject stale, corrupt and partial publication", async ({
  page,
}) => {
  await page.route("**/assembly-library-evidence.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Assembly library persistence</title>",
    }),
  )
  await page.goto("/assembly-library-evidence.html")
  const report = await page.evaluate(
    async ({ path, name }) => {
      const evidence: {
        runAssemblyLibraryPersistenceEvidence: typeof runAssemblyLibraryPersistenceEvidence
      } = await import(path)
      type BrowserStore = { createIndex(name: string, key: string): unknown }
      type BrowserDatabase = {
        createObjectStore(name: string, options: { keyPath: string | string[] }): BrowserStore
        close(): void
      }
      type BrowserRequest = {
        result: BrowserDatabase
        error: unknown
        onupgradeneeded: (() => void) | null
        onerror: (() => void) | null
        onsuccess: (() => void) | null
      }
      type BrowserFactory = { open(name: string, version: number): BrowserRequest }
      function isBrowserFactory(value: unknown): value is BrowserFactory {
        const idbFactoryConstructor: unknown = Reflect.get(globalThis, "IDBFactory")
        return typeof idbFactoryConstructor === "function" && value instanceof idbFactoryConstructor
      }
      const factory: unknown = Reflect.get(globalThis, "indexedDB")
      if (!isBrowserFactory(factory))
        throw new Error("The browser IndexedDB factory is unavailable.")
      return evidence.runAssemblyLibraryPersistenceEvidence(
        name,
        (databaseName) =>
          new Promise<void>((resolve, reject) => {
            const request = factory.open(databaseName, 20)
            request.onupgradeneeded = () => {
              const database = request.result
              database
                .createObjectStore("items", { keyPath: "id" })
                .createIndex("updatedAt", "updatedAt")
              database
                .createObjectStore("versions", { keyPath: ["itemId", "version"] })
                .createIndex("itemId", "itemId")
              database.createObjectStore("blobs", { keyPath: "digest" })
            }
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              request.result.close()
              resolve()
            }
          }),
      )
    },
    { path, name: `assembly-library-${test.info().project.name}` },
  )
  expect(report).toEqual({
    publication: true,
    immutableVersions: true,
    restarted: true,
    concurrentStaleRejected: true,
    quotaRollback: true,
    byteClosureRejected: true,
    corruptionRejected: true,
    futureVersionRejected: true,
    search: true,
  })
})
