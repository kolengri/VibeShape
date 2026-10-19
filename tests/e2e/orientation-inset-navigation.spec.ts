import { resolve } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

type Projection = Readonly<Record<"a" | "b" | "c" | "d" | "e" | "f", number>>
type Frame = Readonly<{
  origin: readonly number[]
  xAxis: readonly number[]
  yAxis: readonly number[]
  normal: readonly number[]
}>
type FixtureCanvas = {
  style: { cssText: string }
  setAttribute(name: string, value: string): void
  addEventListener(
    type: string,
    listener: (event: { pointerId: number }) => void,
    capture: boolean,
  ): void
  dispatchEvent(event: unknown): void
  remove(): void
}
type FixtureViewport = {
  clearSketchProjection(): void
  fit(): void
  setMeshes(meshes: unknown[]): void
  setGroundGrid(enabled: boolean): void
  setOriginPlaneVisibility(visibility: Record<"xy" | "xz" | "yz", boolean>): void
  orientToFrame(frame: Frame): boolean
  setStandardView(view: "top" | "right"): void
  setPointerOrbit(enabled: boolean): void
  setSketchPlaneProjection(frame: Frame, publish: (projection: Projection | null) => void): void
  setSketchProjection(
    frame: Frame,
    bounds: Readonly<{ minX: number; minY: number; width: number; height: number }>,
  ): boolean
  dispose(): void
}
type FixtureBrowser = {
  requestAnimationFrame(callback: () => void): number
  document: {
    createElement(tag: "canvas"): FixtureCanvas
    body: { append(canvas: FixtureCanvas): void }
  }
  PointerEvent: new (type: string, options: Record<string, unknown>) => unknown
  orientationFixture: {
    canvas: FixtureCanvas
    viewport: FixtureViewport
    frame: Frame
    projection: Projection | null
    selections: number
    pointerId: number
  }
}

async function projection(page: Page) {
  return page.evaluate(
    () => (globalThis as unknown as FixtureBrowser).orientationFixture.projection,
  )
}

async function requiredProjection(page: Page): Promise<Projection> {
  const value = await projection(page)
  if (!value) throw new Error("The navigation fixture support-plane projection is missing.")
  return value
}

async function wheelAt(page: Page, x: number, y: number, steps: number, delta: number) {
  await page.mouse.move(x, y)
  for (let index = 0; index < steps; index += 1) await page.mouse.wheel(0, delta)
}

function expectProjectionClose(actual: Projection, expected: Projection, precision: number) {
  for (const coefficient of ["a", "b", "c", "d", "e", "f"] as const) {
    expect(actual[coefficient]).toBeCloseTo(expected[coefficient], precision)
  }
}

async function panAndOrbitResponse(page: Page) {
  await page.evaluate(() =>
    (globalThis as unknown as FixtureBrowser).orientationFixture.viewport.setStandardView("top"),
  )
  await expect.poll(async () => (await projection(page))?.b).toBeCloseTo(0, 12)
  const before = await requiredProjection(page)
  await page.mouse.move(320, 240)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(344, 228, { steps: 4 })
  await page.mouse.up({ button: "right" })
  await expect.poll(() => projection(page)).not.toEqual(before)
  const panned = await requiredProjection(page)
  await page.mouse.down({ button: "right" })
  await page.mouse.move(320, 240, { steps: 4 })
  await page.mouse.up({ button: "right" })
  await expect.poll(async () => (await projection(page))?.e).toBeCloseTo(before.e, 10)
  await expect.poll(async () => (await projection(page))?.f).toBeCloseTo(before.f, 10)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(344, 228, { steps: 4 })
  await page.mouse.up({ button: "middle" })
  await expect.poll(() => projection(page)).not.toEqual(before)
  const orbited = await requiredProjection(page)
  await page.evaluate(() =>
    (globalThis as unknown as FixtureBrowser).orientationFixture.viewport.setStandardView("top"),
  )
  await expect.poll(async () => (await projection(page))?.b).toBeCloseTo(0, 12)
  return { before, panned, orbited }
}

test.use({ autoCreateProject: false })

