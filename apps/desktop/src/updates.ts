import { createHash, randomUUID } from "node:crypto"
import { lstat, open, rm } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { gt, parse, valid } from "semver"
import { z } from "zod"
import { desktopArtifactName } from "./desktop-platform"
import { publishVerifiedUpdate } from "./update-publication"

const repositoryUrl = "https://github.com/kolengri/VibeShape"
const releasesUrl = "https://api.github.com/repos/kolengri/VibeShape/releases?per_page=100&page=1"
const maximumAssetSize = 1024 * 1024 * 1024
const maximumMetadataSize = 2 * 1024 * 1024
const redirects = new Set([301, 302, 303, 307, 308])

type DesktopUpdateFailure =
  | { kind: "http"; status: number }
  | { kind: "network" | "invalid-response" | "integrity" | "destination" | "destination-exists" }

export class DesktopUpdateError extends Error {
  constructor(
    readonly failure: DesktopUpdateFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "DesktopUpdateError"
  }
}

function isStableVersion(version: string): boolean {
  const parsed = parse(version)
  return (
    parsed !== null &&
    parsed.raw === parsed.version &&
    parsed.prerelease.length === 0 &&
    parsed.build.length === 0
  )
}

const stableVersionSchema = z.string().min(1).max(64).refine(isStableVersion)
const assetSizeSchema = z.number().int().positive().max(maximumAssetSize)
const releaseSchema = z
  .strictObject({
    version: stableVersionSchema,
    url: z.string().max(512),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    size: assetSizeSchema,
    fileName: z.string().max(128),
    releaseUrl: z.string().max(512),
  })
  .superRefine((release, context) => {
    const tag = `desktop-v${release.version}`
    const names = [
      desktopArtifactName(release.version, "arm64", "darwin"),
      desktopArtifactName(release.version, "x64", "darwin"),
      desktopArtifactName(release.version, "x64", "win32"),
    ]
    if (
      !names.includes(release.fileName) ||
      release.url !== `${repositoryUrl}/releases/download/${tag}/${release.fileName}` ||
      release.releaseUrl !== `${repositoryUrl}/releases/tag/${tag}`
    ) {
      context.addIssue({ code: "custom", message: "Invalid desktop release." })
    }
  })

export type DesktopRelease = z.infer<typeof releaseSchema>

// GitHub adds API fields independently; only bounded, strictly typed fields used here survive parsing.
const githubReleaseSchema = z.object({
  tag_name: z.string().max(80).startsWith("desktop-v"),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string().max(512),
  assets: z.array(z.unknown()).max(100),
})
const githubAssetSchema = z.object({
  name: z.string().max(128),
  state: z.literal("uploaded"),
  browser_download_url: z.string().max(512),
  digest: z.string().regex(/^sha256:[a-fA-F0-9]{64}$/),
  size: assetSizeSchema,
})
const githubReleasesSchema = z.array(z.unknown()).max(100)
const destinationSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => isAbsolute(path) && !path.includes("\0") && dirname(path) !== path)

type DownloadOptions = {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/** A request port uses logical GitHub URLs; redirect policy is enforced above the transport. */
export type DesktopUpdateTransport = (
  url: string,
  options: {
    signal: AbortSignal
    headers: Readonly<Record<string, string>>
    redirect: "manual"
    credentials: "omit"
  },
) => Promise<Response>

async function requestUpdate(
  transport: DesktopUpdateTransport,
  url: string,
  options: Parameters<DesktopUpdateTransport>[1],
) {
  try {
    return await transport(url, options)
  } catch (cause) {
    if (options.signal.aborted) throw cause
    throw new DesktopUpdateError({ kind: "network" }, "Desktop update request failed.", { cause })
  }
}

function operationSignal(signal: AbortSignal | undefined, milliseconds: number) {
  const deadline = AbortSignal.timeout(milliseconds)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

async function discardBody(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

async function destinationOperation<T>(operation: () => Promise<T>, occupiedIsConflict = false) {
  try {
    return await operation()
  } catch (cause) {
    if (occupiedIsConflict && fileErrorCode(cause) === "EEXIST")
      throw new DesktopUpdateError(
        { kind: "destination-exists" },
        "The desktop update destination already exists.",
        { cause },
      )
    throw new DesktopUpdateError(
      { kind: "destination" },
      "Desktop update destination could not be written.",
      { cause },
    )
  }
}

function fileErrorCode(error: unknown) {
  return error instanceof Error && "code" in error ? error.code : undefined
}

async function requireAvailableDestination(destination: string) {
  try {
    await lstat(destination)
  } catch (cause) {
    if (fileErrorCode(cause) === "ENOENT") return
    throw new DesktopUpdateError(
      { kind: "destination" },
      "The desktop update destination could not be inspected.",
      { cause },
    )
  }
  throw new DesktopUpdateError(
    { kind: "destination-exists" },
    "The desktop update destination already exists.",
  )
}

function declaredLength(response: Response): number | null {
  const value = response.headers.get("content-length")
  if (value === null) return null
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update response has an invalid content length.",
    )
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) {
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update response has an invalid content length.",
    )
  }
  return length
}

