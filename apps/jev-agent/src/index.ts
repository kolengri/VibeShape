import { Readable, Writable } from "node:stream"
import * as acp from "@agentclientprotocol/sdk"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import {
  type AssistantConnectionTestResult,
  assistantConnectionTestResultSchema,
} from "@vibeshape/automation-api/assistant"
import { createJevAgent } from "./agent"
import { createArgumentCompleter } from "./arguments"
import { readConfiguration } from "./configuration"
import { createJevDecision } from "./decision"
import { probeProviders } from "./provider-probe"
import { typesafeFetch } from "./transport"

async function main() {
  if (process.argv.includes("--test-connection")) {
    let result: AssistantConnectionTestResult
    try {
      result = await probeProviders(readConfiguration(process.env))
    } catch {
      result = { ok: false, code: "jev-configuration-required", stage: "jev" }
    }
    process.stdout.write(`${JSON.stringify(assistantConnectionTestResultSchema.parse(result))}\n`)
    return
  }
  try {
    const configuration = readConfiguration(process.env)
    const typesafe = new TypeSafeClient({
      apiKey: configuration.apiKey,
      baseURL: "https://api.typesafe.ai",
      logLevel: "off",
      retry: { maxRetries: 0 },
      fetch: typesafeFetch,
      timeout: configuration.timeoutMs,
    })
    const agent = createJevAgent(configuration, {
      decide: createJevDecision(typesafe, configuration.model),
      completeArguments: configuration.argumentsAgent
        ? createArgumentCompleter({ agent: configuration.argumentsAgent })
        : configuration.argumentsEndpoint && configuration.argumentsModel
          ? createArgumentCompleter({
              endpoint: configuration.argumentsEndpoint,
              model: configuration.argumentsModel,
              apiKey: configuration.argumentsApiKey ?? "",
            })
          : undefined,
    })
    const connection = agent.app.connect(
      acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin), {
        maxMessageBytes: 1024 * 1024,
      }),
    )
    await connection.closed
    await agent.close()
  } catch {
    console.error(
      "The VibeShape Jev adapter could not start or its ACP connection closed. Check the environment in docs/jev-agent.md.",
    )
    process.exitCode = 1
  }
}

void main()
