import { realpathSync } from "node:fs"
import { isBuiltin } from "node:module"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { cacheInputPath, inside, type treeInputs } from "./unit-test-files"
import { unitTestParser } from "./unit-test-parser"
import { sourceAnalysis } from "./unit-test-source"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]
type SourceEdges = {
  dependencies: Set<string>
  wider: boolean
  unsafe: boolean
  unsafeInputs: Set<string>
  inputs: Map<string, string>
}
type Parser = Awaited<ReturnType<typeof unitTestParser>>
type Context = {
  root: string
  directories: Map<string, string>
  index: Map<string, Input>
  hashes: Map<string, string>
  parser: Parser
  analyses: Map<Input, ReturnType<typeof sourceAnalysis>>
  environment: NodeJS.ProcessEnv
}
const preloads = ["tests/unit/support/vite-imports.ts", "tests/unit/support/dom.ts"]
const extensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
]

export function workspaceAt(path: string, directories: Map<string, string>) {
  return [...directories].find(([, directory]) => inside(directory, path))?.[0]
}

function indexedInput(path: string, context: Context) {
  const direct = context.index.get(path)
  if (direct) return direct
  try {
    return context.index.get(realpathSync(path))
  } catch {
    return undefined
  }
}

function relativeFile(target: string, context: Context) {
  if (!cacheInputPath(context.root, target))
    throw new Error("An imported source is outside the hashed input trees.")
  for (const extension of extensions) {
    const input = indexedInput(`${target}${extension}`, context)
    if (input) return input
  }
  throw new Error("An imported source was not found in the hashed inputs.")
}

function importedFile(specifier: string, path: string, context: Context) {
  if (specifier === "bun" || specifier.startsWith("bun:") || isBuiltin(specifier)) return undefined
  if (specifier.startsWith("file:")) return relativeFile(fileURLToPath(specifier), context)
  if (specifier.startsWith(".") || isAbsolute(specifier))
    return relativeFile(resolve(dirname(path), specifier), context)
  const input = indexedInput(Bun.resolveSync(specifier, dirname(path)), context)
  if (!input) throw new Error("An installed module was not found in the hashed inputs.")
  return input
}

function addFile(path: string, context: Context, edges: SourceEdges, pending: Set<Input>) {
  const input = cacheInputPath(context.root, path) && indexedInput(path, context)
  if (!input || input.hash === "missing") {
    edges.unsafe = true
    edges.unsafeInputs.add(relative(context.root, path))
    return
  }
  const owner = workspaceAt(path, context.directories)
  if (owner) edges.dependencies.add(owner)
  pending.add(input)
}

async function analysisFor(input: Input, context: Context) {
  if (!context.analyses.has(input))
    context.analyses.set(
      input,
      sourceAnalysis(
        context.root,
        input,
        await context.parser.parse(input),
        context.hashes,
        context.environment,
      ),
    )
  const analysis = context.analyses.get(input)
  if (!analysis) throw new Error("Missing source analysis.")
  return analysis
}

function importedInputs(
  input: Input,
  analysis: ReturnType<typeof sourceAnalysis>,
  context: Context,
  edges: SourceEdges,
  pending: Set<Input>,
) {
  const path = input.sourcePath ?? resolve(context.root, input.path)
  for (const specifier of analysis.imports) {
    const imported = importedFile(specifier, path, context)
    if (!imported) continue
    if (imported.source === undefined) pending.add(imported)
    else
      addFile(imported.sourcePath ?? resolve(context.root, imported.path), context, edges, pending)
  }
}

async function scanInput(input: Input, context: Context, edges: SourceEdges, pending: Set<Input>) {
  if (input.source === undefined) return
  const analysis = await analysisFor(input, context)
  edges.unsafe ||= analysis.unsafe
  edges.wider ||= analysis.unsafe
  if (analysis.unsafe) edges.unsafeInputs.add(input.path)
  for (const path of analysis.files) addFile(path, context, edges, pending)
  importedInputs(input, analysis, context, edges, pending)
}

async function reachableEdges(inputs: Input[], context: Context) {
  const edges: SourceEdges = {
    dependencies: new Set(),
    wider: false,
    unsafe: false,
    unsafeInputs: new Set(),
    inputs: new Map(),
  }
  const pending = new Set(inputs)
  for (const preload of preloads) addFile(resolve(context.root, preload), context, edges, pending)
  for (const input of pending) {
    edges.inputs.set(input.path, input.hash)
    try {
      await scanInput(input, context, edges, pending)
    } catch (error) {
      edges.unsafe = true
      edges.wider = true
      edges.unsafeInputs.add(
        `${input.path}: ${error instanceof Error ? error.message : "source analysis failed"}`,
      )
    }
  }
  return edges
}

function selectedEntries(name: string, files: string[], context: Context) {
  const entries: Input[] = []
  let unsafe = false
  for (const file of files) {
    const path = resolve(context.root, file)
    if (workspaceAt(path, context.directories) !== name) continue
    const input = cacheInputPath(context.root, path) && indexedInput(path, context)
    if (!input || input.source === undefined) unsafe = true
    else entries.push(input)
  }
  return { entries, unsafe }
}

/** Follow actual test/preload imports recursively, including shared root modules and undeclared edges. */
export async function sourceDependencies(
  root: string,
  sources: Map<string, Input[]>,
  globals: Input[],
  installed: Input[],
  directories: Map<string, string>,
  execution: { files: string[]; environment: NodeJS.ProcessEnv },
) {
  const inputs = [...sources.values()].flat().concat(globals, installed)
  const index = new Map<string, Input>()
  for (const input of inputs) {
    index.set(resolve(root, input.path), input)
    if (input.actualPath) index.set(input.actualPath, input)
    if (input.sourcePath) index.set(input.sourcePath, input)
  }
  const parser = await unitTestParser(root, inputs)
  try {
    const context: Context = {
      root,
      directories,
      index,
      parser,
      hashes: new Map(inputs.map((input) => [input.path, input.hash])),
      analyses: new Map(),
      environment: execution.environment,
    }
    const edges = new Map<string, SourceEdges>()
    for (const [name, inputs] of sources) {
      const selected = selectedEntries(name, execution.files, context)
      const edge = await reachableEdges(selected.entries, context)
      edge.unsafe ||= selected.unsafe
      if (selected.unsafe) edge.unsafeInputs.add("unhashed test entry")
      // Explicit transport/home dependencies retain the original inherited environment.
      for (const input of inputs) {
        if (
          /\b(?:GITHUB_|RUNNER_|ACTIONS_|CODEX_|AGENT_|TURBO_|AI_AGENT\b)|\bhomedir\s*\(/.test(
            input.source ?? "",
          )
        ) {
          edge.unsafe = true
          edge.unsafeInputs.add(input.path)
        }
      }
      edges.set(name, edge)
    }
    return edges
  } finally {
    await parser.close()
  }
}

export function sourceClosure(
  name: string,
  names: string[],
  declaredClosure: (name: string) => Set<string>,
  edges: Map<string, SourceEdges>,
) {
  const closure = name === "$root" ? new Set(names) : declaredClosure(name)
  for (const dependency of closure) {
    const edge = edges.get(dependency)
    if (!edge) continue
    if (edge.wider) for (const candidate of names) closure.add(candidate)
    for (const candidate of edge.dependencies)
      for (const transitive of declaredClosure(candidate)) closure.add(transitive)
  }
  return [...closure].sort()
}