async function createNavigationFixture(page: Page, cube = false) {
  await page.goto("/")
  await page.evaluate(
    async ({ viewerPath, cube }) => {
      const browser = globalThis as unknown as FixtureBrowser
      const viewer: {
        createGeometryViewport(
          canvas: FixtureCanvas,
          options: Record<string, unknown>,
        ): FixtureViewport
      } = await import(viewerPath)
      const canvas = browser.document.createElement("canvas")
      canvas.setAttribute("data-testid", "orientation-navigation-fixture")
      canvas.style.cssText = "position:fixed;left:0;top:0;width:640px;height:480px;z-index:99999"
      browser.document.body.append(canvas)
      canvas.addEventListener(
        "pointerdown",
        (event) => {
          browser.orientationFixture.pointerId = event.pointerId
        },
        true,
      )
      const viewport = viewer.createGeometryViewport(canvas, {
        onSelectionChange: () => {
          browser.orientationFixture.selections += 1
        },
      })
      const frame = {
        origin: [110, -70, 45],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      }
      browser.orientationFixture = {
        canvas,
        viewport,
        frame,
        projection: null,
        selections: 0,
        pointerId: 0,
      }
      viewport.setGroundGrid(false)
      viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
      const positions = cube
        ? [-10, 10].flatMap((x) =>
            [-10, 10].flatMap((y) => [-10, 10].flatMap((z) => [110 + x, -70 + y, 45 + z])),
          )
        : [-90, -270, 45, 310, -270, 45, 310, 130, 45, -90, 130, 45]
      const indices = cube
        ? [
            0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3, 0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5,
            1, 2, 3, 7, 2, 7, 6,
          ]
        : [0, 1, 2, 0, 2, 3]
      viewport.setMeshes([
        {
          featureId: "inset-underlying-face",
          positions: new Float32Array(positions),
          normals: new Float32Array(positions.map((_, index) => (index % 3 === 2 ? 1 : 0))),
          indices: new Uint32Array(indices),
          triangleFaceIds: new Uint32Array(indices.length / 3).fill(1),
        },
      ])
      if (cube) viewport.fit()
      else if (!viewport.orientToFrame(frame)) {
        throw new Error("The nonzero support frame is invalid.")
      }
      viewport.setSketchPlaneProjection(frame, (value) => {
        browser.orientationFixture.projection = value
      })
    },
    { viewerPath: `/@fs${resolve("packages/viewer/src/three-viewport.ts")}`, cube },
  )
}

async function modelPointProjections(page: Page) {
  return page.evaluate(() => {
    const state = (globalThis as unknown as FixtureBrowser).orientationFixture
    const points = [
      [110, -70, 45],
      ...[-10, 10].flatMap((x) =>
        [-10, 10].flatMap((y) => [-10, 10].map((z) => [110 + x, -70 + y, 45 + z])),
      ),
    ]
    const projected: { x: number; y: number }[] = []
    for (const origin of points) {
      state.viewport.setSketchPlaneProjection({ ...state.frame, origin }, (value) => {
        if (!value) throw new Error("The model vertex cannot be projected.")
        projected.push({ x: value.e * 640, y: value.f * 480 })
      })
    }
    state.viewport.setSketchPlaneProjection(state.frame, (value) => {
      state.projection = value
    })
    return projected
  })
}

async function disposeNavigationFixture(page: Page) {
  await page.evaluate(() => {
    const state = (globalThis as unknown as FixtureBrowser).orientationFixture
    state.viewport.dispose()
    state.canvas.remove()
  })
}

async function assertInsetOrbit(page: Page) {
  await expect(page.getByTestId("orientation-navigation-fixture")).toHaveAttribute(
    "data-orientation-inset",
    "8,8,80",
  )
  await wheelAt(page, 320, 240, 1, -120)
  await expect.poll(async () => (await projection(page))?.a).not.toBeCloseTo(1 / ((100 * 4) / 3), 8)
  const baseline = await requiredProjection(page)
  expect(baseline.e).toBeCloseTo(0.5, 12)
  expect(baseline.f).toBeCloseTo(0.5, 12)
  await page.mouse.move(48, 432)
  await page.mouse.down()
  await page.mouse.move(175, 370, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => projection(page)).not.toEqual(baseline)
  const rotated = await requiredProjection(page)
  expect(rotated.e).toBeCloseTo(0.5, 12)
  expect(rotated.f).toBeCloseTo(0.5, 12)
  expect(
    await page.evaluate(
      () => (globalThis as unknown as FixtureBrowser).orientationFixture.selections,
    ),
  ).toBe(0)
  return baseline
}

