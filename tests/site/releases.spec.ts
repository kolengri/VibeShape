import { expect, test } from "@playwright/test"

const endpoint = "https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100"

function desktopRelease(version: string, publishedAt = "2026-10-20T12:00:00Z") {
  return {
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: false,
    published_at: publishedAt,
    assets: [
      {
        name: `VibeShape-${version}-mac-arm64.dmg`,
        state: "uploaded",
        browser_download_url: `https://github.com/kolengri/VibeShape/releases/download/desktop-v${version}/VibeShape-${version}-mac-arm64.dmg`,
      },
    ],
  }
}

test("downloads select a complete stable desktop release and refresh without rebuilding", async ({
  page,
}) => {
  const incomplete = desktopRelease("2.0.0")
  const foreignAsset = desktopRelease("3.0.0")
  let releases = [
    desktopRelease("1.1.0", "2026-10-18T12:00:00Z"),
    { ...desktopRelease("5.0.0"), tag_name: "cloudflare-occt-123" },
    { ...desktopRelease("4.0.0"), prerelease: true },
    { ...desktopRelease("4.0.1"), draft: true },
    { ...desktopRelease("4.0.2"), published_at: null },
    { ...incomplete, assets: [{ ...incomplete.assets[0], state: "starter" }] },
    { ...desktopRelease("2.0.1"), assets: [] },
    {
      ...foreignAsset,
      assets: [{ ...foreignAsset.assets[0], browser_download_url: "https://example.com/app.dmg" }],
    },
    desktopRelease("1.2.0", "2026-10-19T12:00:00Z"),
  ]
  let requests = 0
  await page.route(endpoint, async (route) => {
    requests++
    await route.fulfill({ json: releases })
  })
  await page.goto("/#downloads")
  const downloads = page.locator("#downloads")
  const action = downloads.getByRole("link", { name: "Download for Apple Silicon" })
  await expect(downloads.getByText("macOS · Apple Silicon · v1.2.0", { exact: true })).toBeVisible()
  await expect(action).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/releases/download/desktop-v1.2.0/VibeShape-1.2.0-mac-arm64.dmg",
  )
  releases = [desktopRelease("1.3.0")]
  await page.reload()
  await expect(downloads.getByText("macOS · Apple Silicon · v1.3.0", { exact: true })).toBeVisible()
  await expect(action).toHaveAttribute(
    "href",
    "https://github.com/kolengri/VibeShape/releases/download/desktop-v1.3.0/VibeShape-1.3.0-mac-arm64.dmg",
  )
  expect(requests).toBe(2)
})

for (const scenario of [
  "rate limit",
  "network failure",
  "invalid JSON",
  "invalid shape",
  "no installer",
]) {
  test(`downloads keep a usable release listing on ${scenario}`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route(endpoint, async (route) => {
      if (scenario === "network failure") return route.abort()
      if (scenario === "rate limit")
        return route.fulfill({ status: 403, json: { message: "rate limited" } })
      if (scenario === "invalid JSON") return route.fulfill({ body: "not JSON" })
      if (scenario === "invalid shape")
        return route.fulfill({ json: [{ tag_name: "desktop-v9.9.9" }] })
      return route.fulfill({ json: [{ ...desktopRelease("1.0.0"), assets: [] }] })
    })
    const settled =
      scenario === "network failure"
        ? page.waitForEvent("requestfailed", (request) => request.url() === endpoint)
        : page.waitForResponse(endpoint).then((response) => response.finished())
    await page.goto("/#downloads")
    await settled
    await expect(
      page.locator("#downloads").getByText("macOS · Apple Silicon", { exact: true }),
    ).toBeVisible()
    const action = page.getByRole("link", { name: "View desktop releases", exact: true })
    await expect(action).toHaveAttribute("href", "https://github.com/kolengri/VibeShape/releases")
    await expect(page.getByRole("link", { name: "Download for Apple Silicon" })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
