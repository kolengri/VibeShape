import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import {
  assertDistributionPath,
  type DistributionManifest,
  distributionHash,
  distributionInventory,
  verifyDistribution,
} from "./local-distribution-files"

const maximumAssetBytes = 25 * 1024 * 1024
const sourcePartBytes = 20 * 1024 * 1024
const sourceArchives = [
  "occt-corresponding-source.tar",
  "solvespace-corresponding-source.tar.gz",
  "vibeshape-source.tar",
] as const
const requiredNotices = [
  "browser-licenses.txt",
  "worker-licenses.txt",
  "shadcn-LICENSE.txt",
] as const

function writeSourceArchive(directory: string, name: string, bytes: Uint8Array) {
  if (!sourceArchives.some((allowed) => allowed === name))
    throw new Error("Only the three corresponding-source archives may be split.")
  const paths: string[] = []
  if (bytes.byteLength <= maximumAssetBytes) {
    paths.push(name)
  } else {
    for (let start = 0; start < bytes.byteLength; start += sourcePartBytes) {
      const path = `${name}.part-${String(paths.length).padStart(3, "0")}`
      writeFileSync(join(directory, path), bytes.subarray(start, start + sourcePartBytes))
      paths.push(path)
    }
    rmSync(join(directory, name), { force: true })
  }
  return { file: name, bytes: bytes.byteLength, sha256: distributionHash(bytes), paths }
}

function prepareSources(site: string, sourcePackage: string, manifest: DistributionManifest) {
  const directory = join(site, "sources")
  for (const name of requiredNotices) {
    if (!existsSync(join(directory, name)) || !readFileSync(join(directory, name), "utf8").trim())
      throw new Error(`The public build is missing third-party notices: ${name}`)
  }
  const applicationSource = manifest.files.find(
    ({ path }) => path === "sources/vibeshape-source.tar",
  )
  if (!applicationSource) throw new Error("The verified application source archive is missing.")
  cpSync(
    join(sourcePackage, "sources/vibeshape-source.tar"),
    join(directory, "vibeshape-source.tar"),
  )
  if (
    distributionHash(readFileSync(join(directory, "vibeshape-source.tar"))) !==
    applicationSource.sha256
  )
    throw new Error("The verified application source changed while staging.")
  const archives = sourceArchives.map((name) =>
    writeSourceArchive(directory, name, readFileSync(join(directory, name))),
  )
  const instructions = archives.flatMap(({ file, paths, sha256 }) => [
    `# Download all ${paths.length} file(s) for ${file} into one directory.`,
    ...(paths.length > 1 ? [`cat ${paths.join(" ")} > ${file}`] : []),
    `# Expected SHA-256: ${sha256}`,
    `shasum -a 256 ${file}`,
    "",
  ])
  writeFileSync(join(directory, "RECONSTRUCT.txt"), `${instructions.join("\n")}\n`)
  const links = archives.flatMap(({ paths }) =>
    paths.map((name) => `<li><a href="${name}">${name}</a></li>`),
  )
  writeFileSync(
    join(directory, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>VibeShape sources</title>
<h1>Corresponding source and licenses</h1><p>Large archives are split into ordered parts to fit the static host. Download every part and follow <a href="RECONSTRUCT.txt">reconstruction and SHA-256 instructions</a>. No source bytes are omitted.</p>
<ul>${links.join("")}<li><a href="LICENSE.txt">VibeShape license</a></li><li><a href="browser-licenses.txt">Browser dependency licenses</a></li><li><a href="worker-licenses.txt">Worker dependency licenses</a></li><li><a href="shadcn-LICENSE.txt">Copied UI component license</a></li><li><a href="OCCT-NOTICES.txt">OCCT and binding notices</a></li><li><a href="OCCT-REPLACEMENT.txt">Kernel replacement instructions</a></li></ul></html>\n`,
  )
  return archives
}

function copyVerifiedWeb(source: string, site: string, manifest: DistributionManifest) {
  const prefix = "apps/web/dist/"
  for (const file of manifest.files.filter(({ path }) => path.startsWith(prefix))) {
    const target = join(site, file.path.slice(prefix.length))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(source, file.path), target)
    if (distributionHash(readFileSync(target)) !== file.sha256)
      throw new Error("The verified static package changed while staging.")
    chmodSync(target, 0o644)
  }
  if (existsSync(join(site, "manifest.json")) || existsSync(join(site, "site-manifest.json")))
    throw new Error("The static input contains a reserved staging manifest.")
}

function remoteEditorHeaders(headers: string, remoteMcpUrl: string | undefined) {
  if (!remoteMcpUrl) return headers
  const configured = z
    .url()
    .regex(
      /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/mcp$/,
      "The remote MCP endpoint must be an HTTPS /mcp URL on a DNS hostname.",
    )
    .parse(remoteMcpUrl)
  const endpoint = new URL(configured)
  const sections = headers.split("\n\n")
  return sections
    .map((section) => {
      if (!["/", "/index", "/index.html"].includes(section.split("\n")[0] ?? "")) return section
      return section
        .replace(
          "script-src 'self' 'wasm-unsafe-eval'",
          "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
        )
        .replace(
          "connect-src 'self'",
          `connect-src 'self' ${endpoint.origin} wss://${endpoint.host}; frame-src 'self' https://challenges.cloudflare.com`,
        )
    })
    .join("\n\n")
}

export function prepareCloudflareSite(
  sourcePackage: string,
  output: string,
  remoteMcpUrl?: string,
) {
  const source = assertDistributionPath(sourcePackage)
  const manifest = verifyDistribution(source)
  const site = assertDistributionPath(output)
  if (site.startsWith(`${source}/`)) throw new Error("Stage outside the source package.")
  if (existsSync(site)) throw new Error("The Cloudflare staging directory must be new.")
  mkdirSync(dirname(site), { recursive: true })
  mkdirSync(site)
  try {
    copyVerifiedWeb(source, site, manifest)
    const archives = prepareSources(site, source, manifest)
    const config = resolve(import.meta.dirname, "../deployment/cloudflare")
    cpSync(join(config, "404.html"), join(site, "404.html"))
    writeFileSync(
      join(site, "_headers"),
      remoteEditorHeaders(readFileSync(join(config, "_headers"), "utf8"), remoteMcpUrl),
    )
    const files = distributionInventory(site)
    if (files.length >= 20_000 || files.some(({ bytes }) => bytes > maximumAssetBytes))
      throw new Error("The Cloudflare site exceeds the static asset limits.")
    if (readFileSync(join(site, "index.html"), "utf8").includes("vibeshape-local-automation"))
      throw new Error("The static site must not advertise the local MCP transport.")
    const report = {
      schemaVersion: 1,
      sourceCommit: manifest.sourceCommit,
      releaseId: manifest.releaseId,
      ...(remoteMcpUrl ? { remoteMcpUrl } : {}),
      archives,
      files,
    }
    writeFileSync(join(site, "site-manifest.json"), `${JSON.stringify(report, null, 2)}\n`)
    return report
  } catch (error) {
    rmSync(site, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const [source, output] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(process.argv.slice(2))
  const report = prepareCloudflareSite(
    resolve(source),
    resolve(output),
    process.env.VITE_REMOTE_MCP_URL,
  )
  console.log(
    `Prepared static Cloudflare site for ${report.sourceCommit}; no deployment was performed.`,
  )
}