async function assertAxisClick(page: Page, baseline: Projection) {
  await page.evaluate(() =>
    (globalThis as unknown as FixtureBrowser).orientationFixture.viewport.setStandardView("top"),
  )
  await expect.poll(() => projection(page)).toEqual(baseline)
  // In the top view, the visible +X endpoint is 26 CSS pixels right of the inset center.
  await page.mouse.click(74, 432)
  await expect.poll(() => projection(page)).toBeNull()
  await page.evaluate(() => {
    const state = (globalThis as unknown as FixtureBrowser).orientationFixture
    state.viewport.setSketchPlaneProjection(
      {
        origin: state.frame.origin,
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
      },
      (value) => {
        state.projection = value
      },
    )
  })
  const right = await requiredProjection(page)
  expect(right.a).toBeCloseTo(baseline.a, 12)
  expect(right.d).toBeCloseTo(baseline.d, 12)
  expect(right.e).toBeCloseTo(0.5, 12)
  expect(right.f).toBeCloseTo(0.5, 12)
  await page.evaluate(() => {
    const state = (globalThis as unknown as FixtureBrowser).orientationFixture
    state.viewport.setStandardView("top")
    state.viewport.setSketchPlaneProjection(state.frame, (value) => {
      state.projection = value
    })
  })
  await expect.poll(() => projection(page)).toEqual(baseline)
}

async function assertCancelRecovery(page: Page, baseline: Projection) {
  await page.mouse.move(48, 432)
  await page.mouse.down()
  await page.evaluate(() => {
    const browser = globalThis as unknown as FixtureBrowser
    browser.orientationFixture.canvas.dispatchEvent(
      new browser.PointerEvent("pointercancel", {
        pointerId: browser.orientationFixture.pointerId,
        isPrimary: true,
        bubbles: true,
      }),
    )
  })
  await page.mouse.up()
  await page.mouse.move(320, 240)
  await page.mouse.down()
  await page.mouse.move(385, 210, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => projection(page)).not.toEqual(baseline)
}

type NavigationResponse = Awaited<ReturnType<typeof panAndOrbitResponse>>

function expectNavigationResponseClose(actual: NavigationResponse, expected: NavigationResponse) {
  for (const phase of ["before", "panned", "orbited"] as const) {
    expectProjectionClose(actual[phase], expected[phase], 9)
  }
}

async function assertFixedCursorZoomResponse(page: Page) {
  const before = await panAndOrbitResponse(page)
  // Keep the cursor off center to exercise pointer-centered target changes, too.
  await wheelAt(page, 560, 120, 50, -120)
  await expect.poll(async () => (await projection(page))?.a).not.toBeCloseTo(before.before.a, 8)
  await wheelAt(page, 560, 120, 50, 120)
  await expect.poll(async () => (await projection(page))?.a).toBeCloseTo(before.before.a, 10)
  const after = await panAndOrbitResponse(page)
  expectNavigationResponseClose(after, before)
  return after
}

async function assertMovedCursorZoomResponse(page: Page, before: NavigationResponse) {
  await wheelAt(page, 560, 120, 10, -120)
  await wheelAt(page, 120, 360, 10, 120)
  await expect.poll(async () => (await projection(page))?.a).toBeCloseTo(before.before.a, 10)
  await expect.poll(async () => (await projection(page))?.e).not.toBeCloseTo(before.before.e, 8)
  const after = await panAndOrbitResponse(page)
  for (const coefficient of ["a", "b", "c", "d"] as const) {
    expect(after.orbited[coefficient]).toBeCloseTo(before.orbited[coefficient], 9)
  }
  for (const coefficient of ["e", "f"] as const) {
    const delta = (response: NavigationResponse) =>
      response.panned[coefficient] - response.before[coefficient]
    expect(delta(after)).toBeCloseTo(delta(before), 9)
  }
}

test("orbits from the orientation inset, preserves framing, and restores navigation after cancellation", async ({
  page,
}) => {
  await createNavigationFixture(page)
  try {
    const baseline = await assertInsetOrbit(page)
    await assertAxisClick(page, baseline)
    await assertCancelRecovery(page, baseline)
    const response = await assertFixedCursorZoomResponse(page)
    await assertMovedCursorZoomResponse(page, response)
  } finally {
    await disposeNavigationFixture(page)
  }
})

async function fitTop(page: Page) {
  await page.evaluate(async () => {
    const browser = globalThis as unknown as FixtureBrowser
    const { viewport } = browser.orientationFixture
    viewport.fit()
    viewport.setStandardView("top")
    // Fit publishes projection through the viewer's queued render, even when b is already zero.
    await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()))
  })
  await expect.poll(async () => (await projection(page))?.b).toBeCloseTo(0, 12)
  return requiredProjection(page)
}

