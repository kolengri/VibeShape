import { expect, test } from "@playwright/test"

const endpoint = "https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100"
const releasesUrl = "https://github.com/kolengri/VibeShape/releases"

function desktopRelease(
  version: string,
  publishedAt = "2026-10-20T12:00:00Z",
  suffix = "mac-arm64.dmg",
) {
  return {
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: false,
    published_at: publishedAt,
    assets: [
      {
        name: `VibeShape-${version}-${suffix}`,
        state: "uploaded",
        browser_download_url: `${releasesUrl}/download/desktop-v${version}/VibeShape-${version}-${suffix}`,
      },
    ],
  }
}

for (const platform of ["mac", "windows"] as const) {
  const suffix = platform === "mac" ? "mac-arm64.dmg" : "win-x64.zip"
  const label = platform === "mac" ? "macOS · Apple Silicon" : "Windows · x64 · ZIP"
  const actionName = platform === "mac" ? "Download for Apple Silicon" : "Download for Windows x64"

  test(`${platform} downloads select the latest valid stable asset and refresh without rebuilding`, async ({
    page,
  }) => {
    const release = (version: string, date?: string) => desktopRelease(version, date, suffix)
    const incomplete = release("2.0.0")
    const foreignAsset = release("3.0.0")
    let releases = [
      release("9.0.0", "2026-10-17T12:00:00Z"),
      release("1.1.0", "2026-10-18T12:00:00Z"),
      { ...release("5.0.0"), tag_name: "cloudflare-occt-123" },
      { ...release("4.0.0"), prerelease: true },
      { ...release("4.0.1"), draft: true },
      { ...release("4.0.2"), published_at: null },
      { ...release("4.0.3"), tag_name: "desktop-v4.0.3-beta.1" },
      { ...incomplete, assets: [{ ...incomplete.assets[0], state: "starter" }] },
      { ...release("2.0.1"), assets: [] },
      {
        ...foreignAsset,
        assets: [
          { ...foreignAsset.assets[0], browser_download_url: `https://example.com/app.${suffix}` },
        ],
      },
      {
        ...release("3.0.1"),
        assets: [
          {
            ...release("3.0.1").assets[0],
            browser_download_url: `${releasesUrl}/download/desktop-v3.0.0/VibeShape-3.0.1-${suffix}`,
          },
        ],
      },
      {
        ...release("3.0.3"),
        assets: [{ ...release("3.0.3").assets[0], name: `VibeShape-3.0.3-other-${suffix}` }],
      },
      desktopRelease("3.0.2", undefined, platform === "mac" ? "mac-x64.dmg" : "win-arm64.zip"),
      release("1.2.0", "2026-10-19T12:00:00Z"),
    ]
    let requests = 0
    await page.route(endpoint, async (route) => {
      requests++
      await route.fulfill({ json: releases })
    })
    await page.goto("/#downloads")
    const downloads = page.locator("#downloads")
    const action = downloads.getByRole("link", { name: actionName, exact: true })
    await expect(downloads.getByText(`${label} · v1.2.0`, { exact: true })).toBeVisible()
    await expect(action).toHaveAttribute(
      "href",
      `${releasesUrl}/download/desktop-v1.2.0/VibeShape-1.2.0-${suffix}`,
    )
    releases = [release("1.3.0")]
    await page.reload()
    await expect(downloads.getByText(`${label} · v1.3.0`, { exact: true })).toBeVisible()
    await expect(action).toHaveAttribute(
      "href",
      `${releasesUrl}/download/desktop-v1.3.0/VibeShape-1.3.0-${suffix}`,
    )
    expect(requests).toBe(2)
  })

  test(`${platform} never substitutes the other platform's download`, async ({ page }) => {
    const otherSuffix = platform === "mac" ? "win-x64.zip" : "mac-arm64.dmg"
    await page.route(endpoint, (route) =>
      route.fulfill({ json: [desktopRelease("0.1.10", undefined, otherSuffix)] }),
    )
    await page.goto("/#downloads")
    const downloads = page.locator("#downloads")
    await expect(downloads.getByText(`${label}`, { exact: true })).toBeVisible()
    await expect(downloads.getByRole("link", { name: actionName, exact: true })).toHaveCount(0)
    await expect(
      downloads.getByRole("link", { name: "View desktop releases", exact: true }),
    ).toHaveAttribute("href", releasesUrl)
    await expect(downloads.getByText(/v0\.1\.10/, { exact: false })).toBeVisible()
  })
}

