import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createArgumentCompleter } from "./arguments"

const script = fileURLToPath(
  new URL("../../../tests/desktop/fixtures/argument-agent.cjs", import.meta.url),
)
const tool = { name: "create_sketch", inputSchema: { type: "object" as const } }
const state = { goal: "A 20 mm square", instructions: "Use XY", history: [], photos: [] }
const literalArgs = [
  "",
  "two words",
  'quote"inside',
  "trailing\\",
  'slash\\"quote',
  "λ漢字",
  "$(exit 9); & |",
]
const requestTimeout = process.platform === "win32" ? 50_000 : 20_000
const testTimeout = process.platform === "win32" ? 65_000 : 30_000
const budget = () => AbortSignal.timeout(requestTimeout)

async function fixture(
  mode: string,
  run: (complete: ReturnType<typeof createArgumentCompleter>, receipt: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "argument-test-"))
  const receipt = join(directory, "receipt.jsonl")
  const trace = join(directory, "supervisor.jsonl")
  const tracing = process.platform === "win32" && mode === "success"
  const previousTrace = process.env.VIBESHAPE_ARGUMENT_TRACE
  if (tracing) process.env.VIBESHAPE_ARGUMENT_TRACE = trace
  try {
    await run(
      createArgumentCompleter({
        agent: { command: process.execPath, args: [script, mode, receipt, ...literalArgs] },
      }),
      receipt,
    )
  } catch (error) {
    const log = await events(receipt).catch(() => [])
    console.error(
      "Argument fixture failure:",
      JSON.stringify(
        log.map(({ pid, backendPid, cwd, method, ready, sent, at, stdio }) => ({
          pid,
          backendPid,
          cwd,
          method,
          ready,
          sent,
          at,
          stdio,
        })),
      ),
    )
    throw error
  } finally {
    if (tracing) {
      if (previousTrace === undefined) delete process.env.VIBESHAPE_ARGUMENT_TRACE
      else process.env.VIBESHAPE_ARGUMENT_TRACE = previousTrace
      console.info(
        "Argument supervisor trace:",
        await readFile(trace, "utf8").catch(() => "absent"),
      )
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
async function events(receipt: string) {
  return (await readFile(receipt, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}

async function ready(receipt: string) {
  const deadline = Date.now() + requestTimeout
  while (Date.now() < deadline) {
    const log = await events(receipt).catch(() => [])
    if (log.some((event) => event.ready)) return log
    await Bun.sleep(25)
  }
  throw new Error("Argument fixture did not reach its ready prompt.")
}

async function expectExited(pid: number) {
  let running = true
  for (let attempt = 0; attempt < 100 && running; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      running = false
    }
    if (running) await Bun.sleep(10)
  }
  expect(running).toBe(false)
}

describe("local ACP argument helper", () => {
  it(
    "uses a fresh isolated session, streams JSON, preserves selected values and cleans up",
    async () => {
      await fixture("success", async (complete, receipt) => {
        const before = process.env.TYPESAFE_API_KEY
        process.env.TYPESAFE_API_KEY = "must-not-reach-helper"
        try {
          expect(await complete(tool, state, { plane: "XY" }, budget())).toEqual({
            plane: "XY",
            geometry: { width: 20 },
          })
        } finally {
          if (before === undefined) delete process.env.TYPESAFE_API_KEY
          else process.env.TYPESAFE_API_KEY = before
        }
        const log = await events(receipt)
        expect(log[0]).not.toHaveProperty("secret")
        expect(log[0]).not.toHaveProperty("helperKey")
        expect(log[0]).not.toHaveProperty("electron")
        expect(log[0]).not.toHaveProperty("trace")
        expect(log[0].args).toEqual(literalArgs)
        expect(log.find((e) => e.method === "initialize").params.clientCapabilities).toEqual({})
        expect(log.find((e) => e.method === "session/new").params.mcpServers).toEqual([])
        expect(log.find((e) => e.method === "session/prompt").params.prompt[0].text).toContain(
          '"selectedArguments":{"plane":"XY"}',
        )
        await expect(stat(log[0].cwd)).rejects.toThrow()
        expect(() => process.kill(log[0].pid, 0)).toThrow()
      })
    },
    testTimeout,
  )
  it(
    "denies permission requests without granting tool authority",
    async () => {
      await fixture("permission", async (complete, receipt) => {
        await complete(tool, state, {}, budget())
        expect((await events(receipt)).find((e) => e.id === "permission").result).toEqual({
          outcome: { outcome: "cancelled" },
        })
      })
    },
    testTimeout,
  )
  for (const [mode, error] of [
    ["large", "256 KiB"],
    ["invalid", "invalid argument JSON"],
    ["cancelled", "did not complete"],
  ] as const) {
    it(
      `rejects ${mode} output without returning arguments`,
      async () => {
        await fixture(mode, async (complete) => {
          await expect(complete(tool, state, {}, budget())).rejects.toThrow(error)
        })
      },
      testTimeout,
    )
  }
  it(
    "cancels a hung agent and kills its process even when SIGTERM is ignored",
    async () => {
      await fixture("hang", async (complete, receipt) => {
        const abort = new AbortController()
        const pending = complete(tool, state, {}, AbortSignal.any([abort.signal, budget()]))
        try {
          await Promise.race([ready(receipt), pending])
          abort.abort()
          await expect(pending).rejects.toThrow("cancelled")
        } finally {
          abort.abort()
        }
        const log = await events(receipt)
        expect(() => process.kill(log[0].pid, 0)).toThrow()
        await expect(stat(log[0].cwd)).rejects.toThrow()
      })
    },
    testTimeout,
  )
  it(
    "reports missing executables without exposing command text",
    async () => {
      const complete = createArgumentCompleter({
        agent: { command: "/missing/private-agent", args: [] },
      })
      const pending = complete(tool, state, {}, budget())
      await expect(pending).rejects.toThrow("Local argument agent")
      await expect(pending).rejects.not.toThrow("/missing/private-agent")
    },
    testTimeout,
  )
  for (const mode of ["descendant-success", "descendant-cancel"]) {
    it(
      `kills backend descendants after leader closure (${mode})`,
      async () => {
        await fixture(mode, async (complete, receipt) => {
          const abort = new AbortController()
          const pending = complete(tool, state, {}, AbortSignal.any([abort.signal, budget()]))
          try {
            if (mode === "descendant-cancel") {
              await Promise.race([ready(receipt), pending])
              abort.abort()
              await expect(pending).rejects.toThrow("cancelled")
            } else await pending
          } finally {
            abort.abort()
          }
          const log = await events(receipt)
          const pid = log.find((event) => event.backendPid)?.backendPid
          expect(pid).toBeNumber()
          try {
            await expectExited(pid)
            await expectExited(log[0].pid)
          } finally {
            try {
              process.kill(pid, "SIGKILL")
            } catch {
              /* Already terminated. */
            }
          }
        })
      },
      testTimeout,
    )
  }
  it(
    "terminates a backend when its ACP leader exits before cleanup",
    async () => {
      await fixture("descendant-exit", async (complete, receipt) => {
        await expect(complete(tool, state, {}, budget())).rejects.toThrow("Local argument agent")
        const log = await events(receipt)
        const pid = log.find((event) => event.backendPid)?.backendPid
        expect(pid).toBeNumber()
        await expectExited(pid)
        await expect(stat(log[0].cwd)).rejects.toThrow()
      })
    },
    testTimeout,
  )

  it.skipIf(process.platform !== "win32")(
    "runs an npm shim through Node inside the supervised job",
    async () => {
      await fixture("unused", async (_complete, receipt) => {
        const directory = dirname(receipt)
        const entry = join(directory, "adapter.cjs")
        await writeFile(entry, `#!/usr/bin/env node\n${await readFile(script, "utf8")}`)
        const shim = join(directory, "codex-acp.cmd")
        await writeFile(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\adapter.cjs" %*\r\n')
        const complete = createArgumentCompleter({
          agent: { command: shim, args: ["descendant-success", receipt, ...literalArgs] },
        })
        expect(await complete(tool, state, {}, budget())).toEqual({
          plane: "XZ",
          geometry: { width: 20 },
        })
        const log = await events(receipt)
        expect(log[0].args).toEqual(literalArgs)
        const backend = log.find((event) => event.backendPid)?.backendPid
        expect(backend).toBeNumber()
        await expectExited(log[0].pid)
        await expectExited(backend)
        await expect(stat(log[0].cwd)).rejects.toThrow()
      })
    },
    testTimeout,
  )

  it.skipIf(process.platform !== "win32")(
    "terminates the job when its host is killed",
    async () => {
      await fixture("unused", async (_complete, receipt) => {
        const hostFile = join(dirname(receipt), "host.ts")
        const modulePath = fileURLToPath(new URL("./arguments.ts", import.meta.url)).replaceAll(
          "\\",
          "/",
        )
        await writeFile(
          hostFile,
          `import { createArgumentCompleter } from ${JSON.stringify(modulePath)};\nvoid createArgumentCompleter({agent:${JSON.stringify({ command: process.execPath, args: [script, "descendant-cancel", receipt] })}})(${JSON.stringify(tool)},${JSON.stringify(state)},{},AbortSignal.timeout(60000)).catch(() => { process.exitCode = 1 });`,
        )
        const bundle = await Bun.build({
          entrypoints: [hostFile],
          target: "node",
          format: "cjs",
          packages: "bundle",
        })
        expect(bundle.success).toBe(true)
        const output = bundle.outputs[0]
        if (!output) throw new Error("Missing bundled argument host.")
        const bundleFile = join(dirname(receipt), "host.cjs")
        await Bun.write(bundleFile, output)
        const { nativeElectronExecutable } = await import("../../../tests/desktop/native-fixture")
        const host = Bun.spawn([nativeElectronExecutable, bundleFile], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stdout: "ignore",
          stderr: "ignore",
        })
        try {
          const log = await Promise.race([
            ready(receipt),
            host.exited.then(() => {
              throw new Error("Fixture host exited before readiness.")
            }),
          ])
          const backend = log.find((event) => event.backendPid)?.backendPid
          expect(backend).toBeNumber()
          host.kill("SIGKILL")
          await host.exited
          await expectExited(log[0].pid)
          await expectExited(backend)
        } finally {
          if (host.exitCode === null) host.kill("SIGKILL")
        }
      })
    },
    testTimeout,
  )
})
