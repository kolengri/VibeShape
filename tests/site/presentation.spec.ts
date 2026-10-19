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
  await page.locator(".print-visual").scrollIntoViewIfNeeded()
  expect(
    await page
      .locator(".print-visual")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0)
  await expect(page.locator(".printed-layer").last()).toHaveCSS("opacity", "1")
  await page.locator("#features").scrollIntoViewIfNeeded()
  await expect(page.locator(".feature-visual")).toHaveCount(6)
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
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
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
    "content",
    "https://vibeshape.hello-world.cz/brand/og-light.png",
  )
  await page.getByRole("button", { name: "Sketch", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Start with what has to fit." })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sketch", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByRole("button", { name: "Export", exact: true }).click()
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
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByRole("heading", { level: 1 })).not.toBeInViewport()
    await page
      .getByRole("link", { name: title, exact: true })
      .evaluate((element: HTMLAnchorElement) => element.focus({ preventScroll: true }))
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport()
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
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
  await expect(downloads.getByRole("link", { name: "macOS desktop build guide" })).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/blob/main/docs/desktop-macos.md",
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

test("printing reveals every layer, parks the head, and stays finished", async ({ page }) => {
  test.setTimeout(50000)
  await page.goto("/")
  const printer = page.locator(".print-visual")
  await expect(printer).toHaveAttribute("data-started", "false")
  await expect(printer.locator(".printed-layer").last()).toHaveCSS("opacity", "0")
  await printer.scrollIntoViewIfNeeded()
  await expect(printer).toHaveAttribute("data-started", "true")
  const head = printer.locator(".print-carriage")
  expect(
    await head.evaluate(
      (element) => element.getAnimations()[0]?.effect?.getComputedTiming().duration,
    ),
  ).toBeGreaterThanOrEqual(2000)
  await expect(printer.locator(".printed-layer").last()).toHaveCSS("opacity", "1", {
    timeout: 44000,
  })
  await expect
    .poll(() =>
      printer.evaluate((element) =>
        element
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true)
  expect(
    await printer
      .locator(".printed-layer")
      .evaluateAll((layers) =>
        layers.every(
          (layer) => getComputedStyle(layer).opacity === "1" && !layer.closest("[clip-path]"),
        ),
      ),
  ).toBe(true)
  await expect(printer.locator(".print-rail, .print-rail-edge")).toHaveCount(0)
  await expect(printer.locator(".print-filament")).toHaveCSS("opacity", "0")
  const parkedTransform = await head.evaluate((element) => getComputedStyle(element).transform)
  expect(
    await head.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).e),
  ).toBeGreaterThan(100)
  await page.locator("#features").scrollIntoViewIfNeeded()
  await printer.scrollIntoViewIfNeeded()
  await expect(head).toHaveCSS("transform", parkedTransform)
})

test("feature, workflow, and agent animations begin when their blocks appear", async ({ page }) => {
  await page.goto("/")
  const feature = page.locator(".feature-scene").first()
  await expect(feature).toHaveAttribute("data-started", "false")
  await feature.scrollIntoViewIfNeeded()
  await expect(feature).toHaveAttribute("data-started", "true")
  expect(
    await feature.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0)
  await page.getByRole("button", { name: "Sketch", exact: true }).click()
  await expect(page.locator(".workflow-scene")).toHaveAttribute("data-started", "true")
  expect(
    await page
      .locator(".workflow-visual")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0)
  await page.getByRole("button", { name: "Export", exact: true }).click()
  expect(
    await page
      .locator(".workflow-visual")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(3)
  const agent = page.locator(".agent-scene")
  await expect(agent).toHaveAttribute("data-started", "false")
  await agent.scrollIntoViewIfNeeded()
  await expect(agent).toHaveAttribute("data-started", "true")
  expect(
    await agent
      .locator("li")
      .evaluateAll((items) => items.every((item) => item.getAnimations().length === 1)),
  ).toBe(true)
})

test.describe("social previews", () => {
  test.use({ javaScriptEnabled: false })

  test("social crawlers receive complete metadata and both full-size images without JavaScript", async ({
    page,
    request,
  }) => {
    await page.goto("/")
    const images = page.locator('meta[property="og:image"]')
    await expect(images).toHaveCount(2)
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    )
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      "content",
      "https://vibeshape.hello-world.cz/brand/og-light.png",
    )
    await expect(page.locator('meta[property="og:image:width"]')).toHaveCount(2)
    await expect(page.locator('meta[property="og:image:height"]')).toHaveCount(2)
    for (const [index, theme] of ["light", "dark"].entries()) {
      const url = `https://vibeshape.hello-world.cz/brand/og-${theme}.png`
      await expect(images.nth(index)).toHaveAttribute("content", url)
      await expect(page.locator('meta[property="og:image:width"]').nth(index)).toHaveAttribute(
        "content",
        "1200",
      )
      await expect(page.locator('meta[property="og:image:height"]').nth(index)).toHaveAttribute(
        "content",
        "630",
      )
      await expect(page.locator('meta[property="og:image:alt"]').nth(index)).toHaveAttribute(
        "content",
        new RegExp(`${theme} blueprint grid`),
      )
      const response = await request.get(new URL(url).pathname)
      expect(response.ok()).toBe(true)
      expect(response.headers()["content-type"]).toContain("image/png")
      const png = await response.body()
      expect(png.subarray(1, 4).toString()).toBe("PNG")
      expect(png.readUInt32BE(16)).toBe(1200)
      expect(png.readUInt32BE(20)).toBe(630)
    }
  })
})