test("Mac and Windows retain independent versions from one release request", async ({ page }) => {
  let requests = 0
  await page.route(endpoint, (route) => {
    requests++
    return route.fulfill({
      json: [
        desktopRelease("0.1.9", "2026-10-19T12:00:00Z"),
        desktopRelease("0.1.10", "2026-10-20T12:00:00Z", "win-x64.zip"),
      ],
    })
  })
  await page.goto("/#downloads")
  const downloads = page.locator("#downloads")
  await expect(downloads.getByText("macOS · Apple Silicon · v0.1.9", { exact: true })).toBeVisible()
  await expect(downloads.getByText("Windows · x64 · ZIP · v0.1.10", { exact: true })).toBeVisible()
  await expect(downloads.getByRole("link", { name: "Download for Apple Silicon" })).toHaveAttribute(
    "href",
    `${releasesUrl}/download/desktop-v0.1.9/VibeShape-0.1.9-mac-arm64.dmg`,
  )
  await expect(downloads.getByRole("link", { name: "Download for Windows x64" })).toHaveAttribute(
    "href",
    `${releasesUrl}/download/desktop-v0.1.10/VibeShape-0.1.10-win-x64.zip`,
  )
  expect(requests).toBe(1)
})

for (const scenario of [
  "rate limit",
  "network failure",
  "invalid JSON",
  "invalid shape",
  "invalid asset URL",
  "no installer",
  "empty releases",
  "timeout",
]) {
  test(`downloads keep usable release listings on ${scenario}`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    if (scenario === "timeout") await page.clock.install()
    await page.route(endpoint, async (route) => {
      if (scenario === "timeout") return
      if (scenario === "network failure") return route.abort()
      if (scenario === "rate limit")
        return route.fulfill({ status: 403, json: { message: "rate limited" } })
      if (scenario === "invalid JSON") return route.fulfill({ body: "not JSON" })
      if (scenario === "invalid shape")
        return route.fulfill({ json: [{ tag_name: "desktop-v9.9.9" }] })
      if (scenario === "empty releases") return route.fulfill({ json: [] })
      if (scenario === "invalid asset URL") {
        const release = desktopRelease("9.9.9", undefined, "win-x64.zip")
        return route.fulfill({
          json: [
            { ...release, assets: [{ ...release.assets[0], browser_download_url: "invalid" }] },
          ],
        })
      }
      return route.fulfill({ json: [{ ...desktopRelease("1.0.0"), assets: [] }] })
    })
    const settled =
      scenario === "network failure" || scenario === "timeout"
        ? page.waitForEvent("requestfailed", (request) => request.url() === endpoint)
        : page.waitForResponse(endpoint).then((response) => response.finished())
    await page.goto("/#downloads")
    if (scenario === "timeout") await page.clock.fastForward(8001)
    await settled
    const downloads = page.locator("#downloads")
    await expect(downloads.getByText("macOS · Apple Silicon", { exact: true })).toBeVisible()
    await expect(downloads.getByText("Windows · x64 · ZIP", { exact: true })).toBeVisible()
    const actions = downloads.getByRole("link", { name: "View desktop releases", exact: true })
    await expect(actions).toHaveCount(2)
    for (const action of await actions.all()) {
      await expect(action).toHaveAttribute("href", releasesUrl)
    }
    await expect(downloads.getByRole("link", { name: "Download for Apple Silicon" })).toHaveCount(0)
    await expect(downloads.getByRole("link", { name: "Download for Windows x64" })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
