import { spawn } from "node:child_process"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { verifyDistribution } from "../../scripts/local-distribution-files"

const repository = fileURLToPath(new URL("../../", import.meta.url))

function build(output: string) {
  return new Promise<{ code: number | null; diagnostic: string }>((resolve, reject) => {
    const child = spawn("bun", ["scripts/local-distribution-build.ts", output], {
      cwd: repository,
      stdio: ["ignore", "ignore", "pipe"],
    })
    let diagnostic = ""
    child.stderr.on("data", (chunk) => {
      diagnostic += String(chunk)
    })
    child.once("error", reject)
    child.once("exit", (code) => resolve({ code, diagnostic }))
  })
}

test("competing packagers preserve the exclusively owned complete output", async () => {
  test.skip(
    test.info().project.name !== "chromium",
    "This filesystem lifecycle is browser independent.",
  )
  const temporary = await mkdtemp(join(await realpath(tmpdir()), "vibeshape-package-race-"))
  const output = join(temporary, "nested", "new package")
  try {
    const results = await Promise.all([build(output), build(output)])
    expect(results.map(({ code }) => code).sort()).toEqual([0, 1])
    expect(results.find(({ code }) => code === 1)?.diagnostic).toMatch(
      /already exist|EEXIST|File exists/i,
    )
    expect(verifyDistribution(output).files.length).toBeGreaterThan(10)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
