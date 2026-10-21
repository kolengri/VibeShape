import { mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createServer, type ViteDevServer } from "vite"
import { createEditorProject } from "../../tests/e2e/fixtures"

let server: ViteDevServer | undefined
let url: string

test.beforeAll(async () => {
  const outputDir = test.info().project.outputDir
  await mkdir(outputDir, { recursive: true })
  const cacheDir = await mkdtemp(join(outputDir, "vite-cache-"))
  server = await createServer({
    root: import.meta.dirname,
    configFile: join(import.meta.dirname, "vite.config.ts"),
    cacheDir,
    server: { host: "127.0.0.1", port: 0, open: false },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === "string") throw new Error("Expected a loopback Vite port.")
  url = `http://127.0.0.1:${address.port}/`
})

test.afterAll(async () => {
  await server?.close()
})

test("activates a newly saved project without reloading during cold worker discovery", async ({
  page,
}) => {
  const documentRequests: string[] = []
  const runtimeErrors: string[] = []
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests.push(request.url())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })

  await page.goto(url)
  await createEditorProject(page)

  await expect(page).toHaveURL(/\?project=[\da-f-]+$/)
  expect(documentRequests, "New project must select its editor in the original page").toEqual([url])
  expect(runtimeErrors).toEqual([])
})
