import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join, win32 } from "node:path"
import type { SlicerId } from "@vibeshape/slicer-handoff/protocol"

type SpawnedProcess = Readonly<{ unref?: () => void }>
type SpawnProcess = (command: readonly string[]) => SpawnedProcess

const slicerNames: Record<SlicerId, string> = {
  "orca-slicer": "OrcaSlicer",
  "bambu-studio": "Bambu Studio",
  "prusa-slicer": "PrusaSlicer",
  "snapmaker-orca": "Snapmaker Orca",
  "ultimaker-cura": "UltiMaker Cura",
}

const executableEnvironmentKeys: Record<SlicerId, string> = {
  "orca-slicer": "VIBESHAPE_SLICER_ORCA_SLICER",
  "bambu-studio": "VIBESHAPE_SLICER_BAMBU_STUDIO",
  "prusa-slicer": "VIBESHAPE_SLICER_PRUSA_SLICER",
  "snapmaker-orca": "VIBESHAPE_SLICER_SNAPMAKER_ORCA",
  "ultimaker-cura": "VIBESHAPE_SLICER_ULTIMAKER_CURA",
}

const executableNames: Record<SlicerId, readonly string[]> = {
  "orca-slicer": ["orca-slicer", "OrcaSlicer"],
  "bambu-studio": ["bambu-studio", "BambuStudio"],
  "prusa-slicer": ["prusa-slicer", "PrusaSlicer"],
  "snapmaker-orca": ["snapmaker-orca", "SnapmakerOrca"],
  "ultimaker-cura": ["ultimaker-cura", "UltiMaker-Cura", "cura"],
}

function macApplicationPaths(slicerId: SlicerId, home: string) {
  const [bundleName, executableName] = (
    {
      "orca-slicer": ["OrcaSlicer.app", "OrcaSlicer"],
      "bambu-studio": ["BambuStudio.app", "BambuStudio"],
      "prusa-slicer": ["PrusaSlicer.app", "PrusaSlicer"],
      "snapmaker-orca": ["Snapmaker Orca.app", "Snapmaker Orca"],
      "ultimaker-cura": ["UltiMaker Cura.app", "UltiMaker-Cura"],
    } satisfies Record<SlicerId, readonly [string, string]>
  )[slicerId]
  const relativePath = join(bundleName, "Contents", "MacOS", executableName)
  return [join("/Applications", relativePath), join(home, "Applications", relativePath)]
}

function windowsApplicationPaths(slicerId: SlicerId, environment: NodeJS.ProcessEnv) {
  const relativePaths: Record<SlicerId, readonly string[]> = {
    "orca-slicer": ["OrcaSlicer\\orca-slicer.exe"],
    "bambu-studio": ["Bambu Studio\\bambu-studio.exe"],
    "prusa-slicer": ["Prusa3D\\PrusaSlicer\\prusa-slicer.exe"],
    "snapmaker-orca": ["Snapmaker Orca\\snapmaker-orca.exe"],
    "ultimaker-cura": ["UltiMaker Cura\\UltiMaker-Cura.exe"],
  }
  const roots = [environment.ProgramFiles, environment.LOCALAPPDATA]
  return roots.flatMap((root) =>
    root ? relativePaths[slicerId].map((relativePath) => win32.join(root, relativePath)) : [],
  )
}

function pathExtensions(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv) {
  if (platform !== "win32") return [""]
  return (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
}

function pathDirectories(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv) {
  return (environment.PATH ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean)
}

function pathCandidates(
  slicerId: SlicerId,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
) {
  const extensions = pathExtensions(platform, environment)
  const joinPath = platform === "win32" ? win32.join : join
  return pathDirectories(platform, environment).flatMap((directory) =>
    executableNames[slicerId].flatMap((name) =>
      extensions.map((extension) =>
        platform === "win32" && !name.toLowerCase().endsWith(extension.toLowerCase())
          ? joinPath(directory, `${name}${extension}`)
          : joinPath(directory, name),
      ),
    ),
  )
}

function installationCandidates(input: {
  slicerId: SlicerId
  platform: NodeJS.Platform
  environment: NodeJS.ProcessEnv
  home: string
}) {
  const override = input.environment[executableEnvironmentKeys[input.slicerId]]
  if (override && !isAbsolute(override)) {
    throw new Error(`${executableEnvironmentKeys[input.slicerId]} must be an absolute path.`)
  }
  const platformPaths =
    input.platform === "darwin"
      ? macApplicationPaths(input.slicerId, input.home)
      : input.platform === "win32"
        ? windowsApplicationPaths(input.slicerId, input.environment)
        : []
  return [
    ...(override ? [override] : []),
    ...platformPaths,
    ...pathCandidates(input.slicerId, input.platform, input.environment),
  ]
}

async function isExecutable(path: string) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export class SlicerNotInstalledError extends Error {
  constructor(readonly slicerId: SlicerId) {
    super(`${slicerNames[slicerId]} is not installed or configured.`)
    this.name = "SlicerNotInstalledError"
  }
}

export async function resolveSlicerExecutable(input: {
  slicerId: SlicerId
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  home?: string
  pathIsExecutable?: (path: string) => Promise<boolean>
}) {
  const platform = input.platform ?? process.platform
  if (!(["darwin", "linux", "win32"] as const).includes(platform as never)) {
    throw new Error(`Unsupported slicer bridge platform: ${platform}`)
  }
  const environment = input.environment ?? process.env
  const pathIsExecutable = input.pathIsExecutable ?? isExecutable
  for (const candidate of installationCandidates({
    slicerId: input.slicerId,
    platform,
    environment,
    home: input.home ?? homedir(),
  })) {
    if (await pathIsExecutable(candidate)) return candidate
  }
  return null
}

function spawnWithoutShell(command: readonly string[]) {
  return Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  })
}

export async function launchSlicerFile(input: {
  slicerId: SlicerId
  filePath: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  home?: string
  pathIsExecutable?: (path: string) => Promise<boolean>
  spawn?: SpawnProcess
}) {
  const executable = await resolveSlicerExecutable(input)
  if (!executable) throw new SlicerNotInstalledError(input.slicerId)
  const child = (input.spawn ?? spawnWithoutShell)([executable, input.filePath])
  child.unref?.()
  return { slicerId: input.slicerId, executable }
}
