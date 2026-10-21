import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { windowsAgentCommand } from "./windows-agent-command"

async function fixture(run: (prefix: string, runtime: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "npm argument λ-"))
  try {
    const prefix = join(root, "npm")
    const runtime = join(root, "node")
    await mkdir(prefix)
    await mkdir(runtime)
    await run(prefix, runtime)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function shim(prefix: string, command: string, header = "#!/usr/bin/env node") {
  const directory = join(prefix, "node_modules", command)
  await mkdir(directory, { recursive: true })
  const script = join(directory, "entry.js")
  await writeFile(script, `${header}\r\n`)
  await writeFile(
    join(prefix, `${command}.cmd`),
    `@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%" "%dp0%\\node_modules\\${command}\\entry.js" %*\r\n`,
  )
  return script
}

describe("Windows argument agent command resolution", () => {
  for (const command of ["codex-acp", "claude-agent-acp", "opencode"]) {
    it(`resolves the ${command} npm preset through Node without a shell`, async () => {
      await fixture(async (prefix, runtime) => {
        const script = await shim(prefix, command)
        const node = join(runtime, "node.exe")
        await writeFile(node, "runtime")
        const args = ["", "two words", 'quote"inside', "trailing\\", "$(exit 9); & |"]
        const selected = await windowsAgentCommand(
          { command, args },
          { PATH: `${prefix};${runtime}` },
          prefix,
        )
        expect(selected).toEqual({ command: node, args: [script, ...args] })
      })
    })
  }

  it("prefers the Node executable next to an explicit npm shim", async () => {
    await fixture(async (prefix, runtime) => {
      const script = await shim(prefix, "codex-acp")
      const node = join(prefix, "node.exe")
      await writeFile(node, "local runtime")
      await writeFile(join(runtime, "node.exe"), "PATH runtime")
      expect(
        await windowsAgentCommand(
          { command: join(prefix, "codex-acp.cmd"), args: ["acp"] },
          { PATH: runtime },
          runtime,
        ),
      ).toEqual({ command: node, args: [script, "acp"] })
    })
  })

  it("preserves PATH precedence and prefers a native executable in the same directory", async () => {
    await fixture(async (prefix, runtime) => {
      const script = await shim(prefix, "codex-acp")
      const executable = join(prefix, "codex-acp.exe")
      const node = join(runtime, "node.exe")
      await writeFile(executable, "native")
      await writeFile(join(runtime, "codex-acp.exe"), "later native")
      await writeFile(node, "runtime")
      expect(
        await windowsAgentCommand(
          { command: "codex-acp", args: ["literal"] },
          { PATH: `${prefix};${runtime}` },
          prefix,
        ),
      ).toEqual({ command: executable, args: ["literal"] })
      await rm(executable)
      expect(
        await windowsAgentCommand(
          { command: "codex-acp", args: [] },
          { PATH: `${prefix};${runtime}` },
          prefix,
        ),
      ).toEqual({ command: node, args: [script] })
    })
  })

  for (const [name, header] of [
    ["Python", "#!/usr/bin/env python"],
    ["Node options", "#!/usr/bin/env node --inspect"],
    ["truncated Node options", `#!/usr/bin/env node${" ".repeat(256)}--inspect`],
  ]) {
    it(`rejects an unsupported interpreter (${name})`, async () => {
      await fixture(async (prefix) => {
        await shim(prefix, "codex-acp", header)
        await expect(
          windowsAgentCommand({ command: "codex-acp", args: [] }, { PATH: prefix }, prefix),
        ).rejects.toThrow("Configure node.exe and its JavaScript entrypoint")
      })
    })
  }

  it("rejects a missing Node runtime and arbitrary batch wrappers", async () => {
    await fixture(async (prefix) => {
      await shim(prefix, "codex-acp")
      const agent = { command: "codex-acp", args: [] }
      await expect(windowsAgentCommand(agent, { PATH: prefix }, prefix)).rejects.toThrow(
        "npm launcher is unsupported",
      )
      await writeFile(join(prefix, "codex-acp.cmd"), "@echo This must never execute\r\n")
      await expect(windowsAgentCommand(agent, { PATH: prefix }, prefix)).rejects.toThrow(
        "npm launcher is unsupported",
      )
    })
  })
})
