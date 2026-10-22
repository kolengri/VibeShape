import { choice, type Fetch, TypeSafeClient } from "@typesafe-ai/sdk"
import type { AssistantConnectionTestResult } from "@vibeshape/automation-api/assistant"
import { z } from "zod"
import type { Configuration } from "./configuration"
import { requestLocalArguments } from "./local-arguments"

const probeAnswer = z.object({
  answers: z.object({
    connection: z.object({
      type: z.literal("choice"),
      choice: z.literal("ok"),
      confidence: z.number().finite().min(0).max(1),
    }),
  }),
})
const completion = z.object({
  choices: z
    .array(
      z.object({ message: z.object({ content: z.string() }), finish_reason: z.literal("stop") }),
    )
    .length(1),
})
const confirmation = z.strictObject({ ok: z.literal(true) })

// Keep response reads bounded and streamed: SDK 0.7.0 consumes a response clone.
function boundedResponse(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return response
  let bytes = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            reader.releaseLock()
            controller.close()
            return
          }
          bytes += chunk.value.byteLength
          if (bytes > 16 * 1024) throw new Error("Probe response limit.")
          controller.enqueue(chunk.value)
        } catch {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
          controller.error(new Error("Invalid probe response."))
        }
      },
      async cancel() {
        await reader.cancel()
        reader.releaseLock()
      },
    }),
    { status: response.status, headers: response.headers },
  )
}

export async function probeProviders(
  configuration: Configuration,
  options: { fetch?: Fetch; timeoutMs?: number } = {},
): Promise<AssistantConnectionTestResult> {
  let stage: "jev" | "arguments" = "jev"
  let httpStatus: number | undefined
  const controller = new AbortController()
  // Cold inbox PowerShell/Add-Type startup can exceed the ordinary provider probe budget.
  const budget = configuration.argumentsAgent && process.platform === "win32" ? 50_000 : 20_000
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(options.timeoutMs ?? configuration.timeoutMs, budget),
  )
  const request: Fetch = async (url, init) => {
    controller.signal.throwIfAborted()
    const response = await (options.fetch ?? fetch)(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    })
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {})
      controller.signal.throwIfAborted()
    }
    if (!response.ok) {
      httpStatus = response.status
      await response.body?.cancel().catch(() => {})
      throw new Error("Probe request failed.")
    }
    return boundedResponse(response)
  }
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Probe timed out."))
    controller.signal.addEventListener("abort", abort, { once: true })
  })
  const run = async (): Promise<AssistantConnectionTestResult> => {
    const client = new TypeSafeClient({
      apiKey: configuration.apiKey,
      baseURL: "https://api.typesafe.ai",
      logLevel: "off",
      retry: { maxRetries: 0 },
      timeout: Math.min(configuration.timeoutMs, 20_000),
      fetch: request,
    })
    const result: unknown = await client.systemOne(
      {
        model: configuration.model,
        state: "Connection check.",
        questions: {
          connection: choice("Confirm the connection check.", { ok: "Connection confirmed." }),
        },
      },
      { signal: controller.signal },
    )
    probeAnswer.parse(result)
    controller.signal.throwIfAborted()
    const checks: Array<"agent" | "jev" | "arguments"> = ["agent", "jev"]
    if (configuration.argumentsAgent) {
      stage = "arguments"
      const response = await requestLocalArguments(
        configuration.argumentsAgent,
        'Return only {"ok":true} as JSON. Do not use tools.',
        controller.signal,
      )
      confirmation.parse(JSON.parse(response))
      checks.push("arguments")
    } else if (configuration.argumentsEndpoint && configuration.argumentsModel) {
      stage = "arguments"
      const response = await request(configuration.argumentsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(configuration.argumentsApiKey
            ? { Authorization: `Bearer ${configuration.argumentsApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: configuration.argumentsModel,
          messages: [{ role: "user", content: 'Return only {"ok":true} as JSON.' }],
          response_format: { type: "json_object" },
          max_tokens: 16,
          stream: false,
        }),
      })
      const payload = completion.parse(await response.json())
      confirmation.parse(JSON.parse(payload.choices[0]?.message.content ?? ""))
      checks.push("arguments")
    }
    return { ok: true, checks }
  }
  try {
    return await Promise.race([run(), cancelled])
  } catch {
    return {
      ok: false,
      code: controller.signal.aborted ? "timeout" : "request-failed",
      stage,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    }
  } finally {
    clearTimeout(timer)
    if (abort) controller.signal.removeEventListener("abort", abort)
    controller.abort()
  }
}
