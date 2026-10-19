import { spawnSync } from "node:child_process"
import { cp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { distributionHash } from "../../scripts/local-distribution-files"
import { desktopMessage as t } from "./src/messages"

type DmgInput = Readonly<{
  stage: string
  output: string
  appPath: string
  brandIcon: string
  version: string
  arch: "arm64" | "x64"
}>
type DmgTool = (command: string, args: string[]) => string

function runDmgTool(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 1_048_576,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function detachImage(mountPoint: string, run: DmgTool) {
  try {
    run("hdiutil", ["detach", mountPoint])
  } catch (normalFailure) {
    try {
      run("hdiutil", ["detach", "-force", mountPoint])
    } catch (forcedFailure) {
      throw new AggregateError(
        [normalFailure, forcedFailure],
        "The installer image could not be detached.",
      )
    }
  }
}

async function configureImage(image: string, mountPoint: string, run: DmgTool) {
  const script = join(import.meta.dirname, "packaging/dmg-window.applescript")
  const failures: unknown[] = []
  let attached = false
  try {
    run("hdiutil", ["attach", image, "-nobrowse", "-noautoopen", "-mountpoint", mountPoint])
    attached = true
    run("osascript", [script, "configure", mountPoint])
    if ((await stat(join(mountPoint, ".DS_Store"))).size === 0)
      throw new Error("Finder did not save the installer layout.")
  } catch (error) {
    failures.push(error)
  } finally {
    if (attached) {
      try {
        run("osascript", [script, "close", mountPoint])
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      detachImage(mountPoint, run)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "The installer layout could not be prepared.")
}

export async function createDmgImage(input: DmgInput, run: DmgTool = runDmgTool) {
  const image = join(input.stage, "image")
  const background = join(image, ".background")
  const mountPoint = join(input.stage, "installer-mount")
  await mkdir(background, { recursive: true })
  await mkdir(mountPoint)
  await cp(input.appPath, join(image, "VibeShape.app"), { recursive: true, verbatimSymlinks: true })
  await symlink("/Applications", join(image, "Applications"))
  run("swift", [
    join(import.meta.dirname, "packaging/dmg-background.swift"),
    join(background, "installer.png"),
    input.brandIcon,
    t("installerTitle"),
    t("installerInstruction"),
    t("installerNextStep"),
  ])
  const writableImage = join(input.stage, "installer-layout.dmg")
  run("hdiutil", [
    "create",
    "-volname",
    "VibeShape",
    "-fs",
    "HFS+",
    "-srcfolder",
    image,
    "-format",
    "UDRW",
    writableImage,
  ])
  await configureImage(writableImage, mountPoint, run)
  const fileName = `VibeShape-${input.version}-mac-${input.arch}.dmg`
  const dmg = join(input.output, fileName)
  run("hdiutil", ["convert", writableImage, "-format", "UDZO", "-o", dmg])
  run("hdiutil", ["verify", dmg])
  const digest = distributionHash(await readFile(dmg))
  await writeFile(join(input.output, "SHA256SUMS"), `${digest}  ${fileName}\n`)
  return { dmg, digest }
}
