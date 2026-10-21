/// <reference path="./read-cmd-shim.d.ts" />
import { open, stat } from "node:fs/promises"
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path"
import type { AssistantExternalAgent } from "@vibeshape/automation-api/assistant"
import readCmdShim from "read-cmd-shim"
import { JevFailure } from "./failure"

async function file(path: string) {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false
}

async function find(command: string, directories: string[], cwd: string) {
  const names = extname(command)
    ? [command]
    : [`${command}.exe`, `${command}.com`, `${command}.cmd`]
  const roots = isAbsolute(command) || /[\\/]/.test(command) ? [cwd] : directories
  for (const root of roots)
    for (const name of names) {
      const path = resolve(cwd, root, name)
      if (await file(path)) return path
    }
  return undefined
}

export async function windowsAgentCommand(
  agent: AssistantExternalAgent,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<AssistantExternalAgent> {
  const directories = (env.PATH ?? "").split(";").filter(Boolean)
  const command = await find(agent.command, directories, cwd)
  if (!command) throw new JevFailure("Local argument agent could not be found.")
  if (!/\.(?:cmd|bat)$/i.test(command)) return { ...agent, command }
  try {
    if (extname(command).toLowerCase() !== ".cmd") throw new Error("Unsupported launcher.")
    const target = await readCmdShim(`${command.slice(0, -4)}.cmd`)
    const script = resolve(dirname(command), target.replaceAll("\\", sep))
    const handle = await open(script, "r")
    let header: string
    try {
      const buffer = Buffer.alloc(256)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const content = buffer.subarray(0, bytesRead).toString("utf8")
      if (bytesRead === buffer.length && !content.includes("\n"))
        throw new Error("Interpreter line exceeds the header limit.")
      header = content.split("\n")[0] ?? ""
    } finally {
      await handle.close()
    }
    // Only ordinary Node npm launchers can be replaced without dropping interpreter options.
    if (!/^#!\s*(?:\/usr\/bin\/env\s+node|\/usr\/bin\/node|node)(?:\.exe)?\s*$/.test(header))
      throw new Error("Unsupported interpreter.")
    const localNode = join(dirname(command), "node.exe")
    const node = (await file(localNode)) ? localNode : await find("node.exe", directories, cwd)
    if (!node) throw new Error("Node runtime unavailable.")
    return { command: node, args: [script, ...agent.args] }
  } catch {
    throw new JevFailure(
      "Local argument agent npm launcher is unsupported. Configure node.exe and its JavaScript entrypoint.",
    )
  }
}
