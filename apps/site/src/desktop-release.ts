import { useEffect, useState } from "react"
import { z } from "zod"
import { releasesApiUrl, releasesUrl } from "./links"

const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.iso.datetime().nullable(),
    assets: z.array(
      z.object({
        name: z.string(),
        state: z.string(),
        browser_download_url: z.url(),
      }),
    ),
  }),
)

export type DesktopRelease = { version: string; downloadUrl: string }
type DesktopReleases = { mac: DesktopRelease | null; windows: DesktopRelease | null }
type InstallerSuffix = "mac-arm64.dmg" | "win-x64.zip"

function desktopInstaller(
  release: z.infer<typeof releasesSchema>[number],
  suffix: InstallerSuffix,
): DesktopRelease | null {
  const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1]
  if (!version) return null
  const name = `VibeShape-${version}-${suffix}`
  const downloadUrl = `${releasesUrl}/download/${release.tag_name}/${name}`
  const uploaded = release.assets.some(
    (asset) =>
      asset.state === "uploaded" &&
      asset.name === name &&
      asset.browser_download_url === downloadUrl,
  )
  return uploaded ? { version: `v${version}`, downloadUrl } : null
}

function latestInstaller(releases: z.infer<typeof releasesSchema>, suffix: InstallerSuffix) {
  return releases.map((release) => desktopInstaller(release, suffix)).find(Boolean) ?? null
}

async function loadDesktopRelease(signal: AbortSignal): Promise<DesktopReleases | null> {
  const response = await fetch(releasesApiUrl, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-cache",
    signal,
  })
  if (!response.ok) return null
  const parsed = releasesSchema.safeParse(await response.json())
  if (!parsed.success) return null

  const stable = parsed.data
    .filter((release) => !release.draft && !release.prerelease && release.published_at)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
  return {
    mac: latestInstaller(stable, "mac-arm64.dmg"),
    windows: latestInstaller(stable, "win-x64.zip"),
  }
}

export function useDesktopRelease() {
  const [release, setRelease] = useState<DesktopReleases>({ mac: null, windows: null })
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    void loadDesktopRelease(controller.signal)
      .then((result) => {
        if (result && !controller.signal.aborted) setRelease(result)
      })
      .catch(() => {
        // The release listing stays usable when GitHub is unavailable or rate limited.
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [])
  return release
}
