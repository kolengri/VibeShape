import { spawn } from "node:child_process"
import electron from "electron"

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(String(electron), [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: false,
})
child.once("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once("exit", (code) => {
  process.exitCode = code ?? 1
})
