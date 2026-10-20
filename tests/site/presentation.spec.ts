import { expect, test } from "@playwright/test"

test("the hero plays freely, then floats around the exploded model without pinning scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  const video = page.locator("#overview video")
  await expect(video).toHaveCSS("opacity", "1")
  await expect(page.locator(".hero-scroll-frame")).toHaveCSS("position", "static")
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await page.evaluate(() => window.scrollTo({ top: 240, behavior: "instant" }))
  expect(await page.evaluate(() => window.scrollY)).toBe(240)
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.3)
  const beforeReturn = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.currentTime),
  ).toBeGreaterThanOrEqual(beforeReturn)
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
      timeout: 9000,
    })
    .toBeGreaterThan(6.2)
  await expect(video).toHaveAttribute("data-phase", "intro")
  expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeCloseTo(9, 1)
  await expect(video).toHaveAttribute("data-phase", "floating", { timeout: 13000 })
  await expect(video).toHaveAttribute("src", "./media/hero-float.mp4")
  await expect(video).toHaveCSS("opacity", "1")
  expect(await video.evaluate((element: HTMLVideoElement) => element.loop)).toBe(true)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2)
  const cadence = await video.evaluate(
    (element: HTMLVideoElement) =>
      new Promise<{ frames: number; seeks: number; advance: number }>((resolve) => {
        let frames = 0
        let seeks = 0
        const start = element.currentTime
        const onSeek = () => seeks++
        element.addEventListener("seeking", onSeek)
        let callback = 0
        const onFrame = () => {
          frames++
          callback = element.requestVideoFrameCallback(onFrame)
        }
        callback = element.requestVideoFrameCallback(onFrame)
        setTimeout(() => {
          element.cancelVideoFrameCallback(callback)
          element.removeEventListener("seeking", onSeek)
          resolve({ frames, seeks, advance: element.currentTime - start })
        }, 2000)
      }),
  )
  expect(cadence.seeks).toBe(0)
  expect(cadence.frames).toBeGreaterThan(30)
  expect(cadence.advance).toBeGreaterThan(1.5)
  await page.locator("#features").scrollIntoViewIfNeeded()
  await expect(page.locator("#features h2")).toBeInViewport()
  await expect(video).toHaveAttribute("data-active", "false")
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await page.locator("#overview").scrollIntoViewIfNeeded()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await expect(video).toHaveAttribute("data-phase", "floating")
})

test("the floating hero loads under a deployment path prefix", async ({ page }) => {
  const loopRequests: string[] = []
  await page.route("**/media/hero-float.mp4", async (route) => {
    loopRequests.push(new URL(route.request().url()).pathname)
    await route.abort()
  })
  await page.route("**/vibeshape/**", async (route) => {
    const url = new URL(route.request().url())
    url.pathname = url.pathname.slice("/vibeshape".length)
    if (url.pathname.endsWith("/hero-float.mp4")) {
      loopRequests.push(new URL(route.request().url()).pathname)
    }
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) })
  })
  await page.goto("/vibeshape/")
  const video = page.locator("#overview video")
  await expect(video).toHaveAttribute("data-phase", "floating", { timeout: 15000 })
  await expect(video).toHaveCSS("opacity", "1")
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  expect(
    await video.evaluate((element: HTMLVideoElement) => new URL(element.currentSrc).pathname),
  ).toBe("/vibeshape/media/hero-float.mp4")
  expect(loopRequests).toContain("/vibeshape/media/hero-float.mp4")
  expect(loopRequests).not.toContain("/media/hero-float.mp4")
})

test("reduced motion uses the poster without fetching video or pinning the hero", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  const videoRequests: string[] = []
  page.on("request", (request) => {
    if (/\/media\/hero-.*\.mp4$/.test(request.url())) videoRequests.push(request.url())
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

test("the mobile hero plays independently of scrolling without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/")
  const video = page.locator("#overview video")
  await page.locator(".hero-visual").scrollIntoViewIfNeeded()
  await expect(video).toHaveCSS("opacity", "1")
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.3)
  await expect(page.locator(".hero-scroll-frame")).toHaveCSS("position", "static")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator("#features").scrollIntoViewIfNeeded()
  await expect(video).toHaveAttribute("data-active", "false")
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
})