async function readMetadata(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body)
    throw new DesktopUpdateError({ kind: "invalid-response" }, "Desktop update metadata is empty.")
  const reader = response.body.getReader()
  try {
    const length = declaredLength(response)
    if (length !== null && length > maximumMetadataSize) {
      throw new DesktopUpdateError(
        { kind: "invalid-response" },
        "Desktop update metadata exceeds its size limit.",
      )
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximumMetadataSize) {
        throw new DesktopUpdateError(
          { kind: "invalid-response" },
          "Desktop update metadata exceeds its size limit.",
        )
      }
      chunks.push(chunk.value)
    }
    signal.throwIfAborted()
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
    } catch {
      throw new DesktopUpdateError(
        { kind: "invalid-response" },
        "Desktop update metadata is not valid JSON.",
      )
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function desktopReleaseCandidate(
  candidate: unknown,
  arch: "arm64" | "x64",
  platform: NodeJS.Platform,
): DesktopRelease | null {
  const parsed = githubReleaseSchema.safeParse(candidate)
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) return null
  const release = parsed.data
  const version = stableVersionSchema.safeParse(release.tag_name.slice("desktop-v".length))
  if (!version.success) return null
  const expectedName = desktopArtifactName(version.data, arch, platform)
  for (const candidateAsset of release.assets) {
    const asset = githubAssetSchema.safeParse(candidateAsset)
    if (!asset.success || asset.data.name !== expectedName) continue
    const descriptor = releaseSchema.safeParse({
      version: version.data,
      url: asset.data.browser_download_url,
      sha256: asset.data.digest.slice("sha256:".length).toLowerCase(),
      size: asset.data.size,
      fileName: asset.data.name,
      releaseUrl: release.html_url,
    })
    if (descriptor.success) return descriptor.data
  }
  return null
}

function selectRelease(
  metadata: unknown,
  currentVersion: string,
  arch: "arm64" | "x64",
  platform: NodeJS.Platform,
) {
  const releases = githubReleasesSchema.safeParse(metadata)
  if (!releases.success)
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update release list is invalid.",
    )
  let selected: DesktopRelease | null = null
  for (const candidate of releases.data) {
    const release = desktopReleaseCandidate(candidate, arch, platform)
    if (
      release !== null &&
      gt(release.version, currentVersion) &&
      (selected === null || gt(release.version, selected.version))
    )
      selected = release
  }
  return selected
}

function redirectedAssetUrl(location: string | null, from: string): string {
  if (location === null || location.length > 8192) {
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update download has an invalid redirect.",
    )
  }
  let url: URL
  try {
    url = new URL(location, from)
  } catch {
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update download has an invalid redirect.",
    )
  }
  if (
    url.origin !== "https://release-assets.githubusercontent.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new DesktopUpdateError(
      { kind: "invalid-response" },
      "Desktop update download redirected outside GitHub release assets.",
    )
  }
  return url.href
}

async function assetResponse(
  transport: DesktopUpdateTransport,
  release: DesktopRelease,
  signal: AbortSignal,
) {
  const options = {
    signal,
    headers: { Accept: "application/octet-stream" },
    redirect: "manual",
    credentials: "omit",
  } satisfies Parameters<DesktopUpdateTransport>[1]
  let response = await requestUpdate(transport, release.url, options)
  if (redirects.has(response.status)) {
    await discardBody(response)
    const url = redirectedAssetUrl(response.headers.get("location"), release.url)
    response = await requestUpdate(transport, url, options)
  }
  try {
    if (response.status !== 200) {
      throw new DesktopUpdateError(
        { kind: "http", status: response.status },
        `Desktop update download failed (HTTP ${response.status}).`,
      )
    }
    const length = declaredLength(response)
    if (length !== null && length !== release.size) {
      throw new DesktopUpdateError(
        { kind: "integrity" },
        "Desktop update download size does not match release metadata.",
      )
    }
    if (!response.body)
      throw new DesktopUpdateError({ kind: "integrity" }, "Desktop update download is empty.")
    return response
  } catch (error) {
    await discardBody(response)
    throw error
  }
}

