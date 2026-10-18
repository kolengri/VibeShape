import { spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { packager } from "@electron/packager"
import { valid } from "semver"
import { z } from "zod"
import { distributionHash } from "../../scripts/local-distribution-files"
import { verifyControlledEditorBuild } from "../../scripts/local-editor-build"
import manifest from "./package.json"

const root = resolve(import.meta.dirname, "../..")
const dist = join(root, "apps/web/dist")
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function requirePackagingEnvironment() {
  if (process.platform !== "darwin")
    throw new Error("Mac packaging requires macOS and Xcode tools.")
  if (!valid(manifest.version)) throw new Error("Desktop version must be valid SemVer.")
  if (run("git", ["status", "--porcelain"]))
    throw new Error("Commit source changes before packaging an exact-source desktop build.")
}

function packageInput() {
  const architecture = z.enum(["arm64", "x64"])
  const [destination, requestedArch, bundle] = z
    .tuple([z.string().min(1), architecture.optional(), z.string().min(1).optional()])
    .parse(process.argv.slice(2))
  requirePackagingEnvironment()
  const commit = run("git", ["rev-parse", "HEAD"])
  // Rebuild from this clean source instead of trusting a dist prepared before a later UI commit.
  run(process.execPath, ["run", "prepare:local", ...(bundle ? [resolve(bundle)] : [])])
  return {
    output: resolve(destination),
    arch: requestedArch ?? architecture.parse(process.arch),
    commit,
    editorHash: verifyControlledEditorBuild(dist),
  }
}

async function stageSources(editor: string, commit: string) {
  const sources = join(editor, "sources")
  run("git", [
    "archive",
    "--format=tar",
    `--output=${join(sources, "vibeshape-source.tar")}`,
    commit,
  ])
  await cp(join(root, "docs/desktop-macos.md"), join(sources, "desktop-macos.md"))
  const dependencyRoot = join(root, "apps/desktop/node_modules")
  run(process.execPath, [join(dependencyRoot, "electron/install.js")])
  for (const name of ["LICENSE", "LICENSES.chromium.html"])
    await cp(join(dependencyRoot, "electron/dist", name), join(sources, `Electron-${name}`))
  for (const name of ["desktop-licenses.txt", "metafile.json"])
    await cp(join(root, "apps/desktop/dist", name), join(sources, name))
  await writeFile(
    join(sources, "index.html"),
    `${await readFile(join(sources, "index.html"), "utf8")}\n<h2>Desktop host</h2><ul>
<li><a href="desktop-licenses.txt">Native main-process dependency notices</a></li>
<li><a href="Electron-LICENSE">Electron license</a></li>
<li><a href="Electron-LICENSES.chromium.html">Chromium and bundled runtime notices</a></li>
<li><a href="vibeshape-source.tar">Exact VibeShape application source</a></li>
<li><a href="desktop-macos.md">Desktop build and replacement instructions</a></li></ul>\n`,
  )
}

async function stageApplication(stage: string, input: ReturnType<typeof packageInput>) {
  run(process.execPath, ["run", "desktop:build"])
  const app = join(stage, "app")
  const editor = join(stage, "editor")
  await mkdir(app)
  await cp(dist, editor, { recursive: true })
  if (verifyControlledEditorBuild(editor) !== input.editorHash)
    throw new Error("The editor changed while staging the desktop package.")
  const main = await readFile(join(root, "apps/desktop/dist/main.cjs"))
  await writeFile(join(app, "main.cjs"), main)
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "vibeshape",
      version: manifest.version,
      main: "main.cjs",
      license: manifest.license,
    }),
  )
  await stageSources(editor, input.commit)
  return { app, editor, main, editorHash: verifyControlledEditorBuild(editor) }
}

async function createIcon(stage: string) {
  const iconset = join(stage, "VibeShape.iconset")
  await mkdir(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale)
      run("sips", [
        "-z",
        pixels,
        pixels,
        join(root, "apps/web/public/brand/logo-mark.png"),
        "--out",
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      ])
    }
  }
  const icon = join(stage, "VibeShape.icns")
  run("iconutil", ["-c", "icns", iconset, "-o", icon])
  return icon
}

async function createApp(
  stage: string,
  input: ReturnType<typeof packageInput>,
  files: Awaited<ReturnType<typeof stageApplication>>,
) {
  const paths = await packager({
    dir: files.app,
    out: input.output,
    name: "VibeShape",
    appBundleId: "org.vibeshape.desktop",
    appCategoryType: "public.app-category.graphics-design",
    appVersion: manifest.version,
    electronVersion: manifest.devDependencies.electron,
    arch: input.arch,
    platform: "darwin",
    asar: false,
    prune: false,
    icon: await createIcon(stage),
    extraResource: [files.editor],
    osxSign: {
      identity: "-",
      identityValidation: false,
      continueOnError: false,
      // Ad-hoc binaries have no Team ID for Hardened Runtime's library validation.
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
    extendInfo: { NSHumanReadableCopyright: "VibeShape — GPL-3.0-or-later" },
  })
  const packaged = paths[0]
  if (!packaged || paths.length !== 1) throw new Error("Expected exactly one Mac application.")
  const appPath = join(packaged, "VibeShape.app")
  run("codesign", ["--verify", "--deep", "--strict", appPath])
  return appPath
}

async function createImage(stage: string, input: ReturnType<typeof packageInput>, appPath: string) {
  const image = join(stage, "image")
  await mkdir(image)
  await cp(appPath, join(image, "VibeShape.app"), { recursive: true, verbatimSymlinks: true })
  await symlink("/Applications", join(image, "Applications"))
  const fileName = `VibeShape-${manifest.version}-mac-${input.arch}.dmg`
  const dmg = join(input.output, fileName)
  run("hdiutil", ["create", "-volname", "VibeShape", "-srcfolder", image, "-format", "UDZO", dmg])
  const digest = distributionHash(await readFile(dmg))
  await writeFile(join(input.output, "SHA256SUMS"), `${digest}  ${fileName}\n`)
  return { dmg, digest }
}

const input = packageInput()
// Only the process that exclusively creates the output owns staging cleanup.
await mkdir(input.output)
const stage = await mkdtemp(join(input.output, ".stage-"))
try {
  const files = await stageApplication(stage, input)
  const appPath = await createApp(stage, input, files)
  const image = await createImage(stage, input, appPath)
  if (
    verifyControlledEditorBuild(dist) !== input.editorHash ||
    run("git", ["status", "--porcelain"]) ||
    run("git", ["rev-parse", "HEAD"]) !== input.commit
  )
    throw new Error("Source or editor changed during packaging; refuse the generated artifacts.")
  await writeFile(
    join(input.output, "desktop-build.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version: manifest.version,
        arch: input.arch,
        sourceCommit: input.commit,
        editorHash: files.editorHash,
        mainSha256: distributionHash(files.main),
        dmgSha256: image.digest,
        signing: "ad-hoc",
        notarized: false,
      },
      null,
      2,
    )}\n`,
  )
  console.log(
    `Prepared ${appPath}\nDisk image: ${image.dmg}\nAd-hoc signed local build; not notarized.`,
  )
} finally {
  await rm(stage, { recursive: true, force: true })
}
