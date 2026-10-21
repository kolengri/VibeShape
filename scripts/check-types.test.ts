import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const runner = join(import.meta.dir, "check-types.ts")
const base = join(import.meta.dir, "../packages/typescript-config/base.json")
const directories: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibeshape checker fixture "))
  directories.push(root)
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value))
  json("package.json", { private: true, scripts: { check: "bun collision.ts" } })
  write("collision.ts", 'await Bun.write("wrong-checker", "executed"); process.exit(97)\n')
  const project = (name: string, lib: string[]) => {
    json(`${name}/tsconfig.json`, {
      extends: base,
      compilerOptions: { lib, types: [] },
      include: ["*.ts"],
    })
    return `${name}/tsconfig.json`
  }
  const check = (...projects: string[]) =>
    Bun.spawnSync([process.execPath, runner, ...projects], { cwd: root })
  return { root, write, project, check }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Bun project typechecks", () => {
  it("checks every project with its own ambient types despite a package check script and spaces", () => {
    const repo = fixture()
    const browser = repo.project("browser", ["ES2022", "DOM"])
    const worker = repo.project("worker", ["ES2022", "WebWorker"])
    repo.write("browser/value.ts", 'document.title = "Checked"\n')
    repo.write("worker/value.ts", 'self.postMessage("Checked")\n')
    const result = repo.check(browser, worker)
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(existsSync(join(repo.root, "wrong-checker"))).toBe(false)
    expect(existsSync(join(repo.root, "browser/tsconfig.tsbuildinfo"))).toBe(false)
    expect(existsSync(join(repo.root, "worker/tsconfig.tsbuildinfo"))).toBe(false)

    repo.write("worker/value.ts", 'document.title = "Wrong environment"\n')
    const invalid = repo.check(browser, worker)
    expect(invalid.exitCode).not.toBe(0)
    expect(`${invalid.stdout}${invalid.stderr}`).toContain("Cannot find name 'document'")
  })

  it("preserves strict optional and indexed-access errors and stops before later projects", () => {
    const repo = fixture()
    const strict = repo.project("strict", ["ES2022"])
    const later = repo.project("later", ["ES2022"])
    repo.write(
      "strict/value.ts",
      [
        "const label: string = 123",
        "const first: number = ([] as number[])[0]",
        "const option: { value?: number } = { value: undefined }",
      ].join("\n"),
    )
    repo.write("later/value.ts", "export const value = 1\n")
    const result = repo.check(strict, later)
    const diagnostics = `${result.stdout}${result.stderr}`
    expect(result.exitCode).not.toBe(0)
    expect(diagnostics).toContain("Type 'number' is not assignable to type 'string'")
    expect(diagnostics).toContain("Type 'number | undefined' is not assignable to type 'number'")
    expect(diagnostics).toContain("exactOptionalPropertyTypes")
    expect(result.stdout.toString()).not.toContain(join(repo.root, later))
  })

  it("rejects omitted and missing projects instead of checking an empty default project", () => {
    const repo = fixture()
    expect(repo.check().exitCode).not.toBe(0)
    const result = repo.check("missing/tsconfig.json")
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain("missing/tsconfig.json")
    expect(existsSync(join(repo.root, "wrong-checker"))).toBe(false)
  })
})
