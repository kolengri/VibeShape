import { extname, resolve } from "node:path"
import { UnitTestCache } from "./unit-test-cache"
import { unitTestEnvironment } from "./unit-test-environment"
import { unitTestInputs } from "./unit-test-inputs"
import { unitTestOptions } from "./unit-test-options"

const root = resolve(import.meta.dir, "..")
const {
  forwarded,
  filters,
  cache: useCache,
  requested,
  force,
} = unitTestOptions(process.argv.slice(2), root)
if (requested && !useCache)
  console.log(
    `Unit cache bypass: ${force ? "forced execution" : "partial or output-producing runner options"}.`,
  )

const files: string[] = []
for (const directory of ["apps", "packages", "scripts"]) {
  const glob = new Bun.Glob(`${directory}/**/*.test.{ts,tsx}`)
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
    if (file.split("/").includes("node_modules")) continue
    if (file.startsWith("apps/remote-mcp/") && file.endsWith(".worker.test.ts")) continue
    if (filters.length && !filters.some((filter) => file.includes(filter))) continue
    files.push(`./${file}`)
  }
}
if (!files.length) {
  console.error("No unit test files matched the requested filters.")
  process.exit(1)
}
const nodeFiles: string[] = []
const domFiles: string[] = []
for (const file of files.sort()) {
  const source = await Bun.file(resolve(root, file)).text()
  // DOM must exist before CJS Testing Library imports bind `screen` to document.body.
  const group = source.includes("tests/unit/support/dom") ? domFiles : nodeFiles
  group.push(file)
}
const groups = [
  { name: "node", files: nodeFiles, preload: [] as string[] },
  { name: "dom", files: domFiles, preload: ["--preload", "./tests/unit/support/dom.ts"] },
]
const splitOutputs = groups.every((group) => group.files.length > 0)
const changed = forwarded.some(
  (argument) => argument === "--changed" || argument.startsWith("--changed="),
)
const timings = forwarded.some((argument) => argument.startsWith("--timings="))
  ? []
  : ["--timings=./scripts/unit-test-timings.json"]
