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

type DesktopRelease = { version: string; downloadUrl: string }

function desktopInstaller(release: z.infer<typeof releasesSchema>[number]): DesktopRelease | null {
  const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1]
  if (!version) return null
  const name = `VibeShape-${version}-mac-arm64.dmg`
  const downloadUrl = `${releasesUrl}/download/${release.tag_name}/${name}`
  const uploaded = release.assets.some(
    (asset) =>
      asset.state === "uploaded" &&
      asset.name === name &&
      asset.browser_download_url === downloadUrl,
  )
  return uploaded ? { version: `v${version}`, downloadUrl } : null
}

async function loadDesktopRelease(signal: AbortSignal): Promise<DesktopRelease | null> {
  const response = await fetch(releasesApiUrl, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-cache",
    signal,
  })
  if (!response.ok) return null
  const parsed = releasesSchema.safeParse(await response.json())
  if (!parsed.success) return null

  return (
    parsed.data
      .filter((release) => !release.draft && !release.prerelease && release.published_at)
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
      .map(desktopInstaller)
      .find((release) => release !== null) ?? null
  )
}

export function useDesktopRelease() {
  const [release, setRelease] = useState<DesktopRelease | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    void loadDesktopRelease(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRelease(result)
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
