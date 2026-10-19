import { expect, test } from "@playwright/test"

test("the hero follows scroll in both directions while the video stays paused", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const video = page.locator("#overview video")
  await expect(video).toHaveCSS("opacity", "1")
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(0.1)
  await page.evaluate(() => window.scrollTo({ top: 540, behavior: "instant" }))
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(3)
  await expect(page.locator(".hero-visual")).toBeInViewport({ ratio: 1 })
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(0.1)
  await page.locator("#features").scrollIntoViewIfNeeded()
  await expect(page.locator("#features h2")).toBeInViewport()
})

test("reduced motion uses the poster without fetching video or pinning the hero", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  const videoRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith("/media/hero-scroll.mp4")) videoRequests.push(request.url())
  })
  await page.goto("/")
  await expect(page.locator("#overview video")).toHaveCount(0)
  await expect(page.locator(".hero-scroll-frame")).toHaveCSS("position", "static")
  await expect(page.locator(".hero-visual img")).toBeVisible()
  expect(videoRequests).toEqual([])
})

test("the hero follows mobile scrolling without pinning or horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/")
  const video = page.locator("#overview video")
  await expect(video).toHaveCSS("opacity", "1")
  const initialTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  await page
    .locator(".hero-visual")
    .evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }))
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(initialTime + 1)
  await expect(page.locator(".hero-scroll-frame")).toHaveCSS("position", "static")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(initialTime + 0.1)
})

test("a failed hero video leaves a decoded poster visible", async ({ page }) => {
  await page.route("**/media/hero-scroll.mp4", (route) => route.abort())
  await page.goto("/")
  await expect(page.locator("#overview video")).toHaveCount(0)
  const poster = page.locator(".hero-visual img")
  await expect(poster).toBeVisible()
  expect(
    await poster.evaluate(
      (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
    ),
  ).toBe(true)
})

test("the presentation explains the workflow and links to the real editor", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "CAD for things you can make.",
  )
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
    await expect(page).toHaveTitle(`${title} — VibeShape`)
    await expect(page.getByRole("link", { name: "Full reference on GitHub" })).toHaveAttribute(
      "href",
      /^https:\/\/github\.com\/kolengri\/VibeShape\/blob\/main\/docs\//,
    )
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
  }
  await page.getByRole("link", { name: "Back to overview" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#documentation")).toBeInViewport()
  await expect(page.locator("#documentation h2")).toBeFocused()
  await expect(page).toHaveTitle("VibeShape — CAD for things you can make")
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
  await menu.focus()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveAttribute("aria-expanded", "true")
  await page
    .locator("#mobile-navigation")
    .getByRole("link", { name: "Documentation", exact: true })
    .focus()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveAttribute("aria-expanded", "false")
  await expect(page.locator("#documentation h2")).toBeFocused()
  await menu.focus()
  await page.keyboard.press("Enter")
  await page
    .locator("#mobile-navigation")
    .getByRole("link", { name: "Documentation", exact: true })
    .focus()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveAttribute("aria-expanded", "false")
  await expect(page.locator("#documentation h2")).toBeFocused()
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

test("keyboard section navigation focuses the destination after leaving an article", async ({
  page,
}) => {
  await page.goto("/#docs/getting-started")
  await page.getByRole("link", { name: "Features", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#features$/)
  await expect(page.locator("#features h2")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "Read the feature matrix" })).toBeFocused()
})

test("modified section navigation preserves native new-tab activation", async ({
  page,
  context,
}) => {
  await page.goto("/#features")
  const newPage = context.waitForEvent("page")
  await page.getByRole("link", { name: "Features", exact: true }).click({
    modifiers: ["ControlOrMeta"],
  })
  const destination = await newPage
  await expect(destination).toHaveURL(/#features$/)
  await expect(page).toHaveURL(/#features$/)
  await destination.close()
})

test("the home link returns to the overview when its fragment is already active", async ({
  page,
}) => {
  await page.goto("/#overview")
  const heading = page.getByRole("heading", { level: 1 })
  await expect(heading).toBeInViewport()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(heading).not.toBeInViewport()
  await page.locator("header").getByRole("link", { name: "VibeShape", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#overview$/)
  await expect(heading).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})
