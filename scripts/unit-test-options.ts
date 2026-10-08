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

/** Launcher options are consumed here; all other options retain Bun's existing semantics. */
export function unitTestOptions(input: string[], root: string) {
  const forwarded: string[] = []
  const filters: string[] = []
  let requested = false
  let force = false
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
    if (!argument.startsWith("-")) {
      filters.push(argument.replace(/^\.\//, ""))
      continue
    }
    const option = forwardedOption(argument, input[index + 1], root)
    forwarded.push(option.argument)
    index += Number(option.consumesNext)
  }
  // A whitelist prevents future Bun flags that select a partial corpus from creating receipts.
  const complete =
    !filters.length &&
    forwarded.every((flag) =>
      /^--(?:timeout|parallel|parallel-delay|max-concurrency|seed|timings)(?:=|$)/.test(flag),
    )
  return { forwarded, filters, cache: requested && !force && complete, requested, force }
}
