import { isBuiltin } from "node:module"
import * as ts from "typescript/unstable/ast"
import type { runtimePolicy } from "./unit-test-runtime-policy"
import { functionProvider, type sourcePathContext } from "./unit-test-source-paths"

type Context = ReturnType<typeof sourcePathContext>
type Policy = ReturnType<typeof runtimePolicy>
const pure = new Set([
  "assert",
  "assert/strict",
  "buffer",
  "crypto",
  "events",
  "path",
  "url",
  "util",
  "util/types",
  "querystring",
  "string_decoder",
  "zlib",
  "bun:test",
])
const modeled = new Set([
  "bun",
  "fs",
  "fs/promises",
  "process",
  "module",
  "child_process",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "dns",
  "dns/promises",
  "vm",
  "worker_threads",
])
const members = new Map([
  [
    "fs",
    new Set([
      "readFile",
      "readFileSync",
      "writeFile",
      "writeFileSync",
      "appendFile",
      "appendFileSync",
      "mkdir",
      "mkdirSync",
      "rm",
      "rmSync",
      "unlink",
      "unlinkSync",
      "promises",
      "constants",
    ]),
  ],
  [
    "fs/promises",
    new Set(["readFile", "writeFile", "appendFile", "mkdir", "rm", "unlink", "constants"]),
  ],
  ["process", new Set(["env", "cwd", "platform", "arch", "version", "versions", "release"])],
  ["module", new Set(["isBuiltin", "builtinModules"])],
  [
    "bun",
    new Set([
      "file",
      "write",
      "env",
      "version",
      "revision",
      "deepEquals",
      "escapeHTML",
      "stringWidth",
      "hash",
      "CryptoHasher",
      "ArrayBufferSink",
      "peek",
    ]),
  ],
])

/** Runtime providers outside the reviewed pure/modeled set cannot seed receipts. */
export function unsupportedBuiltin(specifier: string) {
  const provider = specifier.replace(/^node:/, "")
  if (!specifier.startsWith("bun:") && !specifier.startsWith("node:") && !isBuiltin(specifier))
    return false
  return !pure.has(provider) && !modeled.has(provider)
}

function declarationOrProperty(node: ts.Identifier) {
  const parent = node.parent
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent))
    return true
  if (ts.isVariableDeclaration(parent)) return parent.name === node
  if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node
  return ts.isPropertyAccessExpression(parent) && parent.name === node
}

/** Known providers with external readers admit only explicitly modeled members. */
export function unsupportedBuiltinMember(node: ts.Node, context: Context, policy: Policy) {
  if (ts.isIdentifier(node) && declarationOrProperty(node)) return false
  if (
    !ts.isIdentifier(node) &&
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  )
    return false
  const provider =
    functionProvider(node, context) ??
    (ts.isIdentifier(node) ? context.functions.get(node.text) : undefined)
  if (!provider) return false
  if (policy.memoryReport && provider === "process:memoryUsage") return false
  const separator = provider.lastIndexOf(":")
  const namespace = provider.slice(0, separator).replace(/^node:/, "")
  const admitted = members.get(namespace)
  return admitted !== undefined && !admitted.has(provider.slice(separator + 1))
}
