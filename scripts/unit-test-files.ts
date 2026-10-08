import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises"
import { extname, isAbsolute, join, relative, resolve } from "node:path"

const excludedDirectories = new Set([
  ".git",
  ".turbo",
  ".fallow",
  ".benchmarks",
  "coverage",
  "test-results",
  "playwright-report",
  "__pycache__",
])
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const runtimeDirectories = [".artifacts/structural-runtime", ".artifacts/occt-build/package"]
type FileInput = {
  path: string
  hash: string
  actualPath?: string
  source?: string
  sourcePath?: string
}
type Tree = {
  root: string
  files: FileInput[]
  visited: Set<string>
  installation: boolean
  omitted: Set<string>
}

export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")

export function inside(root: string, path: string) {
  const value = relative(root, path)
  return (
    value === "" ||
    (!value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      value !== ".." &&
      !isAbsolute(value))
  )
}
export function cacheInputPath(root: string, path: string) {
  if (!inside(root, path)) return false
  const input = relative(root, path).replaceAll("\\", "/")
  if (input.split("/").some((part) => excludedDirectories.has(part) || part === "dist"))
    return false
  if (!input.startsWith(".artifacts/")) return true
  return runtimeDirectories.some(
    (directory) => input === directory || input.startsWith(`${directory}/`),
  )
}

async function inputStat(tree: Tree, path: string, label: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    tree.files.push({ path: label, hash: "missing" })
    return undefined
  }
}

function included(tree: Tree, name: string) {
  if (name === ".DS_Store") return false
  return tree.installation || (!excludedDirectories.has(name) && name !== "node_modules")
}

async function directoryInput(tree: Tree, path: string, label: string) {
  const actual = await realpath(path)
  if (tree.visited.has(actual)) return
  tree.visited.add(actual)
  for (const child of (await readdir(path)).sort()) {
    if (included(tree, child)) await walk(tree, join(path, child), `${label}/${child}`)
  }
}

async function linkInput(tree: Tree, path: string, label: string) {
  const target = await readlink(path)
  tree.files.push({ path: label, hash: digest(target.replaceAll(tree.root, "$ROOT")) })
  const actual = await realpath(path)
  // Workspace links are source inputs of their owning package, not global installation inputs.
  if (
    tree.installation &&
    inside(tree.root, actual) &&
    /^(?:apps|packages)\//.test(relative(tree.root, actual))
  )
    return
  await walk(tree, actual, `${label}/$target`)
}

async function fileInput(tree: Tree, path: string, label: string) {
  if (label.endsWith(".tsbuildinfo")) return
  const bytes = await readFile(path)
  const input: FileInput = { path: label, hash: digest(bytes), actualPath: await realpath(path) }
  if (!tree.installation && !label.includes("/dist/") && sourceExtensions.has(extname(path))) {
    input.source = bytes.toString("utf8")
    input.sourcePath = path
  }
  tree.files.push(input)
}

async function walk(tree: Tree, path: string, label: string) {
  if (tree.omitted.has(resolve(path))) return
  const stat = await inputStat(tree, path, label)
  if (!stat) return
  if (stat.isSymbolicLink()) return linkInput(tree, path, label)
  if (stat.isDirectory()) return directoryInput(tree, path, label)
  if (stat.isFile()) return fileInput(tree, path, label)
  throw new Error(`Unsupported unit-cache input: ${label}`)
}

/** Enumerate real contents without Git ignores, following and hashing installation links once. */
export async function treeInputs(
  root: string,
  directories: string[],
  installation = false,
  omitted = new Set<string>(),
) {
  const tree: Tree = { root, files: [], visited: new Set(), installation, omitted }
  for (const directory of directories) await walk(tree, resolve(root, directory), directory)
  return tree.files.sort((left, right) => left.path.localeCompare(right.path))
}

export function hashInputs(files: Awaited<ReturnType<typeof treeInputs>>) {
  return digest(JSON.stringify(files.map(({ path, hash }) => [path, hash])))
}

export async function globalInputs(root: string, workspaceDirectories: Map<string, string>) {
  const directories = (await readdir(root)).filter(
    (name) =>
      !["node_modules", ".artifacts", ".DS_Store"].includes(name) && !excludedDirectories.has(name),
  )
  return treeInputs(
    root,
    [...directories, ...runtimeDirectories],
    false,
    new Set(workspaceDirectories.values()),
  )
}
