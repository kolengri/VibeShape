import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createArgumentCompleter } from "./arguments"

const script = fileURLToPath(
  new URL("../../../tests/desktop/fixtures/argument-agent.cjs", import.meta.url),
)
const tool = { name: "create_sketch", inputSchema: { type: "object" as const } }
const state = { goal: "A 20 mm square", instructions: "Use XY", history: [], photos: [] }

async function fixture(
  mode: string,
  run: (complete: ReturnType<typeof createArgumentCompleter>, receipt: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "argument-test-"))
  const receipt = join(directory, "receipt.jsonl")
  try {
    await run(
      createArgumentCompleter({
        agent: { command: process.execPath, args: [script, mode, receipt] },
      }),
      receipt,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function events(receipt: string) {
  return (await readFile(receipt, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}

describe("local ACP argument helper", () => {
  it("uses a fresh isolated session, streams JSON, preserves selected values and cleans up", async () => {
    await fixture("success", async (complete, receipt) => {
      const before = process.env.TYPESAFE_API_KEY
      process.env.TYPESAFE_API_KEY = "must-not-reach-helper"
      try {
        expect(await complete(tool, state, { plane: "XY" }, AbortSignal.timeout(5000))).toEqual({
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
      expect(log.find((e) => e.method === "initialize").params.clientCapabilities).toEqual({})
      expect(log.find((e) => e.method === "session/new").params.mcpServers).toEqual([])
      expect(log.find((e) => e.method === "session/prompt").params.prompt[0].text).toContain(
        '"selectedArguments":{"plane":"XY"}',
      )
      await expect(stat(log[0].cwd)).rejects.toThrow()
      expect(() => process.kill(log[0].pid, 0)).toThrow()
    })
  })
  it("denies permission requests without granting tool authority", async () => {
    await fixture("permission", async (complete, receipt) => {
      await complete(tool, state, {}, AbortSignal.timeout(5000))
      expect((await events(receipt)).find((e) => e.id === "permission").result).toEqual({
        outcome: { outcome: "cancelled" },
      })
    })
  })
  for (const [mode, error] of [
    ["large", "256 KiB"],
    ["invalid", "invalid argument JSON"],
    ["cancelled", "did not complete"],
  ] as const) {
    it(`rejects ${mode} output without returning arguments`, async () => {
      await fixture(mode, async (complete) => {
        await expect(complete(tool, state, {}, AbortSignal.timeout(5000))).rejects.toThrow(error)
      })
    })
  }
  it("cancels a hung agent and kills its process even when SIGTERM is ignored", async () => {
    await fixture("hang", async (complete, receipt) => {
      await expect(complete(tool, state, {}, AbortSignal.timeout(300))).rejects.toThrow("cancelled")
      const log = await events(receipt)
      expect(() => process.kill(log[0].pid, 0)).toThrow()
      await expect(stat(log[0].cwd)).rejects.toThrow()
    })
  })
  it("reports missing executables without exposing command text", async () => {
    const complete = createArgumentCompleter({
      agent: { command: "/missing/private-agent", args: [] },
    })
    await expect(complete(tool, state, {}, AbortSignal.timeout(5000))).rejects.toThrow(
      "could not start",
    )
  })
  for (const mode of ["descendant-success", "descendant-cancel"]) {
    it.skipIf(process.platform === "win32")(
      `kills backend descendants after leader closure (${mode})`,
      async () => {
        await fixture(mode, async (complete, receipt) => {
          const pending = complete(tool, state, {}, AbortSignal.timeout(500))
          if (mode === "descendant-cancel") await expect(pending).rejects.toThrow("cancelled")
          else await pending
          const log = await events(receipt)
          const pid = log.find((event) => event.backendPid)?.backendPid
          expect(pid).toBeNumber()
          try {
            // SIGKILL delivery precedes process-table removal on some hosts.
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
            expect(() => process.kill(log[0].pid, 0)).toThrow()
          } finally {
            try {
              process.kill(pid, "SIGKILL")
            } catch {
              /* Already terminated. */
            }
          }
        })
      },
    )
  }
})
