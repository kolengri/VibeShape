import { expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")

it("publishes complete verified assets while parallel preparations and readers overlap", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibeshape-runtime-publication-"))
  const script = join(root, "scripts/prepare-structural-runtime.ts")
  const destination = join(root, ".artifacts/structural-runtime")
  const installed = join(root, "packages/structural-optimization/node_modules/pyodide")
  const previous = "previous incomplete asset"
  const runtime = Buffer.alloc(4 * 1024 * 1024, 90)
  const license = "Fixture runtime license."
  const accepted = new Set([digest(previous), digest(runtime)])
  const children: Bun.Subprocess<"ignore", "pipe", "pipe">[] = []
  try {
    for (const directory of [join(root, "scripts"), destination, installed])
      await mkdir(directory, { recursive: true })
    await symlink(resolve(import.meta.dir, "../node_modules"), join(root, "node_modules"))
    await copyFile(resolve(import.meta.dir, "prepare-structural-runtime.ts"), script)
    await writeFile(join(installed, "runtime.bin"), runtime)
    await writeFile(join(installed, "LICENSE.txt"), license)
    await writeFile(join(destination, "runtime.bin"), previous)
    const inputs = [
      { name: "runtime.bin", npm: true, sha256: digest(runtime) },
      { name: "LICENSE.txt", npm: true, sha256: digest(license) },
    ]
    await writeFile(
      join(root, "scripts/structural-runtime-inputs.ts"),
      `export const STRUCTURAL_RUNTIME_VERSION = "fixture"; export const STRUCTURAL_RUNTIME_FILES = ${JSON.stringify(inputs)} as const;`,
    )
    for (let index = 0; index < 4; index++)
      children.push(
        Bun.spawn([process.execPath, "run", script], {
          cwd: root,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      )
    let finished = false
    const completed = Promise.all(
      children.map(async (child) => {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        return { exitCode, stdout, stderr }
      }),
    ).finally(() => {
      finished = true
    })
    while (!finished) {
      expect(accepted.has(digest(await readFile(join(destination, "runtime.bin"))))).toBe(true)
      await Bun.sleep(1)
    }
    for (const result of await completed)
      expect(result.exitCode, result.stdout + result.stderr).toBe(0)
    expect(digest(await readFile(join(destination, "runtime.bin")))).toBe(digest(runtime))
    expect(await readFile(join(destination, "LICENSE.txt"), "utf8")).toBe(license)
    expect(JSON.parse(await readFile(join(destination, "provenance.json"), "utf8"))).toMatchObject({
      runtimeVersion: "fixture",
      inputs,
    })
  } finally {
    await Promise.all(children.map((child) => child.exited))
    await rm(root, { recursive: true, force: true })
  }
})
