import { mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { loadWorkspaceGraph } from "./workspace-graph"

const configurationSchema = z
  .object({
    tasks: z.record(z.string(), z.record(z.string(), z.unknown())),
  })
  .passthrough()
const valueFlags = new Map([
  ["--concurrency", /^[1-9]\d*$|^(?:[1-9]\d?|100)%$/],
  ["--filter", /\S/],
  ["-F", /\S/],
  ["--cache-dir", /\S/],
  ["--output-logs", /^(?:full|hash-only|new-only|errors-only|none)$/],
  ["--log-order", /^(?:auto|stream|grouped)$/],
  ["--log-prefix", /^(?:auto|task|none)$/],
])

function splitOption(argument: string, following: string | undefined) {
  const separator = argument.indexOf("=")
  if (separator < 0) return { name: argument, value: following, consumesNext: true }
  return {
    name: argument.slice(0, separator),
    value: argument.slice(separator + 1),
    consumesNext: false,
  }
}

function validatedValue(name: string, value: string | undefined, validator: RegExp) {
  if (!value || !validator.test(value)) throw new Error(`Invalid value for ${name}.`)
  return `${name}=${value}`
}

const requiredOptions = new Set(["--cache=local:rw", "--env-mode=strict"])
function validatedSwitch(argument: string) {
  if (
    /^--(?:force|summarize|help)$|^--(?:dry|dry-run)(?:=(?:json|text))?$|^--continue(?:=(?:never|dependencies-successful|always))?$/.test(
      argument,
    )
  )
    return argument
  if (requiredOptions.has(argument)) return undefined
  throw new Error(
    `Unsupported typecheck option: ${argument}. Local cache and strict environment mode are required.`,
  )
}

function parseOption(argument: string, following: string | undefined) {
  const { name, value, consumesNext } = splitOption(argument, following)
  const validator = valueFlags.get(name)
  if (validator) return { argument: validatedValue(name, value, validator), consumesNext }
  return { argument: validatedSwitch(argument), consumesNext: false }
}

function turboArguments(input: string[]) {
  const output: string[] = []
  for (let index = 0; index < input.length; index++) {
    const option = parseOption(input[index] ?? "", input[index + 1])
    if (option.argument) output.push(option.argument)
    index += Number(option.consumesNext)
  }
  return [...output, "--cache=local:rw", "--env-mode=strict"]
}

const input = process.argv.slice(2)
if (input[0] === "--") input.shift()
const args = turboArguments(input.filter((argument) => argument !== ""))
if (!args.some((argument) => argument.startsWith("--concurrency="))) args.push("--concurrency=2")
const root = process.cwd()
const configuration = configurationSchema.parse(await Bun.file(join(root, "turbo.json")).json())
const { workspaces, dependencyClosure } = await loadWorkspaceGraph(root)
const names = [...workspaces.keys()].sort()

// Command-free leaves retain Turbo's dirty/untracked input hashing and break task cycles.
configuration.tasks["source-inputs"] = { dependsOn: [], outputs: [] }
for (const name of names) {
  configuration.tasks[`${name}#transit`] = {
    dependsOn: [...dependencyClosure(name)]
      .sort()
      .map((dependency) => `${dependency}#source-inputs`),
    outputs: [],
  }
}
configuration.tasks.typecheck = {
  ...configuration.tasks.typecheck,
  cache: true,
  dependsOn: ["transit"],
}
configuration.tasks["//#typecheck:scripts"] = {
  ...configuration.tasks["//#typecheck:scripts"],
  cache: true,
  dependsOn: names.map((name) => `${name}#source-inputs`),
}

const directory = join(root, ".turbo")
await mkdir(directory, { recursive: true })
const path = join(directory, "typechecks.json")
const temporary = `${path}.${process.pid}.tmp`
await writeFile(temporary, `${JSON.stringify(configuration, null, 2)}\n`)
await rename(temporary, path)

const turbo = fileURLToPath(import.meta.resolve("turbo/bin/turbo"))
const child = Bun.spawn(
  [
    process.execPath,
    turbo,
    "--root-turbo-json",
    path,
    "run",
    "typecheck",
    "typecheck:scripts",
    ...args,
  ],
  {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: "1",
      VIBESHAPE_TYPECHECK_RUNTIME: `${Bun.version}:${process.platform}:${process.arch}`,
    },
  },
)
process.exitCode = await child.exited
