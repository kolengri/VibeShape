import { fileURLToPath } from "node:url"
import { z } from "zod"
import {
  type desktopMcpSetupSchema,
  StdioClientTransport,
} from "../../apps/desktop/test-support/mcp-client"

const resultSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("probe/compile"),
  params: z.object({
    ok: z.boolean(),
    stage: z.enum(["loaded", "basic-loaded", "resolved", "not-started"]),
    code: z.union([z.number().int(), z.enum(["terminated", "unknown"])]),
    milliseconds: z.number().nonnegative(),
    stderrBytes: z.number().nonnegative(),
  }),
})
type Configuration = z.infer<typeof desktopMcpSetupSchema>["mcpServers"]["vibeshape"]

async function compileProbe(
  configuration: Configuration,
  input: "open" | "closed",
  fullEnvironment = false,
) {
  const transport = new StdioClientTransport({
    command: configuration.command,
    args: [fileURLToPath(new URL("./windows-compile-probe.js", import.meta.url)), input],
    env: fullEnvironment
      ? { ...z.record(z.string(), z.string()).parse(process.env), ...configuration.env }
      : configuration.env,
    stderr: "ignore",
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = new Promise<z.infer<typeof resultSchema>["params"] | null>((resolve) => {
    timer = setTimeout(() => resolve(null), 20_000)
    transport.onclose = () => resolve(null)
    transport.onerror = () => resolve(null)
    transport.onmessage = (message) => {
      const parsed = resultSchema.safeParse(message)
      if (parsed.success) resolve(parsed.data.params)
    }
  })
  try {
    await transport.start().catch(() => transport.onclose?.())
    return { environment: fullEnvironment ? "host" : "client", input, result: await result }
  } finally {
    clearTimeout(timer)
    await transport.close()
  }
}

/** Failure-only probe metadata contains no environment values, file paths or credentials. */
export async function diagnoseWindowsCompilation(configuration: Configuration) {
  const minimal = await Promise.all([
    compileProbe(configuration, "open"),
    compileProbe(configuration, "closed"),
  ])
  if (minimal.some(({ result }) => result?.ok)) return minimal
  return [...minimal, await compileProbe(configuration, "closed", true)]
}
