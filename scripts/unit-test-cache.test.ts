import { afterEach, describe, expect, it } from "bun:test"
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
import { UnitTestCache } from "./unit-test-cache"
import { unitTestEnvironment } from "./unit-test-environment"
import { digest } from "./unit-test-files"
import { unitTestInputs } from "./unit-test-inputs"
import { unitTestOptions } from "./unit-test-options"
import { unitTestParser } from "./unit-test-parser"
import { sourceAnalysis } from "./unit-test-source"

const temporary: string[] = []
function scopeHash(snapshot: Awaited<ReturnType<typeof unitTestInputs>>, name: string) {
  const scope = snapshot.scopes.get(name)
  if (!scope) throw new Error(`Missing fixture scope: ${name}`)
  return scope.hash
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vibeshape-unit-cache-"))
  temporary.push(root)
  const entries = new Map<string, Set<string>>()
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), value)
    const source = /^(packages\/[^/]+\/src)\/([^/]+)\.ts$/.exec(path)
    if (source && !path.endsWith(".test.ts")) {
      const directory = source[1] ?? ""
      const imports = entries.get(directory) ?? new Set<string>()
      imports.add(`./${source[2]}`)
      entries.set(directory, imports)
      writeFileSync(
        join(root, directory, "inputs.test.ts"),
        [...imports].map((specifier) => `import ${JSON.stringify(specifier)}`).join("\n"),
      )
    }
  }
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value))
  json("package.json", { name: "fixture-root", workspaces: ["packages/*"] })
  write("bun.lock", "fixture lock")
  write("tsconfig.json", "{}")
  write("tests/unit/support/vite-imports.ts", "")
  write("tests/unit/support/dom.ts", "globalThis.__fixtureDOM = true")
  write(".git/invocations", "")
  const workspace = (name: string, fields: Record<string, unknown> = {}) => {
    json(`packages/${name}/package.json`, { name, ...fields })
    write(`packages/${name}/src/value.ts`, "export const value = 1")
  }
  workspace("app", {
    dependencies: { cycle: "workspace:*" },
    devDependencies: { development: "workspace:*" },
    peerDependencies: { peer: "workspace:*" },
    optionalDependencies: { optional: "workspace:*" },
  })
  workspace("cycle", { dependencies: { app: "workspace:*" } })
  for (const name of ["development", "peer", "optional", "relative", "unrelated"]) workspace(name)
  write("packages/app/src/relative.ts", 'export { value } from "../../relative/src/value"')
  const snapshot = (
    environment: NodeJS.ProcessEnv = { CI: "true", TZ: "UTC" },
    runtime = "bun:linux:arm64",
  ) => unitTestInputs(root, ["--parallel=2", "--timeout=15000"], environment, runtime)
  return { root, write, snapshot }
}
function runtimeFixture() {
  const repo = fixture()
  repo.write("packages/geometry-worker/package.json", JSON.stringify({ name: "geometry" }))
  repo.write(
    "packages/structural-optimization/package.json",
    JSON.stringify({ name: "structural" }),
  )
  repo.write(
    "packages/web/package.json",
    JSON.stringify({
      name: "web",
      dependencies: { geometry: "workspace:*", structural: "workspace:*" },
    }),
  )
  repo.write("packages/web/src/ui.ts", "export const theme = 'original'")
  const paths = [
    "packages/geometry-worker/src/occt-primitives-kernel.test.ts",
    "packages/structural-optimization/src/worker.ts",
    "packages/structural-optimization/src/quick-worker.ts",
    "packages/structural-optimization/tests/wasm-large-elasticity.test.ts",
  ]
  for (const path of paths)
    repo.write(path, readFileSync(join(import.meta.dir, "..", path), "utf8"))
  for (const [directory, files] of [
    ["geometry-worker", ["memory-profile", "occt-shapes"]],
    [
      "structural-optimization",
      [
        "contract",
        "quick-contract",
        "quick-errors",
        "quick-generation",
        "quick-isosurface",
        "quick-preparation",
        "quick-sampling",
        "runtime-diagnostics",
      ],
    ],
  ] as const)
    for (const file of files) repo.write(`packages/${directory}/src/${file}.ts`, "export {}")
  const producers = [
    "scripts/prepare-structural-runtime.ts",
    "scripts/structural-runtime-inputs.ts",
    "packages/structural-optimization/src/solver.py",
    "packages/structural-optimization/src/quick-solver.py",
    "packages/structural-optimization/tests/surface_target_fixtures.py",
    "packages/structural-optimization/tests/obstacle_fixtures.py",
    "packages/structural-optimization/tests/fdm_fixtures.py",
    "packages/structural-optimization/tests/implicit_fixtures.py",
    "packages/structural-optimization/tests/resource_fixtures.py",
    "packages/structural-optimization/tests/iterative_fixtures.py",
    "packages/structural-optimization/tests/compound_relative_fixtures.py",
    "packages/structural-optimization/tests/boundary_reference_fixtures.py",
  ]
  for (const path of producers)
    repo.write(path, readFileSync(join(import.meta.dir, "..", path), "utf8"))
  for (const name of ["zod", "replicad", "replicad-opencascadejs"]) {
    mkdirSync(join(repo.root, "node_modules"), { recursive: true })
    symlinkSync(
      dirname(import.meta.resolve(`${name}/package.json`).replace("file://", "")),
      join(repo.root, "node_modules", name),
    )
  }
  symlinkSync(
    join(import.meta.dir, "../packages/structural-optimization/node_modules/pyodide"),
    join(repo.root, "node_modules/pyodide"),
  )
  return {
    ...repo,
    paths: [...paths, ...producers],
    snapshot: () => repo.snapshot({ CI: "true", TZ: "UTC", PATH: process.env.PATH }),
  }
}

