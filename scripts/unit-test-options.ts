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

function forwardedOption(argument: string, next: string | undefined, root: string) {
  if (valueFlags.has(argument)) {
    if (!next) throw new Error(`Missing value for ${argument}.`)
    return { argument: `${argument}=${next}`, consumesNext: true }
  }
  if (["--parallel", "--bail"].includes(argument) && /^\d+$/.test(next ?? ""))
    return { argument: `${argument}=${next}`, consumesNext: true }
  if (changedReference(argument, next, root))
    return { argument: `--changed=${next}`, consumesNext: true }
  return { argument, consumesNext: false }
}
function changedReference(argument: string, next: string | undefined, root: string) {
  if (argument !== "--changed" || !next || next.startsWith("-")) return false
  return (
    Bun.spawnSync(["git", "rev-parse", "--verify", `${next}^{commit}`], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  )
}

function selectedGroup(value: string | undefined, previous: "node" | "dom" | undefined) {
  if (value !== "node" && value !== "dom") throw new Error("--group must select node or dom.")
  if (previous && previous !== value) throw new Error("Select only one unit-test group.")
  return value
}

function completeOptions(forwarded: string[], filters: string[]) {
  // Unknown future selection flags must never seed complete-result receipts.
  return (
    !filters.length &&
    forwarded.every((flag) =>
      /^--(?:timeout|parallel|parallel-delay|max-concurrency|seed|timings)(?:=|$)/.test(flag),
    )
  )
}

/** Launcher options are consumed here; all other options retain Bun's existing semantics. */
export function unitTestOptions(input: string[], root: string) {
  const forwarded: string[] = []
  const filters: string[] = []
  let requested = false
  let force = false
  let group: "node" | "dom" | undefined
  for (let index = 0; index < input.length; index++) {
    const argument = input[index]
    if (!argument || argument === "--") continue
    if (argument === "--cache") {
      requested = true
      continue
    }
    if (argument === "--force") {
      force = true
      continue
    }
    const selection = /^--group(?:=(.*))?$/.exec(argument)
    if (selection) {
      group = selectedGroup(selection[1] ?? input[++index], group)
      continue
    }
    if (!argument.startsWith("-")) {
      filters.push(argument.replace(/^\.\//, ""))
      continue
    }
    const option = forwardedOption(argument, input[index + 1], root)
    forwarded.push(option.argument)
    index += Number(option.consumesNext)
  }
  const complete = completeOptions(forwarded, filters)
  return { forwarded, filters, cache: requested && !force && complete, requested, force, group }
}