test("a failed hero video leaves a decoded poster visible", async ({ page }) => {
  await page.route("**/media/hero-intro-return.mp4", (route) => route.abort())
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

test("a failed floating loop leaves the model poster visible", async ({ page }) => {
  await page.route("**/media/hero-float.mp4", (route) => route.abort())
  await page.goto("/")
  await expect(page.locator("#overview video")).toHaveCount(0, { timeout: 15000 })
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
    "https://vibeshape.hello-world.cz/brand/og-light.png?v=benchy-mesh",
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

test("downloads show the published Mac release with aligned primary actions", async ({ page }) => {
  await page.route(
    "https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100",
    (route) =>
      route.fulfill({
        json: [
          {
            tag_name: "desktop-v9.8.7",
            draft: false,
            prerelease: false,
            published_at: "2026-10-20T12:00:00Z",
            assets: [
              {
                name: "VibeShape-9.8.7-mac-arm64.dmg",
                state: "uploaded",
                browser_download_url:
                  "https://github.com/kolengri/VibeShape/releases/download/desktop-v9.8.7/VibeShape-9.8.7-mac-arm64.dmg",
              },
            ],
          },
        ],
      }),
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/#downloads")
  const downloads = page.locator("#downloads")
  await expect(downloads.getByText("macOS · Apple Silicon · v9.8.7", { exact: true })).toBeVisible()
  await expect(downloads.getByRole("link", { name: "All releases & checksums" })).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/releases",
  )
  await expect(downloads.getByRole("link", { name: "Download for Apple Silicon" })).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/releases/download/desktop-v9.8.7/VibeShape-9.8.7-mac-arm64.dmg",
  )
  await expect(downloads).toContainText("not notarized by Apple")
  const actions = ["Open VibeShape", "Local installation guide", "Download for Apple Silicon"]
  const bounds = await Promise.all(
    actions.map((name) => downloads.getByRole("link", { name, exact: true }).boundingBox()),
  )
  for (const boundsAtIndex of bounds) {
    expect(boundsAtIndex).not.toBeNull()
    expect(boundsAtIndex?.y).toBeCloseTo(bounds[0]?.y ?? 0, 0)
    expect(boundsAtIndex?.height).toBe(bounds[0]?.height)
  }
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
      "https://vibeshape.hello-world.cz/brand/og-light.png?v=benchy-mesh",
    )
    await expect(page.locator('meta[property="og:image:width"]')).toHaveCount(2)
    await expect(page.locator('meta[property="og:image:height"]')).toHaveCount(2)
    for (const [index, theme] of ["light", "dark"].entries()) {
      const url = `https://vibeshape.hello-world.cz/brand/og-${theme}.png?v=benchy-mesh`
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

test("the workflow lazily loads a real 3D part with rotation and editor view controls", async ({
  page,
}) => {
  const meshRequests: string[] = []
  const kernelRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith("/models/demo-mounting-plate.stl")) meshRequests.push(request.url())
    if (request.url().includes(".wasm")) kernelRequests.push(request.url())
  })
  await page.goto("/")
  const model = page.locator("[data-workflow-model]")
  await expect(model).toHaveAttribute("data-state", "loading")
  expect(meshRequests).toEqual([])
  await model.scrollIntoViewIfNeeded()
  await expect(model).toHaveAttribute("data-state", "ready", { timeout: 10000 })
  expect(meshRequests).toHaveLength(1)
  const canvas = model.getByLabel("Interactive demonstration mounting plate")
  await expect(canvas).toBeVisible()
  const initial = await canvas.screenshot()
  await model.getByRole("button", { name: "Top view", exact: true }).click()
  await expect(model).toHaveAttribute("data-view", "top")
  const top = await canvas.screenshot()
  expect(top.equals(initial)).toBe(false)
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error("The 3D preview canvas is missing.")
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 10)
  await expect(model).toHaveAttribute("data-view", "top")
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 50, {
    steps: 8,
  })
  await page.mouse.up()
  await expect(model).toHaveAttribute("data-view", "orbit")
  expect((await canvas.screenshot()).equals(top)).toBe(false)
  await expect(model).toHaveAttribute("data-engaged", "true")
  await page.keyboard.press("Escape")
  await expect(model).toHaveAttribute("data-engaged", "false")
  const beforeScroll = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 180)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll)
  expect(kernelRequests).toEqual([])
})

