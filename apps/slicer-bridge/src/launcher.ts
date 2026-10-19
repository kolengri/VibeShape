import type { SlicerId } from "@vibeshape/slicer-handoff/protocol"
import { resolveSlicerExecutable, SlicerNotInstalledError } from "./resolver"

export { resolveSlicerExecutable, SlicerNotInstalledError } from "./resolver"

type SpawnedProcess = Readonly<{ unref?: () => void }>
type SpawnProcess = (command: readonly string[]) => SpawnedProcess

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
