import { resolve } from "node:path"
import { sourceClosure, sourceDependencies, workspaceAt } from "./unit-test-dependencies"
import { digest, globalInputs, hashInputs, treeInputs } from "./unit-test-files"
import { loadWorkspaceGraph } from "./workspace-graph"

type Graph = Awaited<ReturnType<typeof loadWorkspaceGraph>>
type Sources = Map<string, Awaited<ReturnType<typeof treeInputs>>>
type Edges = Awaited<ReturnType<typeof sourceDependencies>>

async function workspaceSources(root: string, graph: Graph) {
  const sources: Sources = new Map()
  for (const [name, workspace] of graph.workspaces)
    sources.set(name, await treeInputs(root, [workspace.directory]))
  return sources
}

function scopeInput(
  name: string,
  closure: string[],
  sharedHash: string,
  sources: Sources,
  edges: Edges,
  environment: NodeJS.ProcessEnv,
) {
  const values = Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))
  return {
    hash: digest(
      JSON.stringify([
        sharedHash,
        values,
        closure.map((dependency) => [dependency, hashInputs(sources.get(dependency) ?? [])]),
      ]),
    ),
    cacheable: name !== "$root" && !closure.some((dependency) => edges.get(dependency)?.unsafe),
  }
}

async function nativeFiles(root: string) {
  const files: string[] = []
  for (const directory of ["apps", "packages", "scripts"]) {
    const glob = new Bun.Glob(`${directory}/**/*.test.{ts,tsx}`)
    for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
      if (file.split("/").includes("node_modules")) continue
      if (file.startsWith("apps/remote-mcp/") && file.endsWith(".worker.test.ts")) continue
      files.push(file)
    }
  }
  return files
}

/** Snapshot actual files, including ignored/untracked fixtures and installed WASM bytes. */
export async function unitTestInputs(
  root: string,
  options: string[],
  environment = process.env,
  runtime = `${Bun.version}:${Bun.revision}:${process.platform}:${process.arch}`,
  files?: string[],
) {
  const graph = await loadWorkspaceGraph(root)
  const directories = new Map(
    [...graph.workspaces].map(([name, workspace]) => [name, resolve(root, workspace.directory)]),
  )
  const names = [...directories.keys()].sort()
  const sources = await workspaceSources(root, graph)
  const globals = await globalInputs(root, directories)
  const installations = [
    "node_modules",
    ...[...graph.workspaces.values()].map((workspace) => `${workspace.directory}/node_modules`),
  ]
  const installed = await treeInputs(root, installations, true)
  const sharedHash = digest(
    JSON.stringify([root, hashInputs(globals), hashInputs(installed), runtime, options]),
  )
  const edges = await sourceDependencies(root, sources, globals, installed, directories, {
    files: files ?? (await nativeFiles(root)),
    environment,
  })
  const scopes = new Map<string, { hash: string; cacheable: boolean }>()
  for (const name of [...names, "$root"]) {
    const closure = sourceClosure(name, names, graph.dependencyClosure, edges)
    scopes.set(name, scopeInput(name, closure, sharedHash, sources, edges, environment))
  }
  return {
    scopes,
    workspaceFor: (file: string) => workspaceAt(resolve(root, file), directories) ?? "$root",
  }
}
