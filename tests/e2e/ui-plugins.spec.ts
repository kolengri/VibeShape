import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { openApplicationMenuItem } from "./application-menu-support"
import { cloudflareResponseHeaders } from "./cloudflare-header-support"
import { expect, test } from "./fixtures"

test.setTimeout(60_000)
const productionOrigin = process.env.VIBESHAPE_PLUGIN_TEST_ORIGIN

async function deploymentHeaders(page: Page) {
  const config = await readFile("deployment/cloudflare/_headers", "utf8")
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== productionOrigin) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const headers = cloudflareResponseHeaders(config, url.pathname, response.headers())
    if (["/", "/index", "/index.html"].includes(url.pathname)) {
      headers["content-security-policy"] = (headers["content-security-policy"] ?? "")
        .replace(
          "script-src 'self' 'wasm-unsafe-eval'",
          "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
        )
        .replace(
          "connect-src 'self'",
          "connect-src 'self' https://vibeshape-mcp.example.com wss://vibeshape-mcp.example.com; frame-src 'self' https://challenges.cloudflare.com",
        )
    }
    await route.fulfill({ response, headers })
  })
}

async function openPlugins(page: Page) {
  await openApplicationMenuItem(page, "Plugins…")
  return page.getByRole("dialog", { name: "Plugins", exact: true })
}

async function installExample(page: Page) {
  const dialog = await openPlugins(page)
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download example plugin", exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe("print-fit.vsui.json")
  const path = await download.path()
  if (!path) throw new Error("Missing example plugin download")
  await dialog.getByLabel("Choose plugin package (.vsui.json)", { exact: true }).setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: await readFile(path),
  })
  const review = dialog.getByRole("region", { name: "Review plugin", exact: true })
  await expect(review).toContainText("Add commands")
  await expect(review).toContainText("Display an isolated panel")
  await expect(
    dialog.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toHaveCount(0)
  await review.getByRole("button", { name: "Install and enable", exact: true }).click()
  await expect(review).toHaveCount(0)
  return dialog
}

test("installs reviewed local UI contributions and runs a real opaque panel under the production script policy", async ({
  page,
}) => {
  if (productionOrigin) await deploymentHeaders(page)
  const documentResponse = await page.goto(productionOrigin ?? "/")
  if (productionOrigin) {
    expect(documentResponse?.headers()["content-security-policy"]).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    )
    expect(documentResponse?.headers()["cross-origin-resource-policy"]).toBe("same-origin")
    expect(documentResponse?.headers()["access-control-allow-origin"]).toBeUndefined()
  }
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  await page.locator("html").evaluate((root) => root.classList.add("dark"))
  // Apply the deployment's restrictive policy before creating the child, including in dev runs.
  if (!productionOrigin)
    await page.locator("head").evaluate((head) => {
      const meta = head.ownerDocument.createElement("meta")
      meta.setAttribute("http-equiv", "Content-Security-Policy")
      meta.setAttribute(
        "content",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
      )
      head.append(meta)
    })
  const dialog = await installExample(page)
  const loadingRuntime = page.waitForResponse((response) =>
    /ui-panel-runtime.*\.js/.test(new URL(response.url()).pathname),
  )
  await dialog.getByRole("button", { name: "Calculate print fit", exact: true }).click()
  const runtime = await loadingRuntime
  expect(runtime.headers()["cross-origin-resource-policy"]).toBe("same-origin")
  expect(runtime.headers()["access-control-allow-origin"]).toBe("*")
  expect(runtime.request().headers().origin).toBe("null")
  const frameElement = dialog.locator('iframe[title="Print fit calculator"]')
  await expect(frameElement).toHaveAttribute("sandbox", "allow-scripts")
  const panel = frameElement.contentFrame()
  await expect(
    panel.getByRole("heading", { name: "Print fit calculator", exact: true }),
  ).toBeVisible()
  await expect(panel.getByText("10.4", { exact: true })).toBeVisible()
  const theme = await panel.locator("body").evaluate((body) => {
    const view = body.ownerDocument.defaultView
    if (!view) throw new Error("Missing panel window")
    const style = view.getComputedStyle(body)
    return {
      scheme: view.getComputedStyle(body.ownerDocument.documentElement).colorScheme,
      contrast: style.color !== style.backgroundColor,
    }
  })
  expect(theme).toEqual({ scheme: "dark", contrast: true })
  await panel.getByRole("spinbutton", { name: "Part diameter", exact: true }).fill("20")
  await panel.getByRole("button", { name: "Calculate", exact: true }).click()
  await expect(panel.getByText("20.4", { exact: true })).toBeVisible()
  await panel.getByRole("spinbutton", { name: "Part diameter", exact: true }).fill("10001")
  await panel.getByRole("button", { name: "Calculate", exact: true }).click()
  await expect(panel.getByRole("alert")).toHaveText(
    "Enter finite values within the displayed bounds.",
  )
  const isolation = await panel.locator("body").evaluate((body) => {
    const child = body.ownerDocument.defaultView
    if (!child) throw new Error("Missing child window")
    let parentAccess = false
    let storageAccess = false
    try {
      parentAccess = Boolean(child.parent.document)
    } catch {}
    try {
      storageAccess = Boolean(child.localStorage)
    } catch {}
    return { parentAccess, storageAccess, origin: child.location.origin }
  })
  expect(isolation).toEqual({ parentAccess: false, storageAccess: false, origin: "null" })
  await dialog.getByRole("button", { name: "Reload panel", exact: true }).click()
  await expect(panel.getByText("10.4", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Disable", exact: true }).click()
  await expect(frameElement).toHaveCount(0)
  await expect(
    dialog.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toBeDisabled()
  await dialog.getByRole("button", { name: "Enable", exact: true }).click()
  await expect(
    dialog.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toBeEnabled()
  await expect(frameElement).toHaveCount(0)
  await dialog.getByRole("button", { name: "Close plugins", exact: true }).last().click()
  await expect(page.getByRole("button", { name: "Application menu", exact: true })).toBeFocused()
  await page.reload()
  const reopened = await openPlugins(page)
  await expect(
    reopened.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toBeEnabled()
  await expect(reopened.locator("iframe")).toHaveCount(0)
  await reopened.getByRole("button", { name: "Remove", exact: true }).click()
  await expect(
    reopened.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toHaveCount(0)
})

test("rejects executable packages and revokes an already open panel after another tab disables it", async ({
  page,
  context,
}) => {
  if (productionOrigin) await deploymentHeaders(page)
  await page.goto(productionOrigin ?? "/")
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible()
  const dialog = await installExample(page)
  await dialog.getByRole("button", { name: "Calculate print fit", exact: true }).click()
  await expect(
    dialog.locator("iframe").contentFrame().getByText("10.4", { exact: true }),
  ).toBeVisible()
  const other = await context.newPage()
  await other.goto(page.url())
  const otherPlugins = await openPlugins(other)
  await otherPlugins.getByRole("button", { name: "Disable", exact: true }).click()
  await expect(dialog.locator("iframe")).toHaveCount(0)
  await expect(
    dialog.getByRole("button", { name: "Calculate print fit", exact: true }),
  ).toBeDisabled()
  await other.close()
  await dialog.getByLabel("Choose plugin package (.vsui.json)", { exact: true }).setInputFiles({
    name: "unsafe.vsui.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":1,"script":"parent.localStorage.clear()"}'),
  })
  await expect(dialog.getByRole("alert")).toHaveText(
    "This is not a supported declarative UI plugin package.",
  )
  await expect(dialog.getByRole("region", { name: "Review plugin", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("listitem")).toHaveCount(1)
})
