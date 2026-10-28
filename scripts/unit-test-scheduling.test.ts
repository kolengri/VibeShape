import { expect, test } from "bun:test"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

test("structural file workers run alone without hiding failures or overwriting reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibeshape-unit-scheduling-"))
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  try {
    write("package.json", "{}")
    write("tests/unit/support/vite-imports.ts", "")
    write("scripts/unit-test-timings.json", '{"version":1,"files":{}}')
    for await (const file of new Bun.Glob("unit-test-*.ts").scan(import.meta.dir)) {
      if (!file.endsWith(".test.ts"))
        copyFileSync(join(import.meta.dir, file), join(root, "scripts", file))
    }
    for (const file of ["run-unit-tests.ts", "workspace-graph.ts"])
      copyFileSync(join(import.meta.dir, file), join(root, "scripts", file))
    mkdirSync(join(root, "node_modules"))
    for (const name of ["zod", "typescript"])
      symlinkSync(
        dirname(import.meta.resolve(`${name}/package.json`).replace("file://", "")),
        join(root, "node_modules", name),
      )
    const structural = "packages/structural-optimization/tests/"
    const files = [
      "packages/app/value.test.ts",
      `${structural}one.test.ts`,
      `${structural}two.test.ts`,
    ]
    write("packages/app/runtime.ts", "export const value = 1")
    write(`${structural}runtime.ts`, "export const value = 1")
    for (const [index, file] of files.entries())
      write(
        file,
        `import { test, expect } from "bun:test";
import { value } from "./runtime";
import { openSync, closeSync, unlinkSync, appendFileSync } from "node:fs";
test("exclusive runtime ${index}", async () => {
  const fd = openSync("active", "wx");
  try { await Bun.sleep(100); appendFileSync("calls", "${index}"); expect(value).toBe(1); }
  finally { closeSync(fd); unlinkSync("active"); }
});`,
      )
    const run = async (...options: string[]) => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(root, "scripts/run-unit-tests.ts"),
          "--parallel=6",
          "--reporter=junit",
          "--reporter-outfile=report.xml",
          ...options,
        ],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      )
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      return { code, stderr }
    }
    const success = await run("--coverage-reporter=lcov")
    expect(success.code, success.stderr).toBe(0)
    expect(readFileSync(join(root, "coverage/node/lcov.info"), "utf8")).toContain("app/runtime.ts")
    expect(readFileSync(join(root, "coverage/node-structural/lcov.info"), "utf8")).toContain(
      "structural-optimization/tests/runtime.ts",
    )
    expect(readFileSync(join(root, "calls"), "utf8").split("").sort()).toEqual(["0", "1", "2"])
    expect(readFileSync(join(root, "report.node.xml"), "utf8")).toContain("exclusive runtime 0")
    expect(readFileSync(join(root, "report.node-structural.xml"), "utf8")).toContain(
      "exclusive runtime 1",
    )
    write(
      files[0] ?? "",
      'import { test, expect } from "bun:test"; test("ordinary failure", () => expect(true).toBe(false))',
    )
    expect((await run()).code).not.toBe(0)
    write(files[0] ?? "", 'import { test } from "bun:test"; test("ordinary pass", () => {})')
    write(
      files[1] ?? "",
      'import { test, expect } from "bun:test"; test("structural failure", () => expect(true).toBe(false))',
    )
    expect((await run()).code).not.toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)
