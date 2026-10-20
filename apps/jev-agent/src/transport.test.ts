import { describe, expect, it } from "bun:test"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import { createJevDecision } from "./decision"
import { typesafeFetch } from "./transport"

describe("Jev SDK Bun transport", () => {
  it("bounds actual TypeSafe response bytes", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("x".repeat(1024 * 1024 + 1)),
    })
    try {
      const response = await typesafeFetch(server.url.toString())
      await expect(response.text()).rejects.toThrow("exceeded 1 MiB")
    } finally {
      await server.stop(true)
    }
  })
  it("buffers an actual local HTTP response without consuming the original SDK body", async () => {
    let requests = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++
        return Response.json({
          model: "test",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: {
            action: {
              type: "choice",
              choice: "done",
              confidence: 1,
              probabilities: { done: 1, blocked: 0 },
            },
          },
        })
      },
    })
    try {
      const client = new TypeSafeClient({
        apiKey: "local-test",
        baseURL: server.url.toString(),
        fetch: typesafeFetch,
        compression: false,
        retry: { maxRetries: 0 },
        logLevel: "off",
      })
      const decide = createJevDecision(client, "test")
      expect(
        await decide(
          { goal: "Inspect", instructions: "Read only", history: [], photos: [] },
          [],
          new AbortController().signal,
        ),
      ).toEqual({ kind: "done", confidence: 1 })
      expect(requests).toBe(1)
    } finally {
      await server.stop(true)
    }
  })
})