test("fits the same model independently of earlier wheel zoom", async ({ page }) => {
  await createNavigationFixture(page)
  try {
    for (const empty of [false, true]) {
      if (empty) {
        await page.evaluate(() =>
          (globalThis as unknown as FixtureBrowser).orientationFixture.viewport.setMeshes([]),
        )
      }
      const fitted = await fitTop(page)
      await wheelAt(page, 560, 120, 20, 120)
      await expect.poll(async () => (await projection(page))?.a).not.toBeCloseTo(fitted.a, 8)
      await fitTop(page)
      await expect.poll(async () => (await projection(page))?.a).toBeCloseTo(fitted.a, 10)
      expectProjectionClose(await requiredProjection(page), fitted, 10)
    }
  } finally {
    await disposeNavigationFixture(page)
  }
})

test("uses sketch projection bounds once after model wheel zoom and keeps scale on return", async ({
  page,
}) => {
  await createNavigationFixture(page)
  try {
    await wheelAt(page, 320, 240, 20, -120)
    await page.evaluate(() => {
      const { viewport, frame } = (globalThis as unknown as FixtureBrowser).orientationFixture
      if (!viewport.setSketchProjection(frame, { minX: -40, minY: -30, width: 80, height: 60 })) {
        throw new Error("The sketch projection is invalid.")
      }
    })
    await expect.poll(async () => (await projection(page))?.a).toBeCloseTo(1 / 80, 10)
    await expect.poll(async () => (await projection(page))?.d).toBeCloseTo(-1 / 60, 10)
    const sketch = await requiredProjection(page)
    await page.evaluate(() => {
      const { viewport } = (globalThis as unknown as FixtureBrowser).orientationFixture
      viewport.clearSketchProjection()
    })
    await expect.poll(() => projection(page)).toEqual(sketch)
    await wheelAt(page, 560, 120, 10, -120)
    await wheelAt(page, 560, 120, 10, 120)
    await expect.poll(async () => (await projection(page))?.a).toBeCloseTo(1 / 80, 10)
    await expect.poll(async () => (await projection(page))?.e).toBeCloseTo(sketch.e, 10)
    await expect.poll(async () => (await projection(page))?.f).toBeCloseTo(sketch.f, 10)
  } finally {
    await disposeNavigationFixture(page)
  }
})

type OrbitGesture = "left" | "middle" | "inset" | "free"
type ModelPoint = { x: number; y: number }

function requiredPoint(points: ModelPoint[], index: number) {
  const point = points[index]
  if (!point) throw new Error(`The model vertex fixture is missing point ${index}.`)
  return point
}

async function orbitFromGesture(page: Page, gesture: OrbitGesture) {
  const x = gesture === "inset" ? 48 : 320
  const y = gesture === "inset" ? 432 : 240
  if (gesture === "free") {
    await page.evaluate(() =>
      (globalThis as unknown as FixtureBrowser).orientationFixture.viewport.setPointerOrbit(true),
    )
  }
  await page.mouse.move(x, y)
  if (gesture === "free") {
    await page.mouse.move(x + 12, y, { steps: 4 })
    return
  }
  const button = gesture === "middle" ? "middle" : "left"
  await page.mouse.down({ button })
  await page.mouse.move(x + 12, y, { steps: 4 })
  await page.mouse.up({ button })
}

async function orbitMotion(page: Page, gesture: OrbitGesture, zoomCycle: boolean) {
  await createNavigationFixture(page, true)
  try {
    if (zoomCycle) {
      await wheelAt(page, 560, 120, 20, -120)
      await wheelAt(page, 120, 360, 20, 120)
    }
    const before = await modelPointProjections(page)
    await orbitFromGesture(page, gesture)
    const after = await modelPointProjections(page)
    const motion = after.map((point, index) => {
      const previous = requiredPoint(before, index)
      return { x: point.x - previous.x, y: point.y - previous.y }
    })
    expect(motion).toHaveLength(9)
    const center = requiredPoint(motion, 0)
    expect(center.x).toBeCloseTo(0, 9)
    expect(center.y).toBeCloseTo(0, 9)
    expect(Math.max(...motion.map((point) => Math.hypot(point.x, point.y)))).toBeGreaterThan(10)
    return motion
  } finally {
    await disposeNavigationFixture(page)
  }
}

for (const gesture of ["left", "middle", "inset", "free"] as const) {
  test(`keeps model orbit motion stable after zoom for ${gesture} navigation`, async ({ page }) => {
    const fresh = await orbitMotion(page, gesture, false)
    const afterZoom = await orbitMotion(page, gesture, true)
    for (const [index, motion] of afterZoom.entries()) {
      const previous = requiredPoint(fresh, index)
      expect(motion.x).toBeCloseTo(previous.x, 9)
      expect(motion.y).toBeCloseTo(previous.y, 9)
    }
  })
}
