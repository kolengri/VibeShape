import { spawnSync } from "node:child_process"
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
  createDistributionManifest,
  DISTRIBUTION_BUN_VERSION,
  distributionHash,
  distributionInventory,
  verifyDistribution,
} from "./local-distribution-files"

const root = resolve(import.meta.dirname, "..")

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function requireCommittedExecutableSource() {
  const changed = [
    ...git(["diff", "--name-only", "-z", "HEAD"]).split("\0"),
    ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ].filter(
    (path) =>
      /^(?:apps|packages|native|third_party|scripts)\//.test(path) ||
      [
        "LICENSE",
        "bun.lock",
        "package.json",
        "docs/local-distribution.md",
        "docs/mcp-quickstart.md",
        "docs/deployment.md",
        "docs/licensing.md",
      ].includes(path) ||
      /^(?:tsconfig.*\.json|[^/]*config\.[cm]?[jt]s)$/.test(path),
  )
  if (changed.length)
    throw new Error(`Commit executable/package changes before packaging: ${changed.join(", ")}`)
  return git(["rev-parse", "HEAD"])
}

function verifyControlledDist(directory: string) {
  const report = z
    .object({
      schemaVersion: z.literal(1),
      kernelRevision: z.literal("bb368e271e24f63078129283148ce83db6b9670a"),
      sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      artifacts: z
        .array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
        .length(2),
      sourceArchives: z
        .array(z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
        .length(2),
    })
    .strict()
    .parse(JSON.parse(readFileSync(join(directory, "local-build.json"), "utf8")))
  const files = distributionInventory(directory)
  verifyRecordedHashes(files, [...report.artifacts, ...report.sourceArchives])
  requireControlledSources(files)
  return distributionHash(JSON.stringify(files))
}

function verifyRecordedHashes(
  files: ReturnType<typeof distributionInventory>,
  expected: { file: string; sha256: string }[],
) {
  for (const entry of expected) {
    if (!files.some(({ path, sha256 }) => path === entry.file && sha256 === entry.sha256))
      throw new Error(`Controlled build hash mismatch: ${entry.file}`)
  }
}

function requireControlledSources(files: ReturnType<typeof distributionInventory>) {
  for (const required of [
    "sources/occt-corresponding-source.tar",
    "sources/solvespace-corresponding-source.tar.gz",
    "sources/LICENSE.txt",
    "sources/OCCT-NOTICES.txt",
    "sources/Noto-Sans-OFL.txt",
    "sources/Noto-Sans-provenance.md",
    "sources/opentype-js-MIT.txt",
    "sources/OCCT-REPLACEMENT.txt",
    "sources/index.html",
  ]) {
    if (!files.some(({ path }) => path === required))
      throw new Error(`Controlled build lacks ${required}.`)
  }
}

function requireUnchangedDist(original: string, copied: string, expected: string) {
  if (verifyControlledDist(original) !== expected || verifyControlledDist(copied) !== expected)
    throw new Error("The editor dist changed while packaging; refuse mixed artifacts.")
}

async function bundle(entrypoint: string, target: string) {
  const result = await Bun.build({
    entrypoints: [join(root, entrypoint)],
    target: "bun",
    format: "esm",
    packages: "bundle",
    minify: false,
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error(`Could not bundle ${entrypoint}: ${result.logs.join("\n")}`)
  const output = result.outputs[0]
  if (!output) throw new Error(`No bundled output for ${entrypoint}.`)
  await Bun.write(target, output)
}

function writeLaunchers(output: string) {
  writeFileSync(
    join(output, "vibeshape"),
    '#!/bin/sh\nset -eu\nvibeshape_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec bun "$vibeshape_dir/launcher.js" "$@"\n',
  )
  chmodSync(join(output, "vibeshape"), 0o755)
  const commandPreamble =
    '#!/bin/sh\nset -eu\nvibeshape_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'
  writeFileSync(
    join(output, "Start editor.command"),
    `${commandPreamble}exec "$vibeshape_dir/vibeshape" editor\n`,
  )
  writeFileSync(
    join(output, "Install.command"),
    `${commandPreamble}vibeshape_install_dir=\${VIBESHAPE_INSTALL_DIRECTORY:-"$HOME/Applications/VibeShape"}\nexec "$vibeshape_dir/vibeshape" install "$vibeshape_install_dir"\n`,
  )
  chmodSync(join(output, "Start editor.command"), 0o755)
  chmodSync(join(output, "Install.command"), 0o755)
}

function copyCorrespondingSource(output: string, commit: string) {
  writeFileSync(join(output, "LICENSE"), `${git(["show", `${commit}:LICENSE`])}\n`)
  mkdirSync(join(output, "docs"))
  for (const name of [
    "local-distribution.md",
    "mcp-quickstart.md",
    "deployment.md",
    "licensing.md",
  ])
    writeFileSync(join(output, "docs", name), `${git(["show", `${commit}:docs/${name}`])}\n`)
  mkdirSync(join(output, "sources"))
  git([
    "archive",
    "--format=tar",
    `--output=${join(output, "sources/vibeshape-source.tar")}`,
    commit,
  ])
}

function packageOutput(dist: string) {
  const [argument] = z.tuple([z.string().min(1)]).parse(process.argv.slice(2))
  const output = assertDistributionPath(argument)
  if (existsSync(output)) throw new Error("The output directory must not already exist.")
  if (output === dist || output.startsWith(`${dist}/`))
    throw new Error("The package output must be outside the active editor dist.")
  return output
}

async function populatePackage(output: string, commit: string, dist: string, before: string) {
  cpSync(dist, join(output, "apps/web/dist"), { recursive: true, dereference: false })
  mkdirSync(join(output, "apps/mcp-server/src"), { recursive: true })
  await bundle("apps/mcp-server/src/index.ts", join(output, "apps/mcp-server/src/index.js"))
  await bundle("scripts/local-distribution.ts", join(output, "launcher.js"))
  writeLaunchers(output)
  copyCorrespondingSource(output, commit)
  requireUnchangedDist(dist, join(output, "apps/web/dist"), before)
  const manifest = createDistributionManifest(output, commit)
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  verifyDistribution(output)
  console.log(
    `Prepared ${manifest.releaseId} at ${output}. No runtime was copied; use installed Bun ${DISTRIBUTION_BUN_VERSION}.`,
  )
}

async function build() {
  if (Bun.version !== DISTRIBUTION_BUN_VERSION)
    throw new Error(`Packaging requires Bun ${DISTRIBUTION_BUN_VERSION}.`)
  const dist = join(root, "apps/web/dist")
  const output = packageOutput(dist)
  const commit = requireCommittedExecutableSource()
  const before = verifyControlledDist(dist)
  mkdirSync(dirname(output), { recursive: true })
  // Only the process that exclusively created this directory may populate or remove it.
  mkdirSync(output)
  try {
    await populatePackage(output, commit, dist, before)
  } catch (error) {
    rmSync(output, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  try {
    await build()
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local packaging failed.")
    process.exitCode = 1
  }
}