describe("native unit-test result inputs", () => {
  it("invalidates documentation consumers without invalidating unrelated workspaces or hashing output logs", async () => {
    const repo = fixture()
    repo.write("docs/fixture.md", "original")
    repo.write("README.md", "original overview")
    repo.write(
      "packages/app/src/documentation.ts",
      'import {readFileSync} from "node:fs"; export const content = readFileSync("docs/fixture.md", "utf8")',
    )
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(true)
    repo.write("docs/fixture.md", "changed")
    repo.write("artifacts/pipeline-optimization/check.log", "changing output")
    const after = await repo.snapshot()
    expect(scopeHash(after, "app")).not.toBe(scopeHash(before, "app"))
    expect(scopeHash(after, "unrelated")).toBe(scopeHash(before, "unrelated"))
    repo.write("docs/unread.md", "unrelated documentation")
    repo.write("README.md", "updated overview")
    repo.write("artifacts/pipeline-optimization/check.log", "more changing output")
    const outputsChanged = await repo.snapshot()
    expect(scopeHash(outputsChanged, "app")).toBe(scopeHash(after, "app"))
    expect(scopeHash(outputsChanged, "unrelated")).toBe(scopeHash(after, "unrelated"))
    repo.write(
      "packages/app/src/documentation.ts",
      'import {readFileSync} from "node:fs"; export const content = readFileSync("artifacts/pipeline-optimization/check.log", "utf8")',
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("ignores erased worker and loader annotations while retaining executable class heritage", async () => {
    const repo = fixture()
    repo.write(
      "packages/app/src/worker-types.ts",
      "export let worker: Worker; export type Loader = typeof fetch; export interface Context extends Worker { load: typeof fetch }; export const value = 1",
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/app/src/worker-types.ts", "export class ExternalWorker extends Worker {}")
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("reuses only the reviewed bundled chamfer loader and refuses external OCCT overrides or edits", async () => {
    const root = join(import.meta.dir, "..")
    const path = "packages/geometry-worker/src/occt-chamfer-v3-kernel.test.ts"
    const source = readFileSync(join(root, path), "utf8")
    const input = { path, source, hash: digest(source) }
    const parser = await unitTestParser(root, [input])
    try {
      const parsed = await parser.parse(input)
      expect(sourceAnalysis(root, input, parsed, new Map(), {}).unsafe).toBe(false)
      expect(
        sourceAnalysis(root, input, parsed, new Map(), {
          VIBESHAPE_CHAMFER_OCCT_DIRECTORY: "/external",
        }).unsafe,
      ).toBe(true)
      expect(
        sourceAnalysis(
          root,
          { ...input, hash: digest(`${source}\n// changed loader`) },
          parsed,
          new Map(),
          {},
        ).unsafe,
      ).toBe(true)
    } finally {
      await parser.close()
    }
  })
  it.each([
    'import {execFileSync} from "node:child_process"; export const value=execFileSync("cat",["/tmp/external.wasm"],{encoding:"utf8"})',
    'import cp from "child_process"; const {execFileSync:read}=cp; export const value=read("cat",["/tmp/external.wasm"])',
    'const cp=require("node:child_process"); export const value=cp.execFileSync("cat",["/tmp/external.wasm"])',
    'export const value=require("node:child_process").execFileSync("cat",["/tmp/external.wasm"])',
    'export const value=Bun.spawnSync(["cat","/tmp/external.wasm"]).stdout',
    'import {spawnSync as read} from "bun"; export const value=read(["cat","/tmp/external.wasm"])',
    'const read=Bun.spawnSync; export const value=read(["cat","/tmp/external.wasm"])',
    'export const value=await (await fetch("https://example.test/fixture.json")).json()',
    'const read=fetch; export const value=await read("https://example.test/fixture.json")',
    'export const value=await globalThis["fetch"]("https://example.test/fixture.json")',
    'const {fetch:read}=globalThis; export const value=await read("https://example.test/fixture.json")',
    'import https from "node:https"; export const value=https.get("https://example.test/fixture.json",()=>{})',
    'import {get as read} from "node:https"; export const value=read("https://example.test/fixture.json",()=>{})',
    'export const value=eval(\'require("node:fs").readFileSync("/tmp/external.wasm","utf8")\')',
    'export const value=new Function(\'return require("node:fs").readFileSync("/tmp/external.wasm","utf8")\')()',
    "export const value=await runtime.runPythonAsync('open(\"/tmp/external.wasm\").read()')",
    "const read=runtime.runPythonAsync; export const value=await read('open(\"/tmp/external.wasm\").read()')",
    'import {loadPyodide as read} from "pyodide"; export const value=await read({indexURL:"https://example.test"})',
    'import {readlinkSync} from "node:fs"; export const value=readlinkSync("/tmp/external-link")',
    'import fs from "node:fs"; export const value=fs.opendirSync("/tmp/external-directory")',
    'import {globSync as read} from "node:fs"; export const value=read("/tmp/*")',
    'export const value=globalThis.eval(\'require("node:fs").readFileSync("/tmp/input")\')',
    'export const value=new globalThis.Function(\'return require("node:fs").readFileSync("/tmp/input")\')()',
    'export const value=globalThis[process.env.READER!]("/tmp/input")',
    'export const value=Bun[process.env.READER!]("/tmp/input")',
    "export const value=new Worker(process.env.WORKER_SCRIPT!)",
    "export const value=new SharedWorker(process.env.WORKER_SCRIPT!)",
    'import {Worker} from "node:worker_threads"; export const value=new Worker(process.env.WORKER_SCRIPT!)',
    'export const value=new WebSocket("wss://example.test/fixture")',
    'export const value=new EventSource("https://example.test/fixture")',
    'import vm from "node:vm"; export const value=vm.runInNewContext(\'require("node:fs").readFileSync("/tmp/input")\')',
    "export const value=module.require(process.env.MODULE_PATH!)",
    'import Module from "node:module"; export const value=Module[process.env.LOADER!]("/tmp/input")',
    'export const value=process.getBuiltinModule("fs").readFileSync("/tmp/input")',
    'export const value=await globalThis.Bun.file("/tmp/external.wasm").text()',
    'export const value=globalThis.Bun.spawnSync(["cat","/tmp/external.wasm"]).stdout',
    'const runtime=globalThis.Bun; export const value=runtime.file("/tmp/external.wasm")',
    'const {default:Job}=await import("./value?worker");export const worker=new Job({preload:["/tmp/external.js"]})',
    'const Job=require("./value?worker").default;export const worker=new Job({preload:["/tmp/external.js"]})',
    'import * as jobs from "./value?worker";export const worker=new jobs.default()',
    'export {default as Job} from "./value?worker"',
    'import {$ as shell} from "bun"; export const value=await shell`cat /tmp/external.wasm`',
    "export const value=await Bun.$`cat /tmp/external.wasm`",
    'import dgram from "node:dgram"; export const value=dgram.createSocket("udp4")',
    'export const value=new Worker("./background.mts")',
    'import * as b from "bun";const a=b;export const value=await a.file("/tmp/input").text()',
    'import * as b from "bun";const {spawnSync:run}=b;export const value=run(["cat","/tmp/input"])',
    'import {Database} from "bun:sqlite";const database=new Database("/tmp/existing.db",{readonly:true});export const value=database.query("select value from fixture").get()',
    'export const database=await import("bun:sqlite")',
    'export const database=require("node:sqlite")',
    'import {networkInterfaces} from "node:os";export const interfaces=networkInterfaces()',
    'import {openAsBlob} from "node:fs";export const value=await openAsBlob("/tmp/input")',
    'export const value=Bun.plugin({name:"unknown",setup(){}})',
    'export const value=Bun["plugin"]({name:"unknown",setup(){}})',
    'import Module from "node:module";const alias=Module;export const value=alias.register("/tmp/external.js")',
  ])("does not issue receipts for external execution or I/O: %s", async (source) => {
    const repo = fixture()
    repo.write("packages/app/src/external.ts", source)
    const snapshot = await repo.snapshot()
    expect(snapshot.scopes.get("app")?.cacheable).toBe(false)
    expect(
      new UnitTestCache(repo.root).receipt(snapshot, "app", "node", [
        "./packages/app/src/inputs.test.ts",
      ]),
    ).toBeUndefined()
  })
  it("follows finite repository worker URLs and their transitive imports", async () => {
    const repo = fixture()
    repo.write(
      "packages/app/src/thread.ts",
      'export const worker=new Worker(new URL("./background.mts",import.meta.url))',
    )
    repo.write("packages/app/src/background.mts", 'export {value} from "../../relative/src/value"')
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/relative/src/value.ts", "export const value = 2")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    repo.write(
      "packages/app/src/background.mts",
      'export const value=await fetch("https://example.test/fixture")',
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it.each([
    '{type:"module",preload:["/tmp/external.js"]}',
    '{...options,type:"module"}',
    "options",
    '{type:"module",[process.env.WORKER_OPTION!]:"/tmp/external.js"}',
    '{get type(){return "module"}}',
  ])("refuses unhashed native Worker option inputs: %s", async (options) => {
    const repo = fixture()
    repo.write("packages/app/src/background.mts", "export const value=1")
    repo.write(
      "packages/app/src/thread.ts",
      `export const worker=new Worker(new URL("./background.mts",import.meta.url),${options})`,
    )
    const snapshot = await repo.snapshot()
    expect(snapshot.scopes.get("app")?.cacheable).toBe(false)
    expect(
      new UnitTestCache(repo.root).receipt(snapshot, "app", "node", [
        "./packages/app/src/inputs.test.ts",
      ]),
    ).toBeUndefined()
  })
  it("keeps actual Vite factory imports in closure and refuses forwarded preload, options and aliases", async () => {
    const repo = fixture()
    repo.write(
      "tests/unit/support/vite-imports.ts",
      readFileSync(join(import.meta.dir, "../tests/unit/support/vite-imports.ts"), "utf8"),
    )
    const source =
      'import Job from "../../relative/src/value?worker"; export const worker=new Job()'
    repo.write("packages/app/src/thread.ts", source)
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/relative/src/value.ts", "export const value=2")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    for (const replacement of [
      'new Job({preload:["/tmp/external.js"]})',
      "new Job({...options})",
      "new Job(options)",
      'Job({preload:["/tmp/external.js"]})',
      '(() => {const Alias=Job;return new Alias({preload:["/tmp/external.js"]})})()',
    ]) {
      repo.write("packages/app/src/thread.ts", source.replace("new Job()", replacement))
      expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
    }
  })
  it("limits inspected reflection and lazy Vite factory exceptions to their exact producer bytes", async () => {
    const root = join(import.meta.dir, "..")
    const paths = [
      "tests/unit/support/dom.ts",
      "tests/unit/support/bun-test.ts",
      "tests/unit/support/vite-imports.ts",
      "packages/formats/src/vshape.ts",
      "packages/formats/src/vshape.test.ts",
      "packages/formats/src/text-outline/font.ts",
    ]
    const inputs = paths.map((path) => {
      const source = readFileSync(join(root, path), "utf8")
      return { path, source, hash: digest(source) }
    })
    const parser = await unitTestParser(root, inputs)
    try {
      for (const input of inputs) {
        const parsed = await parser.parse(input)
        expect(sourceAnalysis(root, input, parsed).unsafe).toBe(false)
        expect(
          sourceAnalysis(root, { ...input, hash: digest(`${input.source}\n// changed`) }, parsed)
            .unsafe,
        ).toBe(true)
      }
    } finally {
      await parser.close()
    }
  })
  it("couples finite runtime calls to their exact caller, preparation and Python producers and executable", async () => {
    const root = join(import.meta.dir, "..")
    const callers = [
      "packages/geometry-worker/src/engine.ts",
      "packages/structural-optimization/tests/quick-wasm.test.ts",
      "packages/structural-optimization/tests/quick-wasm-curved.test.ts",
      "packages/structural-optimization/tests/quick-wasm-sampling.test.ts",
      "packages/structural-optimization/tests/quick-bvh-sampling.test.ts",
      "packages/structural-optimization/tests/quick-wasm-helpers.ts",
      "packages/structural-optimization/tests/wasm-solver.test.ts",
      "packages/structural-optimization/tests/wasm-large-elasticity.test.ts",
    ]
    const paths = [
      ...callers,
      "scripts/prepare-structural-runtime.ts",
      "scripts/structural-runtime-inputs.ts",
      "packages/structural-optimization/src/solver.py",
      "packages/structural-optimization/src/quick-solver.py",
      "packages/structural-optimization/tests/surface_target_fixtures.py",
      "packages/structural-optimization/tests/obstacle_fixtures.py",
      "packages/structural-optimization/tests/fdm_fixtures.py",
      "packages/structural-optimization/tests/implicit_fixtures.py",
      "packages/structural-optimization/tests/resource_fixtures.py",
      "packages/structural-optimization/tests/iterative_fixtures.py",
      "packages/structural-optimization/tests/compound_relative_fixtures.py",
      "packages/structural-optimization/tests/boundary_reference_fixtures.py",
    ]
    const inputs = paths.map((path) => {
      const contents = readFileSync(join(root, path), "utf8")
      return { path, hash: digest(contents), ...(path.endsWith(".ts") ? { source: contents } : {}) }
    })
    const hashes = new Map(inputs.map((input) => [input.path, input.hash]))
    const parser = await unitTestParser(root, inputs)
    try {
      for (const input of inputs.slice(0, callers.length)) {
        const parsed = await parser.parse(input)
        expect(sourceAnalysis(root, input, parsed, hashes, process.env).unsafe).toBe(false)
        expect(
          sourceAnalysis(
            root,
            { ...input, hash: digest(`${input.source}\n// changed`) },
            parsed,
            hashes,
            process.env,
          ).unsafe,
        ).toBe(true)
        if (input.path.includes("structural-optimization")) {
          if (
            input.path.endsWith("quick-wasm-helpers.ts") ||
            input.path.endsWith("wasm-solver.test.ts")
          )
            expect(
              sourceAnalysis(root, input, parsed, hashes, { PATH: "/missing-bun-runtime" }).unsafe,
            ).toBe(true)
          for (const producer of inputs.slice(callers.length)) {
            const changed = new Map(hashes).set(
              producer.path,
              digest("changed external input boundary"),
            )
            expect(sourceAnalysis(root, input, parsed, changed, process.env).unsafe).toBe(true)
          }
        }
      }
    } finally {
      await parser.close()
    }
  })
  it("couples the geometry import reader to both its exact bytes and the reviewed WASM-fetch producer", async () => {
    const root = join(import.meta.dir, "..")
    const inputs = [
      "packages/geometry-worker/src/engine.ts",
      "packages/geometry-worker/src/engine-import-kernel.test.ts",
    ].map((path) => {
      const source = readFileSync(join(root, path), "utf8")
      return { path, source, hash: digest(source) }
    })
    const [engine, reader] = inputs
    if (!engine || !reader) throw new Error("Missing geometry cache producers.")
    const hashes = new Map(inputs.map((input) => [input.path, input.hash]))
    const parser = await unitTestParser(root, inputs)
    try {
      const parsed = await parser.parse(reader)
      expect(sourceAnalysis(root, reader, parsed, hashes).unsafe).toBe(false)
      expect(sourceAnalysis(root, reader, parsed, new Map()).unsafe).toBe(true)
      expect(
        sourceAnalysis(
          root,
          reader,
          parsed,
          new Map(hashes).set(engine.path, digest(`${engine.source}\n// changed producer`)),
        ).unsafe,
      ).toBe(true)
      expect(
        sourceAnalysis(
          root,
          { ...reader, hash: digest(`${reader.source}\n// changed reader`) },
          parsed,
          hashes,
        ).unsafe,
      ).toBe(true)
    } finally {
      await parser.close()
    }
  })
  it("parses the actual Vite preload without treating import.meta.url as a mutable local URL reference", async () => {
    const repo = fixture()
    repo.write(
      "tests/unit/support/vite-imports.ts",
      readFileSync(join(import.meta.dir, "../tests/unit/support/vite-imports.ts"), "utf8"),
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(true)
  })
  it.each(["test-results", "coverage", "dist", "artifacts"])(
    "runs selected tests in an excluded %s tree without receipts",
    async (directory) => {
      const repo = fixture()
      repo.write(
        `packages/app/${directory}/generated.test.ts`,
        'import {test} from "bun:test"; test("generated",()=>{})',
      )
      const before = await repo.snapshot()
      expect(before.scopes.get("app")?.cacheable).toBe(false)
      expect(
        new UnitTestCache(repo.root).receipt(before, "app", "node", [
          `./packages/app/${directory}/generated.test.ts`,
        ]),
      ).toBeUndefined()
      repo.write(
        `packages/app/${directory}/generated.test.ts`,
        'import {test} from "bun:test"; test("generated",()=>{throw new Error("changed")})',
      )
      expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
    },
  )
  it.each(["shared test module", "native preload"])(
    "tracks workspace dependencies reached through a %s",
    async (entry) => {
      const repo = fixture()
      repo.write("tests/shared.ts", 'export { value } from "../packages/relative/src/value"')
      if (entry === "native preload")
        repo.write("tests/unit/support/vite-imports.ts", 'import "../../shared"')
      else repo.write("packages/app/src/shared.ts", 'export { value } from "../../../tests/shared"')
      // Unused global scripts are hashed inputs, but are not executed dependency boundaries.
      repo.write(
        "scripts/unused.ts",
        'import { readFileSync } from "node:fs"; readFileSync(process.env.EXTERNAL_PATH!)',
      )
      const before = await repo.snapshot()
      expect(before.scopes.get("app")?.cacheable).toBe(true)
      const cache = new UnitTestCache(repo.root)
      const receipt = cache.receipt(before, "app", "node", ["./packages/app/src/inputs.test.ts"])
      if (!receipt) throw new Error("Expected a cacheable shared-module fixture.")
      await cache.save(receipt, 0)
      repo.write("packages/relative/src/value.ts", "export const value = 2")
      const after = await repo.snapshot()
      expect(scopeHash(after, "app")).not.toBe(scopeHash(before, "app"))
      const updated = cache.receipt(after, "app", "node", receipt.files)
      if (!updated) throw new Error("Expected a cacheable changed shared-module fixture.")
      expect(await cache.has(updated)).toBe(false)
      if (entry === "native preload")
        expect(scopeHash(after, "unrelated")).not.toBe(scopeHash(before, "unrelated"))
      else expect(scopeHash(after, "unrelated")).toBe(scopeHash(before, "unrelated"))
    },
  )
  it.each([
    'import { readFileSync } from "node:fs"; export const value = readFileSync(process.env.EXTERNAL_PATH!)',
    'import { readFileSync } from "node:fs"; export const value = readFileSync(`/tmp/external.wasm`)',
    'import { readFileSync } from "node:fs"; export const value = readFileSync(new URL("file:///tmp/external.wasm", import.meta.url))',
    'import fs from "node:fs"; const {readFileSync: read} = fs; export const value = read(process.env.EXTERNAL_PATH!)',
    'import { readFileSync } from "node:fs"; const read = readFileSync; export const value = read(process.env.EXTERNAL_PATH!)',
    'import fs from "node:fs"; export const value = fs.promises.readFile(process.env.EXTERNAL_PATH!)',
    'import { file as read } from "bun"; export const value = read("/tmp/external.wasm")',
    'const read = Bun.file; export const value = read("/tmp/external.wasm")',
    'import {createReadStream} from "node:fs"; const read = createReadStream; export const value = read("/tmp/input")',
    'import fs from "node:fs"; const read = fs.createReadStream; export const value = read("/tmp/input")',
    'import {createRequire} from "node:module"; const read = createRequire(import.meta.url); export const value = read(process.env.EXTERNAL_PATH!)',
    'import {readFileSync} from "node:fs"; import path from "node:path"; path.resolve=()=>"/tmp/external.wasm"; export const value=readFileSync(path.resolve(import.meta.dir,"local.wasm"))',
    'import {readFileSync} from "node:fs"; import {resolve} from "node:path"; process.cwd=()=>"/tmp"; export const value=readFileSync(resolve(process.cwd(),"external.wasm"))',
    'import {readFileSync} from "node:fs"; const path = new URL("./value.ts",import.meta.url); path.pathname="/tmp/external.wasm"; export const value=readFileSync(path)',
    'import {readFileSync} from "node:fs"; const path = new URL("./value.ts",import.meta.url); const mutate = (url:URL)=>{url.pathname="/tmp/external.wasm"}; mutate(path); export const value=readFileSync(path)',
    "export const value = Bun.file(`/tmp/external.wasm`)",
    "export const load = (path: string) => require(path)",
  ])("refuses unsupported or external filesystem/module boundaries: %s", async (source) => {
    const repo = fixture()
    repo.write("packages/app/src/external.ts", source)
    const snapshot = await repo.snapshot({ EXTERNAL_PATH: "/tmp/external.wasm" })
    expect(snapshot.scopes.get("app")?.cacheable).toBe(false)
    expect(
      new UnitTestCache(repo.root).receipt(snapshot, "app", "node", [
        "./packages/app/src/inputs.test.ts",
      ]),
    ).toBeUndefined()
  })
  it("resolves finite repository reads with actual join and URL semantics and rejects shadowed constructors", async () => {
    const repo = fixture()
    repo.write("packages/app/runtime.wasm", "original")
    repo.write(
      "packages/app/src/reader.ts",
      'import { readFileSync } from "node:fs"; import { resolve } from "node:path"; import { cwd } from "node:process"; const root = cwd(); export const a = readFileSync(resolve(root, "packages/app/runtime.wasm")); export const b = readFileSync(new URL("../runtime.wasm", import.meta.url))',
    )
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/app/runtime.wasm", "changed")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    repo.write(
      "packages/app/src/reader.ts",
      `import {readFileSync} from "node:fs"; import {join} from "node:path"; export const value = readFileSync(join("/tmp", ${JSON.stringify(join(repo.root, "packages/app/runtime.wasm"))}))`,
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
    repo.write(
      "packages/app/src/reader.ts",
      'import {readFileSync} from "node:fs"; const URL = class { constructor(...args:unknown[]) {} }; export const value = readFileSync(new URL("../runtime.wasm", import.meta.url))',
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("propagates unsupported reads through reached shared sources and refuses missing ignored/header inputs", async () => {
    const repo = fixture()
    repo.write("packages/app/src/shared.ts", 'import "../../../tests/shared"')
    repo.write(
      "tests/shared.ts",
      'import {readFileSync} from "node:fs"; readFileSync(process.env.EXTERNAL_PATH!)',
    )
    let snapshot = await repo.snapshot()
    expect(snapshot.scopes.get("app")?.cacheable).toBe(false)
    expect(snapshot.scopes.get("unrelated")?.cacheable).toBe(true)
    repo.write(
      "tests/shared.ts",
      'import {readFileSync} from "node:fs"; readFileSync(".artifacts/occt-build/package/include/missing.hxx")',
    )
    snapshot = await repo.snapshot()
    expect(snapshot.scopes.get("app")?.cacheable).toBe(false)
  })
  it("reuses inspected geometry and structural runtime receipts after an unrelated UI edit and refuses edited computed loaders", async () => {
    const repo = runtimeFixture()
    const before = await repo.snapshot()
    expect(before.scopes.get("geometry")?.cacheable).toBe(true)
    expect(
      before.scopes.get("structural")?.cacheable,
      JSON.stringify(before.scopes.get("structural")),
    ).toBe(true)
    const cache = new UnitTestCache(repo.root)
    const receipt = cache.receipt(before, "geometry", "node", [
      "./packages/geometry-worker/src/occt-primitives-kernel.test.ts",
    ])
    if (!receipt) throw new Error("Expected a reviewed cacheable runtime.")
    await cache.save(receipt, 0)
    repo.write("packages/web/src/ui.ts", "export const theme = 'updated'")
    const updated = await repo.snapshot()
    expect(scopeHash(updated, "geometry")).toBe(scopeHash(before, "geometry"))
    expect(scopeHash(updated, "structural")).toBe(scopeHash(before, "structural"))
    expect(scopeHash(updated, "web")).not.toBe(scopeHash(before, "web"))
    const hit = cache.receipt(updated, "geometry", "node", receipt.files)
    if (!hit) throw new Error("Unrelated UI edits must retain the kernel receipt.")
    expect(await cache.has(hit)).toBe(true)
    for (const path of repo.paths) {
      const original = readFileSync(join(repo.root, path), "utf8")
      repo.write(path, `${original}\n// Changed loader boundary.\n`)
      const workspace = path.includes("geometry-worker") ? "geometry" : "structural"
      expect((await repo.snapshot()).scopes.get(workspace)?.cacheable).toBe(false)
      repo.write(path, original)
    }
  })
  it("resolves query-only computed imports while refusing interpolated filesystem paths", async () => {
    const repo = fixture()
    repo.write(
      "packages/app/src/query.ts",
      `export const load = (revision: number) => import(\`../../relative/src/value?test=\${revision}\`)`,
    )
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/relative/src/value.ts", "export const value = 2")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    repo.write(
      "packages/app/src/query.ts",
      `export const load = (path: string) => import(\`../../\${path}/src/value?test=1\`)`,
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it.each([
    'export const fixture = Bun.file(".artifacts/unknown/runtime.wasm")',
    'import "../coverage/generated.ts"',
  ])("refuses a reference to an unhashed output tree: %s", async (source) => {
    const repo = fixture()
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(true)
    repo.write("packages/app/src/asset.ts", source)
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("invalidates own, transitive, peer, development, optional, cyclic and relative imports without invalidating an unrelated workspace", async () => {
    const repo = fixture()
    const initial = await repo.snapshot()
    for (const name of ["app", "cycle", "development", "peer", "optional", "relative"]) {
      repo.write(`packages/${name}/src/value.ts`, `export const value = ${name.length + 2}`)
      const changed = await repo.snapshot()
      expect(scopeHash(changed, "app")).not.toBe(scopeHash(initial, "app"))
      expect(scopeHash(changed, "unrelated")).toBe(scopeHash(initial, "unrelated"))
      repo.write(`packages/${name}/src/value.ts`, "export const value = 1")
    }
  })

  it("includes new, deleted and ignored sources and manifest changes", async () => {
    const repo = fixture()
    repo.write("node_modules/vendor/runtime.wasm", "first wasm")
    repo.write(".artifacts/structural-runtime/pyodide.asm.wasm", "first runtime")
    const initial = await repo.snapshot()
    repo.write("packages/app/fixtures/ignored.step", "new fixture")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(initial, "app"))
    rmSync(join(repo.root, "packages/app/fixtures"), { recursive: true })
    expect(scopeHash(await repo.snapshot(), "app")).toBe(scopeHash(initial, "app"))
    rmSync(join(repo.root, "packages/app/src/value.ts"))
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(initial, "app"))
    repo.write("packages/app/src/value.ts", "export const value = 1")
    repo.write(
      "packages/app/package.json",
      JSON.stringify({ name: "app", dependencies: { unrelated: "workspace:*" } }),
    )
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(initial, "app"))
  })

  it.each([
    "bun.lock",
    "tsconfig.json",
    "tests/unit/support/vite-imports.ts",
    "node_modules/vendor/runtime.wasm",
    ".artifacts/structural-runtime/pyodide.asm.wasm",
  ])("invalidates every workspace after changing shared input %s", async (path) => {
    const repo = fixture()
    repo.write("node_modules/vendor/runtime.wasm", "first wasm")
    repo.write(".artifacts/structural-runtime/pyodide.asm.wasm", "first runtime")
    const initial = await repo.snapshot()
    const original = readFileSync(join(repo.root, path), "utf8")
    repo.write(path, `${original}\nchanged`)
    const changed = await repo.snapshot()
    expect(scopeHash(changed, "app")).not.toBe(scopeHash(initial, "app"))
    expect(scopeHash(changed, "unrelated")).not.toBe(scopeHash(initial, "unrelated"))
  })

  it("fails closed for computed imports and imports outside the repository", async () => {
    const repo = fixture()
    repo.write("packages/app/src/dynamic.ts", "export const load = (path: string) => import(path)")
    const before = await repo.snapshot()
    expect(before.scopes.get("app")?.cacheable).toBe(false)
    repo.write("packages/unrelated/src/value.ts", "export const value = 2")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    repo.write("packages/peer/src/external.ts", 'import "../../../../outside.ts"')
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("runs scripts and explicit transport or external-home dependencies without receipts", async () => {
    const repo = fixture()
    expect((await repo.snapshot()).scopes.get("$root")?.cacheable).toBe(false)
    repo.write(
      "packages/unrelated/src/transport.ts",
      "export const commit = process.env.GITHUB_SHA",
    )
    expect((await repo.snapshot()).scopes.get("unrelated")?.cacheable).toBe(false)
    repo.write(
      "packages/peer/src/home.ts",
      'import { homedir } from "node:os"; export const external = homedir()',
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("includes undeclared cross-package file assets and rejects external literal file inputs", async () => {
    const repo = fixture()
    repo.write(
      "packages/app/src/asset.ts",
      'import { readFileSync } from "node:fs"; export const fixture = readFileSync("packages/unrelated/fixture.wasm")',
    )
    repo.write("packages/unrelated/fixture.wasm", "original")
    const before = await repo.snapshot()
    repo.write("packages/unrelated/fixture.wasm", "changed")
    expect(scopeHash(await repo.snapshot(), "app")).not.toBe(scopeHash(before, "app"))
    repo.write(
      "packages/app/src/asset.ts",
      'import { readFileSync } from "node:fs"; export const fixture = readFileSync("/outside-the-repository/runtime.wasm")',
    )
    expect((await repo.snapshot()).scopes.get("app")?.cacheable).toBe(false)
  })
  it("hashes every actual controlled environment value, including unknown and indirect inputs", async () => {
    const repo = fixture()
    const original = {
      GITHUB_SHA: "one",
      RUNNER_TEMP: "job-1",
      TZ: "UTC",
      UNKNOWN_EXTERNAL_RUNTIME: "one",
    }
    const controlled = unitTestEnvironment(original)
    expect(controlled).toEqual({ TZ: "UTC", UNKNOWN_EXTERNAL_RUNTIME: "one" })
    const before = await repo.snapshot(controlled)
    expect(
      scopeHash(
        await repo.snapshot(
          unitTestEnvironment({ ...original, GITHUB_SHA: "two", RUNNER_TEMP: "job-2" }),
        ),
        "app",
      ),
    ).toBe(scopeHash(before, "app"))
    expect(
      scopeHash(await repo.snapshot({ ...controlled, UNKNOWN_EXTERNAL_RUNTIME: "two" }), "app"),
    ).not.toBe(scopeHash(before, "app"))
  })

  it("invalidates runtime, architecture, platform, environment, runner options and external installation edits", async () => {
    const repo = fixture()
    const before = await repo.snapshot()
    for (const runtime of ["bun:new:linux:arm64", "bun:linux:x64", "bun:darwin:arm64"])
      expect(scopeHash(await repo.snapshot(undefined, runtime), "app")).not.toBe(
        scopeHash(before, "app"),
      )
    expect(scopeHash(await repo.snapshot({ CI: "true", TZ: "Europe/Prague" }), "app")).not.toBe(
      scopeHash(before, "app"),
    )
    expect(
      scopeHash(
        await unitTestInputs(
          repo.root,
          ["--parallel=4"],
          { CI: "true", TZ: "UTC" },
          "bun:linux:arm64",
        ),
        "app",
      ),
    ).not.toBe(scopeHash(before, "app"))
    repo.write("node_modules/unknown/runtime.js", "unknown installed runtime")
    expect(scopeHash(await repo.snapshot(), "unrelated")).not.toBe(scopeHash(before, "unrelated"))
  })
})

describe("native unit-test receipts", () => {
  it("never stores failures and treats corrupt or stale receipts as misses", async () => {
    const repo = fixture()
    const cache = new UnitTestCache(repo.root)
    const before = await repo.snapshot()
    const receipt = cache.receipt(before, "app", "node", ["./packages/app/src/value.test.ts"])
    if (!receipt) throw new Error("Expected a cacheable fixture.")
    await cache.save(receipt, 1)
    expect(await cache.has(receipt)).toBe(false)
    await cache.save(receipt, 0)
    expect(await cache.has(receipt)).toBe(true)
    repo.write("packages/relative/src/value.ts", "export const value = 2")
    const stale = cache.receipt(await repo.snapshot(), "app", "node", receipt.files)
    if (!stale) throw new Error("Expected a cacheable fixture.")
    expect(await cache.has(stale)).toBe(false)
    repo.write(`.turbo/unit-tests/v1/${receipt.key}.json`, '{"receipt":')
    expect(await cache.has(receipt)).toBe(false)
  })

  it("publishes concurrent receipts atomically without overwriting an existing entry", async () => {
    const repo = fixture()
    const cache = new UnitTestCache(repo.root)
    const receipt = cache.receipt(await repo.snapshot(), "app", "dom", [
      "./packages/app/src/value.test.tsx",
    ])
    if (!receipt) throw new Error("Expected a cacheable fixture.")
    await Promise.all(Array.from({ length: 8 }, () => cache.save(receipt, 0)))
    expect(await cache.has(receipt)).toBe(true)
    const saved = readFileSync(join(cache.directory, `${receipt.key}.json`), "utf8")
    await cache.save(receipt, 0)
    expect(readFileSync(join(cache.directory, `${receipt.key}.json`), "utf8")).toBe(saved)
  })

  it("only permits complete opt-in runs and consumes launcher flags", () => {
    const root = fixture().root
    expect(unitTestOptions([], root).cache).toBe(false)
    expect(
      unitTestOptions(["--cache", "--parallel", "4", "--timeout", "20000"], root),
    ).toMatchObject({ cache: true, forwarded: ["--parallel=4", "--timeout=20000"] })
    for (const options of [
      ["--force"],
      ["--bail"],
      ["packages/app"],
      ["--watch"],
      ["--coverage"],
      ["--changed"],
      ["--only"],
      ["--test-name-pattern", "specific"],
      ["--shard", "1/2"],
      ["--preload", "custom.ts"],
      ["--update-timings"],
      ["--reporter-outfile", "report.xml"],
      ["--unknown-future-flag"],
    ])
      expect(unitTestOptions(["--cache", ...options], root).cache).toBe(false)
    expect(unitTestOptions(["--cache", "--force"], root).forwarded).toEqual([])
    expect(() => unitTestOptions(["--cache", "--timeout"], root)).toThrow("Missing value")
    for (const group of ["node", "dom"]) {
      for (const options of [["--group", group], [`--group=${group}`]])
        expect(unitTestOptions(["--cache", ...options], root)).toMatchObject({
          group,
          cache: true,
          forwarded: [],
        })
      expect(unitTestOptions(["--cache", `--group=${group}`, "packages/app"], root).cache).toBe(
        false,
      )
    }
    for (const options of [
      ["--group"],
      ["--group="],
      ["--group=other"],
      ["--group=node", "--group=dom"],
    ])
      expect(() => unitTestOptions(options, root)).toThrow()
  })
})

it("the native launcher executes all local tests, skips only complete successful cached scopes, and reruns failures", async () => {
  const repo = fixture()
  const externalRoot = mkdtempSync(join(tmpdir(), "vibeshape-unit-external-"))
  temporary.push(externalRoot)
  const externalPath = join(externalRoot, "runtime.wasm")
  writeFileSync(externalPath, "original")
  for (const file of [
    "run-unit-tests.ts",
    "unit-test-cache.ts",
    "unit-test-dependencies.ts",
    "unit-test-environment.ts",
    "unit-test-files.ts",
    "unit-test-inputs.ts",
    "unit-test-options.ts",
    "unit-test-parser.ts",
    "unit-test-source.ts",
    "unit-test-source-paths.ts",
    "unit-test-readers.ts",
    "unit-test-external-io.ts",
    "unit-test-builtins.ts",
    "unit-test-runtime-policy.ts",
    "workspace-graph.ts",
  ]) {
    mkdirSync(join(repo.root, "scripts"), { recursive: true })
    copyFileSync(join(import.meta.dir, file), join(repo.root, "scripts", file))
  }
  mkdirSync(join(repo.root, "node_modules"), { recursive: true })
  symlinkSync(
    dirname(import.meta.resolve("zod").replace("file://", "")),
    join(repo.root, "node_modules/zod"),
  )
  symlinkSync(
    dirname(import.meta.resolve("typescript/package.json").replace("file://", "")),
    join(repo.root, "node_modules/typescript"),
  )
  repo.write("scripts/unit-test-timings.json", '{"version":1,"files":{}}')
  repo.write(
    "packages/app/src/value.test.ts",
    `import { expect, test } from "bun:test"; import { appendFileSync } from "node:fs"; import { value } from "./value"; test("valid fixture", () => { appendFileSync(".git/invocations", "app\\n"); expect(value).toBe(1) })`,
  )
  repo.write(
    "packages/unrelated/src/value.test.ts",
    `import { expect, test } from "bun:test"; import { appendFileSync } from "node:fs"; test("DOM preload fixture", () => { appendFileSync(".git/invocations", "dom\\n"); expect(globalThis.__fixtureDOM).toBe(true) }); // tests/unit/support/dom`,
  )
  repo.write(
    "scripts/root.test.ts",
    `import { expect, test } from "bun:test"; import { appendFileSync } from "node:fs"; test("root retains original environment", () => { appendFileSync(".git/invocations", "root\\n"); expect(process.env.GITHUB_SHA).toBe("fixture-commit") })`,
  )
  repo.write("packages/metadata/package.json", JSON.stringify({ name: "metadata" }))
  repo.write(
    "packages/metadata/metadata.test.ts",
    `import { expect, test } from "bun:test"; import { appendFileSync } from "node:fs"; test("workspace retains required metadata", () => { appendFileSync(".git/invocations", "metadata\\n"); expect(process.env.GITHUB_SHA).toBe("fixture-commit") })`,
  )
  const calls = (name: string) =>
    readFileSync(join(repo.root, ".git/invocations"), "utf8")
      .split("\n")
      .filter((line) => line === name).length
  const run = (...args: string[]) =>
    Bun.spawnSync([process.execPath, join(repo.root, "scripts/run-unit-tests.ts"), ...args], {
      cwd: repo.root,
      env: {
        CI: "true",
        PATH: process.env.PATH,
        GITHUB_SHA: "fixture-commit",
        EXTERNAL_PATH: externalPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
  const pass = (...args: string[]) => {
    const result = run(...args)
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return result
  }
  pass("--cache")
  expect(calls("app")).toBe(1)
  expect(calls("dom")).toBe(1)
  expect(calls("root")).toBe(1)
  expect(calls("metadata")).toBe(1)
  expect(pass("--cache").stdout.toString()).toContain("Unit cache hit: app/node")
  expect(calls("app")).toBe(1)
  expect(calls("dom")).toBe(1)
  expect(calls("root")).toBe(2)
  expect(calls("metadata")).toBe(2)
  pass()
  expect(calls("app")).toBe(2)
  expect(calls("dom")).toBe(2)
  pass("--cache", "--force")
  expect(calls("app")).toBe(3)
  expect(calls("dom")).toBe(3)
  repo.write("packages/app/src/value.ts", "export const value = 2")
  expect(run("--cache").exitCode).not.toBe(0)
  expect(run("--cache").exitCode).not.toBe(0)
  expect(calls("app")).toBe(5)
  expect(calls("dom")).toBe(3)
  expect(calls("root")).toBe(6)
  expect(calls("metadata")).toBe(6)
  repo.write("packages/app/src/value.ts", "export const value = 1")
  const beforeNode = calls("app")
  const beforeDOM = calls("dom")
  pass("--group", "node")
  expect(calls("app")).toBe(beforeNode + 1)
  expect(calls("dom")).toBe(beforeDOM)
  pass("--group=dom")
  expect(calls("app")).toBe(beforeNode + 1)
  expect(calls("dom")).toBe(beforeDOM + 1)
  pass("--cache", "--group=node")
  const cachedNode = calls("app")
  expect(pass("--cache", "--group=node").stdout.toString()).toContain("Unit cache hit: app/node")
  expect(calls("app")).toBe(cachedNode)
  pass("--cache", "--group=dom")
  const cachedDOM = calls("dom")
  expect(pass("--cache", "--group=dom").stdout.toString()).toContain(
    "Unit cache hit: unrelated/dom",
  )
  expect(calls("dom")).toBe(cachedDOM)
  expect(run("--group=other").exitCode).not.toBe(0)
  pass("--cache", "--reporter=junit", "--reporter-outfile=report.xml")
  expect(readFileSync(join(repo.root, "report.node.xml"), "utf8")).toContain("testsuite")
  expect(readFileSync(join(repo.root, "report.dom.xml"), "utf8")).toContain("testsuite")
  repo.write("packages/external/package.json", JSON.stringify({ name: "external" }))
  repo.write(
    "packages/external/external.test.ts",
    `import {expect,test} from "bun:test";import {appendFileSync,readFileSync} from "node:fs";test("external contents always execute",()=>{appendFileSync(".git/invocations","external\\n");expect(readFileSync(process.env.EXTERNAL_PATH!,"utf8")).toBe("original")})`,
  )
  pass("--cache")
  pass("--cache")
  expect(calls("external")).toBe(2)
  writeFileSync(externalPath, "changed without changing the path or environment")
  expect(run("--cache").exitCode).not.toBe(0)
  expect(calls("external")).toBe(3)
}, 30_000)
