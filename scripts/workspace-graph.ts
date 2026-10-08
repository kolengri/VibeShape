import { dirname, isAbsolute, join } from "node:path"
import { z } from "zod"

const packageName = z.string().regex(/^(?:@[^/\\\s#]+\/)?[^/\\\s#]+$/)
const dependencySection = z.record(packageName, z.string().min(1))
const workspacePatterns = z
  .array(
    z
      .string()
      .min(1)
      .refine(
        (pattern) =>
          !isAbsolute(pattern) &&
          !pattern.includes("\\") &&
          !pattern.startsWith("!") &&
          !pattern.split("/").includes(".."),
        "Workspace patterns must stay inside the repository.",
      ),
  )
  .min(1)
const manifestSchema = z.object({
  name: packageName,
  workspaces: z
    .union([
      workspacePatterns,
      z
        .object({ packages: workspacePatterns })
        .passthrough()
        .transform((value) => value.packages),
    ])
    .optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: dependencySection.optional(),
  devDependencies: dependencySection.optional(),
  peerDependencies: dependencySection.optional(),
  optionalDependencies: dependencySection.optional(),
})
type Manifest = z.infer<typeof manifestSchema>

async function readManifest(root: string, path: string) {
  const result = manifestSchema.safeParse(await Bun.file(join(root, path)).json())
  if (!result.success)
    throw new Error(`Invalid workspace manifest ${path}: ${result.error.message}`)
  const manifest = result.data
  if (
    Object.hasOwn(manifest.scripts ?? {}, "source-inputs") ||
    Object.hasOwn(manifest.scripts ?? {}, "transit")
  )
    throw new Error(`${path}: source-inputs and transit are reserved command-free cache tasks.`)
  return manifest
}

function dependencies(
  manifest: Manifest,
  workspaces: Map<string, Manifest & { directory: string }>,
) {
  const fields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const
  const declared = fields.flatMap((field) => Object.entries(manifest[field] ?? {}))
  const missing = declared.filter(
    ([name, version]) => version.startsWith("workspace:") && !workspaces.has(name),
  )
  if (missing.length > 0)
    throw new Error(
      `${manifest.name}: undiscovered workspace dependencies: ${missing.map(([name]) => name).join(", ")}`,
    )
  return [...new Set(declared.map(([name]) => name).filter((name) => workspaces.has(name)))].sort()
}

/** Discover the complete source dependency closure, including peers and cycles. */
export async function loadWorkspaceGraph(root: string) {
  const manifest = await readManifest(root, "package.json")
  if (!manifest.workspaces) throw new Error("The root manifest must declare workspaces.")
  const patterns = manifest.workspaces
  const workspaces = new Map<string, Manifest & { directory: string }>()
  for (const pattern of patterns) {
    const paths = [
      ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root, followSymlinks: false }),
    ].sort()
    if (paths.length === 0) throw new Error(`Workspace pattern matched no manifests: ${pattern}`)
    for (const path of paths) {
      const workspace = await readManifest(root, path)
      if (workspace.name === manifest.name || workspaces.has(workspace.name))
        throw new Error(`Duplicate workspace name ${workspace.name}: ${path}`)
      workspaces.set(workspace.name, { ...workspace, directory: dirname(path) })
    }
  }
  const graph = new Map(
    [...workspaces].map(([name, workspace]) => [name, dependencies(workspace, workspaces)]),
  )
  // Validate root workspace references as well; root script checks consume all workspace sources.
  dependencies(manifest, workspaces)
  function dependencyClosure(name: string) {
    if (!graph.has(name)) throw new Error(`Unknown workspace: ${name}`)
    const visited = new Set<string>()
    const pending = [name]
    for (const dependency of pending) {
      if (visited.has(dependency)) continue
      visited.add(dependency)
      pending.push(...(graph.get(dependency) ?? []))
    }
    return visited
  }
  return { workspaces, dependencyClosure }
}
