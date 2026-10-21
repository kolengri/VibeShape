import { spawnSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { packager } from "@electron/packager"
import { valid } from "semver"
import { z } from "zod"
import { distributionHash } from "../../scripts/local-distribution-files"
import { verifyControlledEditorBuild } from "../../scripts/local-editor-build"
import { createDmgImage } from "./dmg-presentation"
import manifest from "./package.json"
import { withPackageOutput } from "./package-output"
import { packageTarget } from "./package-target"
import { verifyRuntimeFiles } from "./runtime-consistency"
import { createWindowsArchive } from "./windows-archive"

const root = resolve(import.meta.dirname, "../..")
const dist = join(root, "apps/web/dist")
const buildReceiptNames = { darwin: "desktop-build.json", win32: "desktop-build-win-x64.json" }
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function requirePackagingEnvironment() {
  if (!valid(manifest.version)) throw new Error("Desktop version must be valid SemVer.")
  if (run("git", ["status", "--porcelain"]))
    throw new Error("Commit source changes before packaging an exact-source desktop build.")
}

function packageInput() {
  const { destination, arch, bundle, platform } = packageTarget(process.argv.slice(2))
  requirePackagingEnvironment()
  const commit = run("git", ["rev-parse", "HEAD"])
  // Rebuild from this clean source instead of trusting a dist prepared before a later UI commit.
  run(process.execPath, ["run", "prepare:local", ...(bundle ? [resolve(bundle)] : [])])
  return {
    output: resolve(destination),
    arch,
    platform,
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
  await cp(join(root, "docs/desktop-windows.md"), join(sources, "desktop-windows.md"))
  const dependencyRoot = join(root, "apps/desktop/node_modules")
  run(process.execPath, [join(dependencyRoot, "electron/install.js")])
  for (const name of ["LICENSE", "LICENSES.chromium.html"])
    await cp(
      join(dependencyRoot, "electron/dist", name),
      join(sources, `Electron-${name === "LICENSE" ? "LICENSE.txt" : name}`),
    )
  for (const name of ["desktop-licenses.txt", "metafile.json"])
    await cp(join(root, "apps/desktop/dist", name), join(sources, name))
  await writeFile(
    join(sources, "index.html"),
    `${await readFile(join(sources, "index.html"), "utf8")}\n<h2>Desktop host</h2><ul>
<li><a href="desktop-licenses.txt">Native main-process dependency notices</a></li>
<li><a href="Electron-LICENSE.txt">Electron license</a></li>
<li><a href="Electron-LICENSES.chromium.html">Chromium and bundled runtime notices</a></li>
<li><a href="vibeshape-source.tar">Exact VibeShape application source</a></li>
<li><a href="desktop-macos.md">macOS build and replacement instructions</a></li>
<li><a href="desktop-windows.md">Windows build and replacement instructions</a></li></ul>\n`,
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
  const runtime: Record<string, string> = {}
  for (const name of ["main.cjs", "preload.cjs", "mcp.cjs", "jev.cjs"]) {
    const bytes = await readFile(join(root, "apps/desktop/dist", name))
    await writeFile(join(app, name), bytes)
    runtime[name] = distributionHash(bytes)
  }
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
  return { app, editor, runtime, editorHash: verifyControlledEditorBuild(editor) }
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
        join(root, "apps/web/public/brand/app-icon.png"),
        "--out",
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      ])
    }
  }
  const icon = join(stage, "VibeShape.icns")
  run("iconutil", ["-c", "icns", iconset, "-o", icon])
  return icon
}

async function platformOptions(stage: string, platform: "darwin" | "win32") {
  if (platform === "win32")
    return {
      icon: join(root, "apps/desktop/packaging/app-icon.ico"),
      win32metadata: { CompanyName: "VibeShape contributors" },
    }
  return {
    icon: await createIcon(stage),
    appBundleId: "org.vibeshape.desktop",
    appCategoryType: "public.app-category.graphics-design",
    osxSign: {
      identity: "-",
      identityValidation: false,
      continueOnError: false,
      // Ad-hoc binaries have no Team ID for Hardened Runtime's library validation.
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
    extendInfo: { NSHumanReadableCopyright: "VibeShape — GPL-3.0-or-later" },
  }
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
    appVersion: manifest.version,
    electronVersion: manifest.devDependencies.electron,
    arch: input.arch,
    platform: input.platform,
    asar: false,
    prune: false,
    extraResource: [files.editor],
    ...(await platformOptions(stage, input.platform)),
  })
  const [packaged] = z.tuple([z.string().min(1)]).parse(paths)
  if (input.platform === "win32") {
    await verifyRuntimeFiles(join(packaged, "resources/app"), files.runtime)
    // Ship the target runtime's notices even when packaging Windows on a Mac.
    for (const name of ["LICENSE", "LICENSES.chromium.html"])
      await cp(
        join(packaged, name),
        join(
          packaged,
          "resources/editor/sources",
          `Electron-${name === "LICENSE" ? "LICENSE.txt" : name}`,
        ),
      )
    return packaged
  }
  const appPath = join(packaged, "VibeShape.app")
  await verifyRuntimeFiles(join(appPath, "Contents/Resources/app"), files.runtime)
  run("codesign", ["--verify", "--deep", "--strict", appPath])
  return appPath
}

async function createDistribution(
  stage: string,
  input: ReturnType<typeof packageInput>,
  files: Awaited<ReturnType<typeof stageApplication>>,
) {
  const appPath = await createApp(stage, input, files)
  if (input.platform === "darwin") {
    const image = await createDmgImage({
      stage,
      output: input.output,
      appPath,
      version: manifest.version,
      arch: input.arch,
      brandIcon: join(root, "apps/web/public/brand/app-icon.png"),
    })
    return {
      artifact: image.dmg,
      editorHash: files.editorHash,
      dmgSha256: image.digest,
      signing: "ad-hoc",
    }
  }
  const image = await createWindowsArchive({
    directory: appPath,
    output: input.output,
    version: manifest.version,
  })
  return {
    artifact: image.zip,
    editorHash: verifyControlledEditorBuild(join(appPath, "resources/editor")),
    zipSha256: image.digest,
    signing: "unsigned",
  }
}

const input = packageInput()
await withPackageOutput(input.output, async (stage) => {
  const files = await stageApplication(stage, input)
  const { artifact, ...receipt } = await createDistribution(stage, input, files)
  if (
    verifyControlledEditorBuild(dist) !== input.editorHash ||
    run("git", ["status", "--porcelain"]) ||
    run("git", ["rev-parse", "HEAD"]) !== input.commit
  )
    throw new Error("Source or editor changed during packaging; refuse the generated artifacts.")
  await verifyRuntimeFiles(join(root, "apps/desktop/dist"), files.runtime)
  await writeFile(
    join(input.output, buildReceiptNames[input.platform]),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        version: manifest.version,
        arch: input.arch,
        platform: input.platform,
        sourceCommit: input.commit,
        mainSha256: files.runtime["main.cjs"],
        runtimeSha256: files.runtime,
        ...receipt,
        notarized: false,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`Prepared ${artifact}\nSigning: ${receipt.signing}; not notarized.`)
})
