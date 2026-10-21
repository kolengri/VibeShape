import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Public source only: this process never receives a descriptor path or token.
const source = readFileSync(
  new URL("../../apps/desktop/src/private-files.ts", import.meta.url),
  "utf8",
)
const definition = /-TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/.exec(source)?.[1]
if (!definition || /\\|\$\{/.test(definition))
  throw new Error("Unsupported public compiler-probe source form.")
const script = `
$ErrorActionPreference = 'Stop'
try {
  $command = Get-Command 'Microsoft.PowerShell.Utility\\Add-Type' -ErrorAction Stop
  [Console]::Out.WriteLine('resolved')
  & $command -TypeDefinition 'public static class VibeShapeCompileProbe { public static int Value = 1; }'
  if ([VibeShapeCompileProbe]::Value -ne 1) { throw 'Invalid public probe value.' }
  [Console]::Out.WriteLine('basic-loaded')
  & $command -TypeDefinition @'
${definition}
'@
  [Console]::Out.WriteLine('loaded')
} catch { exit 1 }
`
const executable = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
)
const started = Date.now()
const child = execFile(
  executable,
  [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ],
  { encoding: "utf8", timeout: 15_000, maxBuffer: 4096, windowsHide: true },
  (error, stdout, stderr) => {
    const lines = stdout.split(/\r?\n/)
    const stage =
      ["loaded", "basic-loaded", "resolved"].find((marker) => lines.includes(marker)) ??
      "not-started"
    const code = error?.killed
      ? "terminated"
      : Number.isInteger(error?.code)
        ? error.code
        : error
          ? "unknown"
          : 0
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "probe/compile",
        params: {
          ok: !error && stage === "loaded",
          stage,
          code,
          milliseconds: Date.now() - started,
          stderrBytes: Buffer.byteLength(stderr),
        },
      })}\n`,
    )
  },
)
child.stdin.on("error", () => {})
if (process.argv[2] === "closed") child.stdin.end()
process.stdin.resume()
process.stdin.once("end", () => process.exit())