test("the model can be reopened after changing stages and fits a mobile viewport", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/#workflow")
  const model = page.locator("[data-workflow-model]")
  await model.scrollIntoViewIfNeeded()
  await expect(model).toHaveAttribute("data-state", "ready", { timeout: 10000 })
  await page.getByRole("button", { name: "Sketch", exact: true }).click()
  await expect(model).toHaveCount(0)
  await page.getByRole("button", { name: "Shape", exact: true }).click()
  await model.scrollIntoViewIfNeeded()
  await expect(model).toHaveAttribute("data-state", "ready", { timeout: 10000 })
  await model.getByRole("button", { name: "Front view", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(model).toHaveAttribute("data-view", "front")
  await model.getByRole("button", { name: "Top view", exact: true }).click()
  await model.getByRole("button", { name: "Fit model", exact: true }).click()
  await expect(model.getByRole("button", { name: "Top view", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(model).toHaveAttribute("data-view", "isometric")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test("an unavailable 3D asset keeps workflow navigation usable", async ({ page }) => {
  await page.route("**/models/demo-mounting-plate.stl", (route) => route.abort())
  await page.goto("/#workflow")
  const model = page.locator("[data-workflow-model]")
  await model.scrollIntoViewIfNeeded()
  await expect(model).toHaveAttribute("data-state", "unavailable")
  await expect(model.getByRole("status")).toHaveText(
    "The 3D preview is unavailable on this device.",
  )
  await expect(model.getByRole("button", { name: "Fit model", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Export", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Bring the model with you." })).toBeVisible()
})

test("a failed viewer chunk stays inside the workflow fallback", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route(/\/assets\/three-viewport-[^/]+\.js$/, (route) => route.abort())
  await page.goto("/#workflow")
  const model = page.locator("[data-workflow-model]")
  await model.scrollIntoViewIfNeeded()
  await expect(model).toHaveAttribute("data-state", "unavailable")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CAD for things you can make.")
  await page.getByRole("button", { name: "Sketch", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Start with what has to fit." })).toBeVisible()
  expect(errors).toEqual([])
})

test.describe("touch preview", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test("a cancelled touch scroll releases the model and restores page scrolling", async ({
    page,
  }) => {
    await page.goto("/#workflow")
    const model = page.locator("[data-workflow-model]")
    await model.scrollIntoViewIfNeeded()
    await expect(model).toHaveAttribute("data-state", "ready", { timeout: 10000 })
    const canvas = model.getByLabel("Interactive demonstration mounting plate")
    await canvas.evaluate((element) =>
      element.addEventListener("pointercancel", () =>
        element.setAttribute("data-cancelled", "true"),
      ),
    )
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error("The touch preview canvas is missing.")
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    const session = await page.context().newCDPSession(page)
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    await expect(model).toHaveAttribute("data-engaged", "false")
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + 90 }],
    })
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(canvas).toHaveAttribute("data-cancelled", "true")
    await expect(model).toHaveAttribute("data-engaged", "false")
    await expect(canvas).toHaveCSS("touch-action", "pan-y")
    await canvas.tap()
    await expect(model).toHaveAttribute("data-engaged", "true")
    await expect(canvas).toHaveCSS("touch-action", "none")
    await model.getByRole("button", { name: "Fit model", exact: true }).tap()
    await expect(model).toHaveAttribute("data-engaged", "false")
    await session.detach()
  })
})
