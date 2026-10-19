import { expect, test } from "@playwright/test"

test("the presentation explains the workflow and links to the real editor", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CAD for thingsyou can make.")
  await expect(page.getByRole("link", { name: "Start designing" })).toHaveAttribute(
    "href",
    "https://cad.hello-world.cz",
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://vibeshape.hello-world.cz/",
  )
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://vibeshape.hello-world.cz/brand/og-light.png",
  )
  await page.getByRole("button", { name: "01 / Sketch", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Start with what has to fit." })).toBeVisible()
  await expect(page.getByRole("button", { name: "01 / Sketch", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByRole("button", { name: "03 / Export", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Bring the model with you." })).toBeVisible()
  expect(errors).toEqual([])
})

test("every documentation article supports direct links and return navigation", async ({
  page,
}) => {
  const topics = [
    ["getting-started", "Your first part"],
    ["local-installation", "Run VibeShape locally"],
    ["parametric-modeling", "Model with design intent"],
    ["mcp", "Connect your agent with MCP"],
    ["export-and-print", "Export and prepare to print"],
    ["privacy", "Your files and your device"],
  ] as const
  for (const [id, title] of topics) {
    await page.goto(`/#docs/${id}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
    await expect(page.getByRole("link", { name: "Full reference on GitHub" })).toHaveAttribute(
      "href",
      /^https:\/\/github\.com\/kolengri\/VibeShape\/blob\/main\/docs\//,
    )
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
  }
  await page.getByRole("link", { name: "Back to overview" }).click()
  await expect(page.locator("#documentation")).toBeInViewport()
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CAD for things")
})

test("downloads distinguish missing installers from usable installation paths", async ({
  page,
}) => {
  await page.goto("/#downloads")
  const downloads = page.locator("#downloads")
  await expect(downloads.getByText("Not published yet", { exact: true })).toBeVisible()
  await expect(downloads.getByRole("link", { name: "Check GitHub releases" })).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/releases",
  )
  await downloads.getByRole("link", { name: "Local installation guide" }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run VibeShape locally")
  await expect(page.locator("pre")).toContainText("bun run dev")
  await page.goBack()
  await expect(page.locator("#downloads")).toBeInViewport()
})

test("mobile navigation and long documentation fit a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const menu = page.getByRole("button", { name: "Toggle navigation" })
  await menu.click()
  await expect(menu).toHaveAttribute("aria-expanded", "true")
  await page
    .locator("#mobile-navigation")
    .getByRole("link", { name: "Documentation", exact: true })
    .click()
  await expect(menu).toHaveAttribute("aria-expanded", "false")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.goto("/#docs/local-installation")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.setViewportSize({ width: 320, height: 720 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test("skip to content preserves the current documentation route", async ({ page }) => {
  await page.goto("/#docs/local-installation")
  const skipLink = page.getByRole("button", { name: "Skip to content", exact: true })
  await skipLink.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#docs\/local-installation$/)
  await expect(page.getByRole("main")).toBeFocused()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Run VibeShape locally")
})
