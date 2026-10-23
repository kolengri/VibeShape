import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

test.use({ autoCreateProject: false })

const fixtureUrl = "/src/test-support/viewport-grid-fixture.tsx"

async function openFixturePage(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Projects", exact: true })).toBeVisible()
}

test("packs multiple arbitrary slot elements by size and full-height settings without remounting", async ({
  page,
}) => {
  await openFixturePage(page)
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
  await openFixturePage(page)
  const render = (firstHeight: string, firstFullHeight = false) =>
    page.evaluate(
      async ({ url, firstHeight, firstFullHeight }) => {
        const fixture = await import(/* @vite-ignore */ url)
        fixture.renderViewportGridFixture({ firstHeight, firstFullHeight })
      },
      { url: fixtureUrl, firstHeight, firstFullHeight },
    )
  const first = page.locator('[data-viewport-item="right-first"]')
  const height = () => first.evaluate((node) => node.getBoundingClientRect().height)
  const placement = () =>
    first.evaluate((element) => {
      const second = element.ownerDocument.querySelector('[data-viewport-item="right-second"]')
      if (!second) throw new Error("Both side items must be mounted.")
      const firstBounds = element.getBoundingClientRect()
      const secondBounds = second.getBoundingClientRect()
      return {
        sameColumn: firstBounds.x === secondBounds.x,
        below: secondBounds.y >= firstBounds.y + 180,
      }
    })
  await render("180px")
  await expect.poll(height).toBe(180)
  await expect.poll(placement).toEqual({ sameColumn: true, below: true })
  await render("650px")
  await expect.poll(height).toBe(650)
  await expect.poll(placement).toMatchObject({ sameColumn: false })
  await render("180px", true)
  await expect.poll(height).toBeGreaterThan(650)
  await expect.poll(placement).toMatchObject({ sameColumn: false })
})

for (const innerFullHeight of [false, true]) {
  test(`reserves chrome beside ${innerFullHeight ? "inner" : "outer"} full-height lanes on both sides without moving the canvas`, async ({
    page,
  }) => {
    await openFixturePage(page)
    const render = (leftFullHeight: boolean, leftVisible = true) =>
      page.evaluate(
        async ({ url, leftFullHeight, leftVisible, innerFullHeight }) => {
          const fixture = await import(/* @vite-ignore */ url)
          fixture.renderViewportGridFixture({ leftFullHeight, leftVisible, innerFullHeight })
        },
        { url: fixtureUrl, leftFullHeight, leftVisible, innerFullHeight },
      )
    await render(false)
    const canvas = page.locator('canvas[aria-label="Fixture viewport"]')
    await expect(canvas).toBeVisible()
    const bounds = await canvas.boundingBox()
    const original = await canvas.elementHandle()
    await render(true)
    const left = page.locator(
      `[data-viewport-item="${innerFullHeight ? "left-second" : "left-first"}"]`,
    )
    const right = page.locator('[data-viewport-item="right-fill"]')
    for (const surface of [
      page.locator("nav[data-sketch-mode]"),
      page.locator(".viewport-grid__bottom"),
      page.locator(".editor-workbench > footer"),
    ]) {
      await expect
        .poll(async () => {
          const l = await left.boundingBox()
          const r = await right.boundingBox()
          const s = await surface.boundingBox()
          if (!l || !r || !s) throw new Error("Chrome and full-height lanes must have bounds.")
          return { afterLeft: s.x >= l.x + l.width, beforeRight: s.x + s.width <= r.x }
        })
        .toEqual({ afterLeft: true, beforeRight: true })
    }
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds)
    await render(true, false)
    const root = await page.locator(".viewport-grid").boundingBox()
    if (!root) throw new Error("The viewport grid must have bounds.")
    await expect
      .poll(() =>
        page.locator("nav[data-sketch-mode]").evaluate((node) => node.getBoundingClientRect().x),
      )
      .toBe(root.x)
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds)
    expect(await canvas.evaluate((node, original) => node === original, original)).toBe(true)
  })
}
