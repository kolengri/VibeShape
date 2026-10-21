import { afterEach, describe, expect, it } from "bun:test"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const runner = join(import.meta.dir, "run-typechecks.ts")
const directories: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibeshape-typecheck-cache-"))
  directories.push(root)
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value))
  const run = (command: string[], environment: Record<string, string> = {}) =>
    Bun.spawnSync(command, {
      cwd: root,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", ...environment },
    })
  const succeed = (command: string[]) => {
    const result = run(command)
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  json("package.json", {
    name: "@fixture/root",
    private: true,
    packageManager: `bun@${Bun.version}`,
    workspaces: { packages: ["packages/*"], catalog: {} },
    scripts: { "typecheck:scripts": "bun root-check.ts" },
  })
  json("turbo.json", {
    agentGuidance: false,
    globalDependencies: ["bun.lock", "tsconfig.json", "tests/unit/support/**"],
    globalEnv: ["VIBESHAPE_TYPECHECK_RUNTIME"],
    tasks: {
      typecheck: { outputs: ["*.tsbuildinfo"] },
      "//#typecheck:scripts": { outputs: ["*.tsbuildinfo"] },
    },
  })
  json("tsconfig.json", { compilerOptions: { strict: true } })
  write("tests/unit/support/runtime.ts", "export const runtime = 1\n")
  write(".gitignore", ".turbo\nnode_modules\n*.tsbuildinfo\n")
  write(
    "root-check.ts",
    `
import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync('.git/invocations', 'root\\n');
writeFileSync('tsconfig.tsbuildinfo', 'validated');
`,
  )
  const workspace = (name: string, dependencies: Record<string, unknown> = {}) => {
    json(`packages/${name}/package.json`, {
      name,
      ...dependencies,
      scripts: { typecheck: "bun check.ts" },
    })
    write(`packages/${name}/src/value.txt`, "valid")
    write(
      `packages/${name}/check.ts`,
      `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
appendFileSync('../../.git/invocations', '${name}\\n');
if (readFileSync('src/value.txt', 'utf8').trim() !== 'valid') process.exit(1);
writeFileSync('tsconfig.tsbuildinfo', 'validated');
`,
    )
  }
  workspace("app", {
    dependencies: { cycle: "workspace:*" },
    devDependencies: { development: "workspace:*" },
    peerDependencies: { peer: "workspace:*" },
    optionalDependencies: { optional: "workspace:*" },
  })
  workspace("cycle", { dependencies: { app: "workspace:*" } })
  for (const name of ["development", "peer", "optional", "unrelated"]) workspace(name)
  succeed([process.execPath, "--no-env-file", "install", "--lockfile-only", "--ignore-scripts"])
  succeed(["git", "init", "-q"])
  succeed(["git", "add", "."])
  // A staged snapshot is sufficient for Turbo's native tracked/dirty/untracked input hashing.
  write(".git/invocations", "")
  const check = (...args: string[]) => run([process.execPath, runner, ...args], { AI_AGENT: "1" })
  const calls = (name: string) =>
    readFileSync(join(root, ".git/invocations"), "utf8")
      .split("\n")
      .filter((line) => line === name).length
  const pass = (...args: string[]) => {
    const result = check(...args)
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
  return { root, write, check, calls, pass }
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("dependency-aware native Turbo typechecks", () => {
  it("preserves repository instructions and never creates agent guidance in an agent session", () => {
    const repo = fixture()
    const instructions = "# Fixture instructions\n\nPreserve this content exactly.\n"
    repo.write("AGENTS.md", instructions)
    repo.pass()
    expect(readFileSync(join(repo.root, "AGENTS.md"), "utf8")).toBe(instructions)
    expect(
      JSON.parse(readFileSync(join(repo.root, ".turbo/typechecks.json"), "utf8")),
    ).toMatchObject({
      agentGuidance: false,
    })
    rmSync(join(repo.root, "AGENTS.md"))
    repo.pass()
    expect(existsSync(join(repo.root, "AGENTS.md"))).toBe(false)
  }, 15_000)

  it("reuses successful results and invalidates consumers through peers, cycles and untracked source", () => {
    const repo = fixture()
    repo.pass()
    repo.pass()
    expect([
      repo.calls("app"),
      repo.calls("peer"),
      repo.calls("root"),
      repo.calls("unrelated"),
    ]).toEqual([1, 1, 1, 1])
    rmSync(join(repo.root, "packages/unrelated/tsconfig.tsbuildinfo"))
    repo.write("packages/peer/src/value.txt", "valid\n")
    repo.pass()
    expect([
      repo.calls("app"),
      repo.calls("cycle"),
      repo.calls("peer"),
      repo.calls("root"),
      repo.calls("unrelated"),
    ]).toEqual([2, 2, 2, 2, 1])
    expect(readFileSync(join(repo.root, "packages/unrelated/tsconfig.tsbuildinfo"), "utf8")).toBe(
      "validated",
    )
    repo.write("packages/cycle/src/new.ts", "export const value = 1\n")
    repo.pass()
    expect([
      repo.calls("app"),
      repo.calls("cycle"),
      repo.calls("peer"),
      repo.calls("root"),
      repo.calls("unrelated"),
    ]).toEqual([3, 3, 2, 3, 1])
    repo.write("packages/development/src/value.txt", "valid\n")
    repo.write("packages/optional/src/value.txt", "valid\n")
    repo.pass()
    expect([
      repo.calls("app"),
      repo.calls("cycle"),
      repo.calls("development"),
      repo.calls("optional"),
      repo.calls("unrelated"),
    ]).toEqual([4, 4, 2, 2, 1])
  }, 15_000)

  it("invalidates every result for root test support, lockfile and compiler configuration edits", () => {
    const repo = fixture()
    repo.pass()
    for (const [index, path] of [
      "tests/unit/support/runtime.ts",
      "bun.lock",
      "tsconfig.json",
    ].entries()) {
      if (path === "tsconfig.json")
        repo.write(path, '{"compilerOptions":{"strict":true,"noEmit":true}}')
      else appendFileSync(join(repo.root, path), "\n// changed cache input\n")
      repo.pass()
      expect([repo.calls("app"), repo.calls("root"), repo.calls("unrelated")]).toEqual([
        index + 2,
        index + 2,
        index + 2,
      ])
    }
  }, 15_000)

  it("never caches failed checks and leaves unrelated successful results reusable", () => {
    const repo = fixture()
    repo.pass()
    repo.write("packages/peer/src/value.txt", "broken")
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(repo.check("--continue=always").exitCode).not.toBe(0)
      expect(repo.calls("peer")).toBe(attempt + 2)
      expect(repo.calls("unrelated")).toBe(1)
    }
    repo.write("packages/peer/src/value.txt", "valid")
    repo.pass()
    expect(repo.calls("peer")).toBe(3)
  }, 15_000)

  it("forces execution through a write-only local cache and retains successful results", () => {
    const repo = fixture()
    repo.pass()
    repo.pass("--force")
    repo.pass()
    expect(repo.calls("app")).toBe(2)
    expect(repo.calls("unrelated")).toBe(2)
    expect(repo.calls("root")).toBe(2)
  }, 15_000)

  it("allows a validated concurrency override and rejects cache, environment and configuration bypasses", () => {
    const repo = fixture()
    repo.pass("--concurrency", "1", "--dry=json")
    repo.pass("--", "--cache=local:rw", "--env-mode=strict", "", "--concurrency=50%", "--dry=text")
    for (const option of [
      "--concurrency=0",
      "--parallel",
      "--cache=remote:rw",
      "--env-mode=loose",
      "--root-turbo-json=elsewhere.json",
    ]) {
      const result = repo.check(option)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toMatch(/Invalid value|Unsupported typecheck option/)
    }
    expect(repo.calls("app")).toBe(0)
  }, 15_000)
})
