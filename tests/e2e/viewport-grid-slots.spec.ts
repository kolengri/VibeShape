import { expect, test } from "./fixtures"

test.use({ autoCreateProject: false })

const fixtureUrl = "/src/test-support/viewport-grid-fixture.tsx"

test("packs multiple arbitrary slot elements by size and full-height settings without remounting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto("/")
  await page.evaluate(async (url) => {
    const fixture = await import(/* @vite-ignore */ url)
    fixture.renderViewportGridFixture()
  }, fixtureUrl)
  const item = (id: string) => page.locator(`[data-viewport-item="${id}"]`)
  const first = item("right-first")
  const second = item("right-second")
  const fill = item("right-fill")
  const canvas = page.locator('canvas[aria-label="Fixture viewport"]')
  const draft = page.getByRole("textbox", { name: "Retained slot draft" })
  await draft.fill("28")
  const original = await draft.elementHandle()
  await expect
    .poll(async () => {
      const a = await first.boundingBox(),
        b = await second.boundingBox(),
        c = await fill.boundingBox()
      return Boolean(a && b && c && a.x === b.x && b.y >= a.y + a.height && c.x >= a.x + a.width)
    })
    .toBe(true)
  for (const [aId, bId] of [
    ["left-first", "left-second"],
    ["bottom-first", "bottom-second"],
  ] as const) {
    const a = await item(aId).boundingBox(),
      b = await item(bId).boundingBox()
    if (!a || !b) throw new Error("Every visible slot item must have bounds.")
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
  }
  const before = await canvas.first().boundingBox()
  await page.evaluate(async (url) => {
    const fixture = await import(/* @vite-ignore */ url)
    fixture.renderViewportGridFixture({ firstFullHeight: true })
  }, fixtureUrl)
  await expect
    .poll(async () => {
      const a = await first.boundingBox(),
        b = await second.boundingBox()
      return Boolean(a && b && a.x !== b.x)
    })
    .toBe(true)
  expect(await draft.evaluate((node, original) => node === original, original)).toBe(true)
  await expect(draft).toHaveValue("28")
  await expect.poll(() => canvas.first().boundingBox()).toEqual(before)
  await page.evaluate(async (url) => {
    const fixture = await import(/* @vite-ignore */ url)
    fixture.renderViewportGridFixture({ firstVisible: false })
  }, fixtureUrl)
  await expect(draft).toBeHidden()
  await page.evaluate(async (url) => {
    const fixture = await import(/* @vite-ignore */ url)
    fixture.renderViewportGridFixture()
  }, fixtureUrl)
  await expect(draft).toHaveValue("28")
  expect(await draft.evaluate((node, original) => node === original, original)).toBe(true)
})

test("packs explicit side heights and lets full-height occupation override them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto("/")
  const render = (firstHeight: string, firstFullHeight = false) =>
    page.evaluate(
      async ({ url, firstHeight, firstFullHeight }) => {
        const fixture = await import(/* @vite-ignore */ url)
        fixture.renderViewportGridFixture({ firstHeight, firstFullHeight })
      },
      { url: fixtureUrl, firstHeight, firstFullHeight },
    )
  const first = page.locator('[data-viewport-item="right-first"]')
  const second = page.locator('[data-viewport-item="right-second"]')
  const height = () => first.evaluate((node) => node.getBoundingClientRect().height)
  const columnsMatch = () =>
    first.evaluate((element) => {
      const second = element.ownerDocument.querySelector('[data-viewport-item="right-second"]')
      if (!second) throw new Error("Both side items must be mounted.")
      return element.getBoundingClientRect().x === second.getBoundingClientRect().x
    })
  await render("180px")
  await expect.poll(height).toBe(180)
  await expect.poll(columnsMatch).toBe(true)
  const firstBounds = await first.boundingBox()
  const secondBounds = await second.boundingBox()
  if (!firstBounds || !secondBounds) throw new Error("Both side items must have bounds.")
  expect(secondBounds.y).toBeGreaterThanOrEqual(firstBounds.y + 180)
  await render("650px")
  await expect.poll(height).toBe(650)
  await expect.poll(columnsMatch).toBe(false)
  await render("180px", true)
  await expect.poll(height).toBeGreaterThan(650)
  await expect.poll(columnsMatch).toBe(false)
})
