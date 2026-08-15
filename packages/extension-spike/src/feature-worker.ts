import { isError, isFunction, isNumber } from "is-what"
import { type SandboxWorkerMessage, sandboxWorkerRequestSchema } from "./runtime-protocol"

function post(value: SandboxWorkerMessage) {
  globalThis.postMessage(value)
}

function requireWorkerCondition(condition: boolean, diagnostic: string): asserts condition {
  if (!condition) throw new Error(diagnostic)
}

function message(values: Partial<SandboxWorkerMessage>): SandboxWorkerMessage {
  return {
    schemaVersion: 0,
    type: "error",
    terminal: true,
    value: null,
    authority: null,
    sequence: null,
    bytes: null,
    diagnostic: null,
    ...values,
  }
}

async function runWasm(wasm: Uint8Array | null, input: number) {
  requireWorkerCondition(wasm !== null, "missing-wasm")
  const instance = await WebAssembly.instantiate(Uint8Array.from(wasm))
  const evaluate = Reflect.get(instance.instance.exports, "evaluate")
  requireWorkerCondition(isFunction(evaluate), "missing-evaluate-export")
  const value: unknown = Reflect.apply(evaluate, undefined, [input])
  requireWorkerCondition(isNumber(value), "invalid-feature-output-type")
  requireWorkerCondition(Number.isInteger(value), "invalid-feature-output")
  post(message({ type: "result", value }))
}

function probeJavascriptAuthority() {
  post(
    message({
      type: "probe",
      terminal: true,
      authority: {
        network: isFunction(globalThis.fetch),
        clock: isFunction(Date.now),
        randomness: isFunction(Math.random) || isFunction(crypto.getRandomValues),
        indexedDb: "indexedDB" in globalThis,
        cacheStorage: "caches" in globalThis,
        dom: "document" in globalThis,
        rawKernel: Reflect.has(globalThis, "OCCT"),
      },
    }),
  )
}

function floodMessages() {
  for (let sequence = 0; sequence < 1_000; sequence += 1) {
    post(message({ type: "flood", terminal: false, sequence }))
  }
}

function growMemory() {
  const retained: Uint8Array[] = []
  for (let sequence = 0; sequence < 1_000; sequence += 1) {
    retained.push(new Uint8Array(1024 * 1024))
    post(message({ type: "flood", terminal: false, sequence }))
  }
}

async function execute(value: unknown) {
  const request = sandboxWorkerRequestSchema.parse(value)
  const operations = {
    wasm: () => runWasm(request.wasm, request.input),
    "javascript-probe": async () => probeJavascriptAuthority(),
    "javascript-loop": async () => {
      while (true) await Promise.resolve()
    },
    "message-flood": async () => floodMessages(),
    "memory-growth": async () => growMemory(),
    "oversized-output": async () =>
      post(message({ type: "bytes", bytes: new Uint8Array(128 * 1024) })),
  }
  await operations[request.mode]()
}

globalThis.addEventListener("message", (event) => {
  void execute(event.data).catch((error: unknown) => {
    post(
      message({
        type: "error",
        diagnostic: isError(error) ? error.message.slice(0, 80) : "unknown-worker-error",
      }),
    )
  })
})