const cache = useCache ? new UnitTestCache(root) : undefined
const controlledEnvironment = unitTestEnvironment(process.env)
// Prepare the exact pinned runtime before snapshotting inputs, including first CI runs.
if (
  cache &&
  files.some((file) => file.includes("packages/structural-optimization/tests/")) &&
  (await Bun.file(resolve(root, "scripts/prepare-structural-runtime.ts")).exists())
) {
  const prepare = Bun.spawn([process.execPath, "run", "scripts/prepare-structural-runtime.ts"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  const result = await prepare.exited
  if (result) process.exit(result)
}
async function snapshotInputs() {
  try {
    return await unitTestInputs(
      root,
      [...timings, ...forwarded],
      controlledEnvironment,
      undefined,
      files,
    )
  } catch (error) {
    console.log(`Unit cache disabled: inputs could not be verified (${String(error)}).`)
    return undefined
  }
}
const snapshot = cache ? await snapshotInputs() : undefined
const successful: { workspace: string; group: "node" | "dom"; files: string[] }[] = []
function outputOption(argument: string, group: string) {
  if (argument.startsWith("--coverage-dir=")) return `${argument}/${group}`
  if (!argument.startsWith("--reporter-outfile=")) return argument
  const original = argument.slice("--reporter-outfile=".length)
  const extension = extname(original)
  const stem = extension ? original.slice(0, -extension.length) : original
  const output = `${stem}.${group}${extension}`
  console.log(`JUnit ${group} report: ${output}`)
  return `--reporter-outfile=${output}`
}
function groupOptions(group: string) {
  if (!splitOutputs) return forwarded
  const options = forwarded.map((argument) => outputOption(argument, group))
  const explicitCoverage = options.some((option) => option.startsWith("--coverage-dir="))
  if (options.includes("--coverage") && !explicitCoverage)
    options.push(`--coverage-dir=coverage/${group}`)
  return options
}
let exitCode = 0
function groupScopes(group: (typeof groups)[number]) {
  const scopes = new Map<string, string[]>()
  for (const file of group.files) {
    const workspace = snapshot?.workspaceFor(file) ?? "$root"
    const selected = scopes.get(workspace) ?? []
    selected.push(file)
    scopes.set(workspace, selected)
  }
  return scopes
}
async function pendingScopes(group: (typeof groups)[number]) {
  const scopes = groupScopes(group)
  const controlled: string[] = []
  const original: string[] = []
  const groupName = group.name as "node" | "dom"
  for (const [workspace, selected] of scopes) {
    if (await scopeHit(workspace, groupName, selected))
      console.log(`Unit cache hit: ${workspace}/${group.name} (${selected.length} files).`)
    else {
      const files = controlledScope(workspace) ? controlled : original
      files.push(...selected)
      logMiss(workspace, group.name, selected.length)
    }
  }
  const batches = [
    { files: controlled, env: controlledEnvironment, cacheable: true },
    { files: original, env: process.env, cacheable: false },
  ].filter((batch) => batch.files.length > 0)
  return { scopes, batches, groupName }
}
function controlledScope(workspace: string) {
  return Boolean(snapshot?.scopes.get(workspace)?.cacheable)
}
function logMiss(workspace: string, group: string, count: number) {
  if (cache) console.log(`Unit cache miss: ${workspace}/${group} (${count} files).`)
}
async function scopeHit(workspace: string, group: "node" | "dom", files: string[]) {
  if (!snapshot || !cache) return false
  const receipt = cache.receipt(snapshot, workspace, group, files)
  return receipt ? cache.has(receipt) : false
}
async function runGroup(group: (typeof groups)[number]) {
  const { scopes, batches, groupName } = await pendingScopes(group)
  for (const batch of batches) {
    const result = await runBatch(group, batch.files, batch.env)
    afterBatch(result, batch, scopes, groupName)
  }
}
async function runBatch(group: (typeof groups)[number], files: string[], env: NodeJS.ProcessEnv) {
  const options = groupOptions(group.name)
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--no-orphans",
      "--parallel=2",
      "--timeout=15000",
      ...timings,
      "--preload",
      "./tests/unit/support/vite-imports.ts",
      ...group.preload,
      ...(changed ? ["--pass-with-no-tests"] : []),
      ...options,
      ...files.sort(),
    ],
    { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit", env },
  )
  const result = await child.exited
  return result
}
function afterBatch(
  result: number,
  batch: { cacheable: boolean; files: string[] },
  scopes: Map<string, string[]>,
  group: "node" | "dom",
) {
  if (result) exitCode = result
  if (!result && batch.cacheable) recordSuccess(scopes, batch.files, group)
}
function recordSuccess(scopes: Map<string, string[]>, pending: string[], group: "node" | "dom") {
  for (const [workspace, selected] of scopes) {
    if (selected.some((file) => pending.includes(file)))
      successful.push({ workspace, group, files: selected })
  }
}
if (forwarded.includes("--watch")) {
  await Promise.all(groups.map(runGroup))
} else {
  const bail = forwarded.some((argument) => argument === "--bail" || argument.startsWith("--bail="))
  for (const group of groups) {
    await runGroup(group)
    if (bail && exitCode) break
  }
}
if (cache && snapshot && successful.length) {
  // Refuse receipts if source, generated inputs, dependencies, or environment changed during execution.
  const current = await snapshotInputs()
  for (const scope of successful) {
    const before = cache.receipt(snapshot, scope.workspace, scope.group, scope.files)
    const after = current && cache.receipt(current, scope.workspace, scope.group, scope.files)
    if (before && after?.key === before.key) await cache.save(before, 0)
    else
      console.log(
        `Unit cache not saved: ${scope.workspace}/${scope.group} inputs changed or are unsafe.`,
      )
  }
}
process.exit(exitCode)
