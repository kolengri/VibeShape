import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const projects = process.argv.slice(2).map((project) => resolve(project))
if (!projects.length) {
  console.error("Expected at least one tsconfig path.")
  process.exit(1)
}

// Bun 1.4.3 lets a package's check script shadow its built-in checker.
const directory = await mkdtemp(join(tmpdir(), "vibeshape-bun-typecheck-"))
try {
  await writeFile(join(directory, "package.json"), '{"private":true}\n')
  for (const project of projects) {
    console.log(`Typecheck: ${project}`)
    const child = Bun.spawn([process.execPath, "check", "-p", project], {
      cwd: directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const result = await child.exited
    if (result) {
      process.exitCode = result
      break
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
