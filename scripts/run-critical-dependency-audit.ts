import { spawn } from "node:child_process"

const auditCommand = ["bun", "audit", "--audit-level=critical"] as const
const auditAttemptTimeoutMs = 300_000
const auditRetryDelayMs = 2_000
const maximumAuditAttempts = 2

export type AuditAttemptResult = Readonly<{
  exitCode: number
  stderr: string
  stdout: string
  timedOut: boolean
}>

type AuditRetryOptions = Readonly<{
  delay: (milliseconds: number) => Promise<void>
  report: (result: AuditAttemptResult, attempt: number, maximumAttempts: number) => void
  runAttempt: () => Promise<AuditAttemptResult>
}>

const transientAuditFailure =
  /audit request failed|ConnectionClosed|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|status 5\d\d/i

export function isTransientAuditFailure(result: AuditAttemptResult) {
  return result.timedOut || transientAuditFailure.test(`${result.stderr}\n${result.stdout}`)
}

export async function runCriticalDependencyAudit({
  delay,
  report,
  runAttempt,
}: AuditRetryOptions): Promise<AuditAttemptResult> {
  let result: AuditAttemptResult = {
    exitCode: 1,
    stderr: "The dependency audit did not run.",
    stdout: "",
    timedOut: false,
  }

  for (let attempt = 1; attempt <= maximumAuditAttempts; attempt += 1) {
    result = await runAttempt()
    report(result, attempt, maximumAuditAttempts)
    if (result.exitCode === 0) return result
    if (!isTransientAuditFailure(result)) return result
    if (attempt < maximumAuditAttempts) await delay(auditRetryDelayMs)
  }

  return result
}

export async function runAuditProcess(
  command: readonly string[],
  timeoutMs: number,
): Promise<AuditAttemptResult> {
  const [executable, ...arguments_] = command
  if (!executable) {
    return { exitCode: 1, stderr: "The audit command is empty.", stdout: "", timedOut: false }
  }
  return await new Promise((resolve) => {
    const child = spawn(executable, arguments_, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    let stdout = ""
    let timedOut = false
    child.stderr.setEncoding("utf8")
    child.stdout.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timeout)
      resolve({ exitCode: 1, stderr: `${stderr}${error.message}\n`, stdout, timedOut })
    })
    child.once("close", (exitCode) => {
      clearTimeout(timeout)
      resolve({ exitCode: exitCode ?? (timedOut ? 137 : 1), stderr, stdout, timedOut })
    })
  })
}

function runAuditAttempt() {
  return runAuditProcess(auditCommand, auditAttemptTimeoutMs)
}

function reportAuditAttempt(result: AuditAttemptResult, attempt: number, maximumAttempts: number) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.timedOut) {
    process.stderr.write(`Dependency audit attempt ${attempt} timed out.\n`)
  }
  if (result.exitCode !== 0 && isTransientAuditFailure(result) && attempt < maximumAttempts) {
    process.stderr.write(`Retrying dependency audit (${attempt + 1}/${maximumAttempts}).\n`)
  }
}

if (import.meta.main) {
  const result = await runCriticalDependencyAudit({
    delay: Bun.sleep,
    report: reportAuditAttempt,
    runAttempt: runAuditAttempt,
  })
  process.exitCode = result.exitCode
}
