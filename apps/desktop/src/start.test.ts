import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

test("the desktop launcher forwards profile flags and removes Electron's Node-mode override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-start-"))
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ main: "index.ts" }))
    await writeFile(
      join(directory, "index.ts"),
      "console.log(JSON.stringify({args:process.argv.slice(2),nodeMode:process.env.ELECTRON_RUN_AS_NODE??null}))",
    )
    const preload = join(directory, "electron-fixture.ts")
    const electronEntry = createRequire(resolve(import.meta.dirname, "../package.json")).resolve(
      "electron",
    )
    await writeFile(
      preload,
      `import {mock} from "bun:test"; mock.module(${JSON.stringify(electronEntry)},()=>({default:process.execPath}))`,
    )
    const flags = [`--user-data-dir=${join(directory, "profile with spaces")}`, "--disable-gpu"]
    const result = spawnSync(
      process.execPath,
      ["--preload", preload, resolve(import.meta.dirname, "../start.ts"), ...flags],
      {
        cwd: directory,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
        timeout: 10_000,
      },
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ args: flags, nodeMode: null })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
