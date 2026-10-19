import { describe, expect, it } from "bun:test"
import type { ApiConfiguration } from "./api-assistant-preferences"
import { type ApiFetch, requestApiCompletion } from "./api-chat-completions"
import { ApiAssistantError } from "./api-errors"

const configuration: ApiConfiguration = {
  endpoint: "https://api.example.test/v1/chat/completions",
  model: "user-model",
  stream: true,
  apiKey: "runtime-secret",
}
function stream(frames: string[], split = 7) {
  const bytes = new TextEncoder().encode(frames.join(""))
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split))
        controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}
const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`
function options(fetcher: ApiFetch) {
  return {
    configuration,
    messages: [{ role: "user" as const, content: "Inspect this model" }],
    signal: new AbortController().signal,
    onText: () => {},
    fetch: fetcher,
  }
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })

describe("direct Chat Completions transport", () => {
  it("assembles bounded SSE text and fragmented function arguments with UTF-8 and exact endpoint isolation", async () => {
    let request: RequestInit | undefined, endpoint: RequestInfo | URL | undefined
    const text: string[] = []
    const fetcher: ApiFetch = async (url, init) => {
      endpoint = url
      request = init
      return stream(
        [
          frame({ content: "Hi é" }),
          frame({
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "discover_cad_tools", arguments: '{"query":' },
              },
            ],
          }),
          frame({ tool_calls: [{ index: 0, function: { arguments: '"box"}' } }] }, "tool_calls"),
          "data: [DONE]\r\n\r\n",
        ],
        1,
      )
    }
    const result = await requestApiCompletion({
      ...options(fetcher),
      onText: (value) => text.push(value),
    })
    expect(result).toEqual({
      content: "Hi é",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "discover_cad_tools", arguments: '{"query":"box"}' },
        },
      ],
    })
    expect(text.join("")).toBe("Hi é")
    expect(endpoint).toBe(configuration.endpoint)
    expect(request).toMatchObject({
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: { Authorization: "Bearer runtime-secret" },
    })
    const body = JSON.parse(String(request?.body))
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
      "discover_cad_tools",
      "call_cad_tool",
    ])
    expect(body).toMatchObject({
      model: "user-model",
      stream: true,
      parallel_tool_calls: false,
      max_completion_tokens: 4096,
    })
    expect(String(request?.body)).not.toContain("runtime-secret")
  })

  it("accepts a nonstreaming compatible response without repeating the paid request", async () => {
    let calls = 0
    const text: string[] = []
    const result = await requestApiCompletion({
      ...options(async () => {
        calls += 1
        return json({ choices: [{ message: { content: "Ready" }, finish_reason: "stop" }] })
      }),
      configuration: { ...configuration, stream: false, apiKey: "" },
      onText: (value) => text.push(value),
    })
    expect(result).toEqual({ content: "Ready", toolCalls: [] })
    expect(text).toEqual(["Ready"])
    expect(calls).toBe(1)
  })

  it("rejects invalid configuration before fetch and contains provider, network and malformed response failures", async () => {
    let calls = 0
    await expect(
      requestApiCompletion({
        ...options(async () => {
          calls += 1
          return json({})
        }),
        configuration: { ...configuration, endpoint: "http://external.example/completions" },
      }),
    ).rejects.toMatchObject({ code: "invalid-configuration" })
    expect(calls).toBe(0)
    for (const [status, code] of [
      [401, "authentication"],
      [403, "authentication"],
      [429, "rate-limit"],
      [500, "endpoint"],
    ] as const)
      await expect(
        requestApiCompletion(
          options(async () => json({ error: { message: "private provider secret" } }, status)),
        ),
      ).rejects.toMatchObject({ code })
    await expect(
      requestApiCompletion(
        options(async () => {
          throw new TypeError("private network details")
        }),
      ),
    ).rejects.toMatchObject({ code: "network" })
    await expect(
      requestApiCompletion(
        options(async () =>
          json({ choices: [{ message: { content: {} }, finish_reason: "stop" }] }),
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-response" })
    await expect(
      requestApiCompletion(options(async () => stream([frame({ content: "Incomplete" }, "stop")]))),
    ).rejects.toMatchObject({ code: "invalid-response" })
    await expect(
      requestApiCompletion(options(async () => stream(["data: malformed\n\n"]))),
    ).rejects.toMatchObject({ code: "invalid-response" })
  })

  it("bounds response bytes and request time and rejects redirected response handles", async () => {
    await expect(
      requestApiCompletion(
        options(
          async () =>
            new Response("x".repeat(1024 * 1024 + 1), {
              headers: { "Content-Type": "application/json" },
            }),
        ),
      ),
    ).rejects.toMatchObject({ code: "response-limit" })
    const redirected = json({})
    Object.defineProperty(redirected, "redirected", { value: true })
    await expect(requestApiCompletion(options(async () => redirected))).rejects.toMatchObject({
      code: "endpoint",
    })
    const fetcher: ApiFetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
      )
    await expect(
      requestApiCompletion({ ...options(fetcher), timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ApiAssistantError)
    await expect(
      requestApiCompletion({ ...options(fetcher), timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: "timeout" })
  })
})
