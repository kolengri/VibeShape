import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Fetch } from "@typesafe-ai/sdk"
import { readConfiguration } from "./configuration"
import { probeProviders } from "./provider-probe"

const configuration = (helper = false) =>
  readConfiguration({
    TYPESAFE_API_KEY: "test-typesafe-secret",
    TYPESAFE_MODEL: "jev-probe-model",
    ...(helper
      ? {
          JEV_ARGUMENTS_ENDPOINT: "https://helper.example.test/v1/chat/completions",
          JEV_ARGUMENTS_MODEL: "helper-probe-model",
          JEV_ARGUMENTS_API_KEY: "test-helper-secret",
        }
      : {}),
  })
const jevResponse = () =>
  Response.json({
    answers: {
      connection: { type: "choice", choice: "ok", confidence: 1, probabilities: { ok: 1 } },
    },
    model: "jev-probe-model",
    usage: { input_tokens: 1, output_tokens: 1 },
  })
const helperResponse = (content = '{"ok":true}') =>
  Response.json({
    choices: [{ message: { content }, finish_reason: "stop" }],
  })

describe("read-only provider connection probe", () => {
  test("checks a local signed-in agent with an isolated JSON request after Jev succeeds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "local-probe-"))
    const receipt = join(directory, "receipt")
    const trace = join(directory, "supervisor.jsonl")
    const tracing = process.platform === "win32"
    const previousTrace = process.env.VIBESHAPE_ARGUMENT_TRACE
    if (tracing) process.env.VIBESHAPE_ARGUMENT_TRACE = trace
    try {
      const script = fileURLToPath(
        new URL("../../../tests/desktop/fixtures/argument-agent.cjs", import.meta.url),
      )
      const argumentsAgent = {
        command: process.execPath,
        args: [script, "probe", receipt],
      }
      const config = readConfiguration({
        TYPESAFE_API_KEY: "test-key",
        JEV_ARGUMENTS_AGENT: JSON.stringify(argumentsAgent),
      })
      const result = await probeProviders(config, { fetch: async () => jevResponse() })
      if (tracing) {
        console.info(
          "Windows local provider probe:",
          JSON.stringify({
            result,
            supervisor: await readFile(trace, "utf8").catch(() => "absent"),
            // This fixture contains only the synthetic connection-check exchange.
            receipt: await readFile(receipt, "utf8").catch(() => "absent"),
          }),
        )
      }
      expect(result).toEqual({
        ok: true,
        checks: ["agent", "jev", "arguments"],
      })
      expect(
        await probeProviders(
          { ...config, argumentsAgent: { command: "/missing-agent", args: [] } },
          { fetch: async () => jevResponse() },
        ),
      ).toEqual({ ok: false, code: "request-failed", stage: "arguments" })
    } finally {
      if (tracing) {
        if (previousTrace === undefined) delete process.env.VIBESHAPE_ARGUMENT_TRACE
        else process.env.VIBESHAPE_ARGUMENT_TRACE = previousTrace
      }
      await rm(directory, { recursive: true, force: true })
    }
  }, 65_000)
  test.each([false, true])(
    "validates the configured providers with minimal isolated requests (helper=%s)",
    async (helper) => {
      const calls: { url: string; init: RequestInit }[] = []
      const request: Fetch = async (url, init) => {
        calls.push({ url, init: init ?? {} })
        return url.startsWith("https://api.typesafe.ai/") ? jevResponse() : helperResponse()
      }
      expect(await probeProviders(configuration(helper), { fetch: request })).toEqual({
        ok: true,
        checks: helper ? ["agent", "jev", "arguments"] : ["agent", "jev"],
      })
      expect(calls).toHaveLength(helper ? 2 : 1)
      expect(calls[0]?.init.redirect).toBe("error")
      const body = JSON.parse(String(calls[0]?.init.body))
      expect(body.model).toBe("jev-probe-model")
      expect(Object.keys(body.questions)).toEqual(["connection"])
      expect(body.state).toBe("Connection check.")
      expect(calls[0]?.init.headers).not.toHaveProperty("TypeSafe-Danger-Zone-Images")
      if (helper) {
        expect(calls[1]?.init.headers).toEqual({
          "Content-Type": "application/json",
          Authorization: "Bearer test-helper-secret",
        })
        expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
          model: "helper-probe-model",
          messages: [{ role: "user", content: 'Return only {"ok":true} as JSON.' }],
          response_format: { type: "json_object" },
          max_tokens: 16,
          stream: false,
        })
      }
    },
  )

  test.each([401, 403, 404, 429, 503])(
    "reports only numeric Jev HTTP status %s without retrying or probing the helper",
    async (status) => {
      let calls = 0
      const result = await probeProviders(configuration(true), {
        fetch: async () => {
          calls += 1
          return new Response("raw provider error with test-typesafe-secret", { status })
        },
      })
      expect(result).toEqual({
        ok: false,
        code: "request-failed",
        stage: "jev",
        httpStatus: status,
      })
      expect(calls).toBe(1)
      expect(JSON.stringify(result)).not.toContain("secret")
    },
  )

  test("attributes helper failures and contains malformed JSON and oversized responses", async () => {
    for (const response of [
      new Response("private", { status: 401 }),
      helperResponse("invalid JSON"),
      helperResponse('{"ok":false}'),
      helperResponse("x".repeat(20_000)),
    ]) {
      const result = await probeProviders(configuration(true), {
        fetch: async (url) =>
          url.startsWith("https://api.typesafe.ai/") ? jevResponse() : response,
      })
      expect(result).toEqual({
        ok: false,
        code: "request-failed",
        stage: "arguments",
        ...(response.status === 401 ? { httpStatus: 401 } : {}),
      })
    }
  })

  test("rejects a malformed successful Jev response", async () => {
    expect(
      await probeProviders(configuration(), { fetch: async () => Response.json({ answers: {} }) }),
    ).toEqual({ ok: false, code: "request-failed", stage: "jev" })
  })

  test.each([false, true])(
    "times out and aborts even a noncooperative fetch (helper=%s)",
    async (helper) => {
      let signal: AbortSignal | null | undefined
      const result = await probeProviders(configuration(helper), {
        timeoutMs: 30,
        fetch: async (url, init) => {
          if (helper && url.startsWith("https://api.typesafe.ai/")) return jevResponse()
          signal = init?.signal
          return new Promise<Response>(() => {})
        },
      })
      expect(result).toEqual({ ok: false, code: "timeout", stage: helper ? "arguments" : "jev" })
      expect(signal?.aborted).toBe(true)
    },
  )
})
