interface ProcessResult {
  error?: Error
  status: number | null
}

export function assertSuccessfulOcctProcess(result: ProcessResult, description: string) {
  if (result.error) {
    throw new Error(`${description} failed to start: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(`${description} exited with status ${String(result.status)}.`)
  }
}
