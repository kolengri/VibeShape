import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process"

export type NativeSlicerApplication = Readonly<{
  id: string
  name: string
  path: string
  kind: "bundle" | "executable"
}>

export function launchNativeSlicer(
  application: NativeSlicerApplication,
  file: string,
  options: {
    spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  } = {},
) {
  const bundle = application.kind === "bundle"
  const command = bundle ? "/usr/bin/open" : application.path
  const args = bundle ? ["-a", application.path, file] : [file]
  const env = { ...(options.env ?? process.env) }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise<void>((resolve, reject) => {
    const child = (options.spawn ?? spawn)(command, args, {
      env,
      shell: false,
      stdio: "ignore",
      detached: !bundle,
    })
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error("The slicer launch did not finish."))
    }, options.timeoutMs ?? 10_000)
    timer.unref()
    const finish = (error?: Error) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    child.once("error", finish)
    if (bundle)
      child.once("exit", (code) =>
        finish(code === 0 ? undefined : new Error("The slicer application could not be opened.")),
      )
    else
      child.once("spawn", () => {
        child.unref()
        finish()
      })
  })
}
