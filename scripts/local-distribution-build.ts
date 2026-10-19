import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import {
  assertDistributionPath,
  createDistributionManifest,
  DISTRIBUTION_BUN_VERSION,
  verifyDistribution,
} from "./local-distribution-files"

import { verifyControlledEditorBuild } from "./local-editor-build"

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

function requireUnchangedDist(original: string, copied: string, expected: string) {
  if (
    verifyControlledEditorBuild(original) !== expected ||
    verifyControlledEditorBuild(copied) !== expected
  )
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
  const before = verifyControlledEditorBuild(dist)
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
