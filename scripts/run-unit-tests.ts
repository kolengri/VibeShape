import { extname, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const forwarded: string[] = []
const filters: string[] = []
const valueFlags = new Set([
  "-t",
  "--test-name-pattern",
  "--timeout",
  "--parallel-delay",
  "--max-concurrency",
  "--reporter",
  "--reporter-outfile",
  "--coverage-dir",
  "--coverage-reporter",
  "--seed",
  "--rerun-each",
  "--retry",
  "--shard",
  "--timings",
  "--preload",
  "--path-ignore-patterns",
])
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const argument = args[index]
  if (argument === undefined) continue
  const next = args[index + 1]
  if (argument.startsWith("-")) {
    forwarded.push(argument)
    if (valueFlags.has(argument)) {
      const value = args[++index]
      if (!value) throw new Error(`Missing value for ${argument}.`)
      forwarded[forwarded.length - 1] = `${argument}=${value}`
    } else if (["--parallel", "--bail"].includes(argument) && /^\d+$/.test(args[index + 1] ?? "")) {
      forwarded[forwarded.length - 1] = `${argument}=${args[++index]}`
    } else if (argument === "--changed" && next && !next.startsWith("-")) {
      const reference = Bun.spawnSync(["git", "rev-parse", "--verify", `${next}^{commit}`], {
        cwd: root,
        stdout: "ignore",
        stderr: "ignore",
      })
      if (reference.exitCode === 0) forwarded[forwarded.length - 1] = `--changed=${args[++index]}`
    }
  } else {
    filters.push(argument.replace(/^\.\//, ""))
  }
}

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
async function runGroup(group: (typeof groups)[number]) {
  if (!group.files.length) return
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
      ...group.files,
    ],
    { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  )
  const result = await child.exited
  if (result) exitCode = result
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
process.exit(exitCode)
