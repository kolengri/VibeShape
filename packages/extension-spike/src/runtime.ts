import {
  type SandboxTaskMode,
  type SandboxWorkerMessage,
  sandboxWorkerMessageSchema,
} from "./runtime-protocol"

export interface SandboxTaskResult {
  status: "completed" | "timeout" | "resource-limit" | "invalid-module" | "failed"
  durationMs: number
  messages: number
  value: number | null
  authority: Record<string, boolean> | null
  diagnostic: string | null
}

interface SandboxTaskInput {
  mode: SandboxTaskMode
  wasm?: Uint8Array
  input?: number
  timeoutMs?: number
  maxMessages?: number
  maxOutputBytes?: number
}

interface SandboxBudgets {
  timeoutMs: number
  maxMessages: number
  maxOutputBytes: number
}

type SandboxTaskValues = Omit<SandboxTaskResult, "durationMs">

function result(startedAt: number, values: SandboxTaskValues): SandboxTaskResult {
  return { ...values, durationMs: performance.now() - startedAt }
}

async function compileWasm(bytes: Uint8Array) {
  try {
    return await WebAssembly.compile(Uint8Array.from(bytes))
  } catch {
    return null
  }
}

function hasExpectedExportSurface(module: WebAssembly.Module) {
  const exports = WebAssembly.Module.exports(module)
  return exports.map(({ name, kind }) => `${name}:${kind}`).join(",") === "evaluate:function"
}

async function validateWasm(bytes: Uint8Array) {
  const module = await compileWasm(bytes)
  if (!module) return "invalid-wasm"
  if (WebAssembly.Module.imports(module).length > 0) return "undeclared-import"
  if (!hasExpectedExportSurface(module)) return "invalid-export-surface"
  return null
}

function messageSize(message: SandboxWorkerMessage) {
  return message.bytes?.byteLength ?? JSON.stringify(message).length
}

function parseWorkerMessage(value: unknown) {
  const parsed = sandboxWorkerMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function terminalValues(message: SandboxWorkerMessage, messages: number): SandboxTaskValues {
  return {
    status: message.type === "error" ? "failed" : "completed",
    messages,
    value: message.value,
    authority: message.authority,
    diagnostic: message.diagnostic,
  }
}

function failureValues(
  status: SandboxTaskResult["status"],
  messages: number,
  diagnostic: string,
): SandboxTaskValues {
  return { status, messages, value: null, authority: null, diagnostic }
}

async function preflightWasm(startedAt: number, mode: SandboxTaskMode, wasm: Uint8Array | null) {
  if (mode !== "wasm") return null
  const diagnostic = wasm ? await validateWasm(wasm) : "missing-wasm"
  if (!diagnostic) return null
  return result(startedAt, failureValues("invalid-module", 0, diagnostic))
}

class WorkerTaskSession {
  readonly #worker = new Worker(new URL("./feature-worker.ts", import.meta.url), { type: "module" })
  readonly #startedAt: number
  readonly #budgets: SandboxBudgets
  readonly #resolve: (value: SandboxTaskResult) => void
  #messages = 0
  #settled = false
  #timeout = 0

  constructor(
    startedAt: number,
    budgets: SandboxBudgets,
    resolve: (value: SandboxTaskResult) => void,
  ) {
    this.#startedAt = startedAt
    this.#budgets = budgets
    this.#resolve = resolve
  }

  start(input: SandboxTaskInput, wasm: Uint8Array | null) {
    this.#timeout = window.setTimeout(() => {
      this.#finish(failureValues("timeout", this.#messages, "execution-timeout"))
    }, this.#budgets.timeoutMs)
    this.#worker.addEventListener("message", (event) => this.#handleMessage(event.data))
    this.#worker.addEventListener("error", () => {
      this.#finish(failureValues("failed", this.#messages, "worker-error"))
    })
    this.#worker.postMessage({
      schemaVersion: 0,
      mode: input.mode,
      wasm,
      input: input.input ?? 0,
    })
  }

  #handleMessage(value: unknown) {
    this.#messages += 1
    const message = parseWorkerMessage(value)
    if (!message) {
      this.#finish(failureValues("resource-limit", this.#messages, "invalid-worker-message"))
      return
    }
    this.#handleValidMessage(message)
  }

  #handleValidMessage(message: SandboxWorkerMessage) {
    if (!this.#withinBudget(message)) {
      this.#finish(failureValues("resource-limit", this.#messages, "output-budget"))
      return
    }
    if (!message.terminal) return
    this.#finish(terminalValues(message, this.#messages))
  }

  #withinBudget(message: SandboxWorkerMessage) {
    return [
      this.#messages <= this.#budgets.maxMessages,
      messageSize(message) <= this.#budgets.maxOutputBytes,
    ].every(Boolean)
  }

  #finish(values: SandboxTaskValues) {
    if (this.#settled) return
    this.#settled = true
    window.clearTimeout(this.#timeout)
    this.#worker.terminate()
    this.#resolve(result(this.#startedAt, values))
  }
}

function executeWorkerTask(
  startedAt: number,
  input: SandboxTaskInput,
  wasm: Uint8Array | null,
  budgets: SandboxBudgets,
) {
  return new Promise<SandboxTaskResult>((resolve) => {
    new WorkerTaskSession(startedAt, budgets, resolve).start(input, wasm)
  })
}

function copyWasm(wasm: Uint8Array | undefined) {
  if (!wasm) return null
  return Uint8Array.from(wasm)
}

function sandboxBudgets(input: SandboxTaskInput): SandboxBudgets {
  const { timeoutMs = 100, maxMessages = 16, maxOutputBytes = 64 * 1024 } = input
  return { timeoutMs, maxMessages, maxOutputBytes }
}

export async function runSandboxTask(input: SandboxTaskInput): Promise<SandboxTaskResult> {
  const startedAt = performance.now()
  const wasm = copyWasm(input.wasm)
  const preflight = await preflightWasm(startedAt, input.mode, wasm)
  if (preflight) return preflight
  return executeWorkerTask(startedAt, input, wasm, sandboxBudgets(input))
}
