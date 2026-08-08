import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { assertLocalSolveSpaceBuild, SOLVESPACE_BUILD_INPUTS } from "./solvespace-build-config"

const repositoryRoot = resolve(import.meta.dir, "..")
const artifactRoot = join(repositoryRoot, ".artifacts", "solvespace-build")
const sourceRoot = join(artifactRoot, "sources")
const bundleRoot = join(artifactRoot, "compliance-bundle")
const bundleArchive = join(artifactRoot, "solvespace-corresponding-source.tar.gz")

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function requireFile(path: string) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Required SolveSpace compliance input is missing: ${path}`)
  }
}

function copyRequired(source: string, destination: string) {
  requireFile(source)
  mkdirSync(resolve(destination, ".."), { recursive: true })
  copyFileSync(source, destination)
}

function extractText(archivePath: string, entry: string, destination: string) {
  const result = spawnSync("tar", ["-xOf", archivePath, entry], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error || result.status !== 0 || result.stdout.length === 0) {
    throw new Error(`Failed to extract ${entry} from ${archivePath}.`)
  }
  mkdirSync(resolve(destination, ".."), { recursive: true })
  writeFileSync(destination, result.stdout)
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

function createArchive() {
  rmSync(bundleArchive, { force: true })
  const result = spawnSync("tar", ["-czf", bundleArchive, "-C", bundleRoot, "."], {
    encoding: "utf8",
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to create SolveSpace compliance archive: ${result.stderr.trim()}`)
  }
}

async function main() {
  assertLocalSolveSpaceBuild()
  rmSync(bundleRoot, { force: true, recursive: true })
  mkdirSync(bundleRoot, { recursive: true })

  const archives = {
    eigen: join(sourceRoot, basename(new URL(SOLVESPACE_BUILD_INPUTS.sources.eigen.url).pathname)),
    mimalloc: join(
      sourceRoot,
      basename(new URL(SOLVESPACE_BUILD_INPUTS.sources.mimalloc.url).pathname),
    ),
    solvespace: join(
      sourceRoot,
      basename(new URL(SOLVESPACE_BUILD_INPUTS.sources.solvespace.url).pathname),
    ),
  }
  for (const [name, path] of Object.entries(archives)) {
    copyRequired(path, join(bundleRoot, "sources", `${name}.tar.gz`))
  }

  copyRequired(
    join(repositoryRoot, "native", "solvespace", "build.sh"),
    join(bundleRoot, "build", "build.sh"),
  )
  copyRequired(
    join(repositoryRoot, "native", "solvespace", "solvespace-v3.2-vibeshape.patch"),
    join(bundleRoot, "patches", "solvespace-v3.2-vibeshape.patch"),
  )
  copyRequired(
    join(repositoryRoot, "native", "solvespace", "vibeshape_solver_abi.cpp"),
    join(bundleRoot, "native", "vibeshape_solver_abi.cpp"),
  )
  copyRequired(
    join(artifactRoot, "build-report.json"),
    join(bundleRoot, "evidence", "build-report.json"),
  )
  copyRequired(
    join(artifactRoot, "evidence-report.json"),
    join(bundleRoot, "evidence", "evidence-report.json"),
  )
  copyRequired(
    join(artifactRoot, "browser-evidence-report.json"),
    join(bundleRoot, "evidence", "browser-evidence-report.json"),
  )

  const solveSpacePrefix = `solvespace-${SOLVESPACE_BUILD_INPUTS.sources.solvespace.revision}`
  extractText(
    archives.solvespace,
    `${solveSpacePrefix}/COPYING.txt`,
    join(bundleRoot, "licenses", "SolveSpace-COPYING.txt"),
  )
  extractText(
    archives.solvespace,
    `${solveSpacePrefix}/THIRD_PARTIES.txt`,
    join(bundleRoot, "licenses", "SolveSpace-THIRD_PARTIES.txt"),
  )
  const eigenPrefix = `eigen-${SOLVESPACE_BUILD_INPUTS.sources.eigen.revision}`
  for (const file of [
    "COPYING.APACHE",
    "COPYING.BSD",
    "COPYING.GPL",
    "COPYING.LGPL",
    "COPYING.MINPACK",
    "COPYING.MPL2",
    "COPYING.README",
  ]) {
    extractText(
      archives.eigen,
      `${eigenPrefix}/${file}`,
      join(bundleRoot, "licenses", `Eigen-${file}`),
    )
  }
  const mimallocPrefix = `mimalloc-${SOLVESPACE_BUILD_INPUTS.sources.mimalloc.revision}`
  extractText(
    archives.mimalloc,
    `${mimallocPrefix}/LICENSE`,
    join(bundleRoot, "licenses", "mimalloc-LICENSE"),
  )

  writeFileSync(
    join(bundleRoot, "README.md"),
    `# VibeShape SolveSpace corresponding source\n\nThis bundle records the exact SolveSpace v3.2, Eigen, and mimalloc source archives, project patch, typed-array ABI wrapper, local build recipe, licenses, and evidence used by VibeShape.\n\nThe build is intentionally local-only. Mount this directory at \`/input:ro\`, an empty output directory at \`/output\`, and run \`bash /input/build/build.sh\` in \`${SOLVESPACE_BUILD_INPUTS.builderImage}\` on \`${SOLVESPACE_BUILD_INPUTS.platform}\`. The source archives must be available under \`/input/sources\` with the filenames used in this bundle.\n`,
  )

  const payloadFiles = listFiles(bundleRoot).sort()
  const inventory = payloadFiles.map((path) => ({
    bytes: statSync(path).size,
    path: relative(bundleRoot, path),
    sha256: sha256(path),
  }))
  writeFileSync(
    join(bundleRoot, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, buildInputs: SOLVESPACE_BUILD_INPUTS, files: inventory }, null, 2)}\n`,
  )
  writeFileSync(
    join(bundleRoot, "SHA256SUMS"),
    `${inventory.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  )
  createArchive()

  console.log(
    `Created ${bundleArchive} (${statSync(bundleArchive).size} bytes, sha256 ${sha256(bundleArchive)}).`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown compliance bundle failure.")
  process.exitCode = 1
})
