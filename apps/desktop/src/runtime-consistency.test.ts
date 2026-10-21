import { afterEach, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { distributionHash } from "../../../scripts/local-distribution-files"
import { verifyRuntimeFiles } from "../runtime-consistency"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
it("verifies every native runtime bundle and refuses a changed preload, MCP or Jev entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibeshape-runtime-consistency-"))
  directories.push(directory)
  const runtime: Record<string, string> = {}
  for (const name of ["main.cjs", "preload.cjs", "mcp.cjs", "jev.cjs"]) {
    await writeFile(join(directory, name), name)
    runtime[name] = distributionHash(Buffer.from(name))
  }
  await verifyRuntimeFiles(directory, runtime)
  for (const name of ["preload.cjs", "mcp.cjs", "jev.cjs"]) {
    await writeFile(join(directory, name), "changed")
    await expect(verifyRuntimeFiles(directory, runtime)).rejects.toThrow(name)
    await writeFile(join(directory, name), name)
  }
  for (const name of ["mcp.cjs", "jev.cjs"]) {
    await rm(join(directory, name))
    await expect(verifyRuntimeFiles(directory, runtime)).rejects.toThrow()
    await writeFile(join(directory, name), name)
  }
})