async function writeVerifiedDownload(
  response: Response,
  release: DesktopRelease,
  destination: string,
  signal: AbortSignal,
  onProgress: DownloadOptions["onProgress"],
) {
  if (!response.body)
    throw new DesktopUpdateError({ kind: "integrity" }, "Desktop update download is empty.")
  const partial = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.partial`)
  const hash = createHash("sha256")
  const reader = response.body.getReader()
  let received = 0
  let ownsPartial = false
  async function* chunks() {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) return
      received += chunk.value.byteLength
      if (received > release.size) {
        throw new DesktopUpdateError(
          { kind: "integrity" },
          "Desktop update download exceeds its advertised size.",
        )
      }
      hash.update(chunk.value)
      yield chunk.value
      onProgress?.(received / release.size)
    }
  }
  try {
    const file = await destinationOperation(() => open(partial, "wx", 0o600))
    ownsPartial = true
    try {
      await pipeline(Readable.from(chunks(), { objectMode: false }), file.createWriteStream(), {
        signal,
      })
    } finally {
      await destinationOperation(() => file.close())
    }
    signal.throwIfAborted()
    if (received !== release.size) {
      throw new DesktopUpdateError(
        { kind: "integrity" },
        "Desktop update download size does not match release metadata.",
      )
    }
    if (hash.digest("hex") !== release.sha256.toLowerCase()) {
      throw new DesktopUpdateError(
        { kind: "integrity" },
        "Desktop update download failed SHA-256 verification.",
      )
    }
    await destinationOperation(() => publishVerifiedUpdate(partial, destination, signal), true)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
    if (ownsPartial) await destinationOperation(() => rm(partial, { force: true }))
  }
}

/** Creates the update service at its HTTP transport boundary; policies never depend on adapter URLs. */
export function createDesktopUpdateClient(
  transport: DesktopUpdateTransport,
  platform: NodeJS.Platform = process.platform,
) {
  return {
    async findDesktopUpdate(
      currentVersion: string,
      arch: "arm64" | "x64",
      signal?: AbortSignal,
    ): Promise<DesktopRelease | null> {
      if (currentVersion.length > 64 || valid(currentVersion) === null) {
        throw new Error("The current desktop version is invalid.")
      }
      if (arch !== "arm64" && arch !== "x64") {
        throw new Error("The desktop architecture is unsupported.")
      }
      desktopArtifactName(currentVersion, arch, platform)
      const boundedSignal = operationSignal(signal, 15_000)
      boundedSignal.throwIfAborted()
      const response = await requestUpdate(transport, releasesUrl, {
        signal: boundedSignal,
        redirect: "manual",
        credentials: "omit",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "VibeShape-Desktop",
        },
      })
      if (response.status !== 200) {
        await discardBody(response)
        throw new DesktopUpdateError(
          { kind: "http", status: response.status },
          `Desktop update check failed (HTTP ${response.status}).`,
        )
      }
      return selectRelease(
        await readMetadata(response, boundedSignal),
        currentVersion,
        arch,
        platform,
      )
    },
    async downloadDesktopUpdate(
      release: DesktopRelease,
      destination: string,
      options: DownloadOptions = {},
    ): Promise<void> {
      const descriptor = releaseSchema.safeParse(release)
      if (!descriptor.success)
        throw new DesktopUpdateError(
          { kind: "invalid-response" },
          "Desktop update metadata is invalid.",
        )
      if (!destinationSchema.safeParse(destination).success) {
        throw new DesktopUpdateError(
          { kind: "destination" },
          "The desktop update destination is invalid.",
        )
      }
      const signal = operationSignal(options.signal, 10 * 60_000)
      signal.throwIfAborted()
      await requireAvailableDestination(destination)
      signal.throwIfAborted()
      const response = await assetResponse(transport, descriptor.data, signal)
      await writeVerifiedDownload(
        response,
        descriptor.data,
        destination,
        signal,
        options.onProgress,
      )
    },
  }
}

const desktopUpdates = createDesktopUpdateClient((url, options) => fetch(url, options))

export const findDesktopUpdate = desktopUpdates.findDesktopUpdate
export const downloadDesktopUpdate = desktopUpdates.downloadDesktopUpdate
