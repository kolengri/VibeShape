const auditCommand = ["bun", "audit", "--audit-level=critical"] as const
const auditAttemptTimeoutMs = 45_000
const auditRetryDelayMs = 2_000
const maximumAuditAttempts = 3

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

async function runAuditAttempt(): Promise<AuditAttemptResult> {
  const child = Bun.spawn([...auditCommand], {
    killSignal: "SIGKILL",
    stderr: "pipe",
    stdout: "pipe",
    timeout: auditAttemptTimeoutMs,
  })
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  return { exitCode, stderr, stdout, timedOut: child.killed }
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
