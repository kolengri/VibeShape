import * as ts from "typescript/unstable/ast"
import { cacheInputPath } from "./unit-test-files"
import {
  filesystemPath,
  functionProvider,
  literalValue,
  type sourcePathContext,
  unwrapExpression,
} from "./unit-test-source-paths"

type Context = ReturnType<typeof sourcePathContext>
type Analysis = { files: Set<string>; unsafe: boolean }
const fsProvider = (provider: string) => /^(?:node:)?fs(?:\/promises)?:/.test(provider)
const fileProvider = (provider: string) =>
  provider === "bun:file" || /^(?:node:)?fs(?:\/promises)?:readFile(?:Sync)?$/.test(provider)

function methodName(value: ts.Expression) {
  if (ts.isPropertyAccessExpression(value)) return value.name.text
  if (ts.isElementAccessExpression(value) && value.argumentExpression)
    return literalValue(value.argumentExpression)
  return undefined
}

function namespace(value: ts.Expression) {
  if (!(ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)))
    return undefined
  return ts.isIdentifier(value.expression) ? value.expression.text : undefined
}

function ambiguousReader(value: ts.Expression, context: Context) {
  if (ts.isIdentifier(value))
    return (
      fileProvider(context.functions.get(value.text) ?? "") && !functionProvider(value, context)
    )
  const owner = namespace(value)
  return (
    owner !== undefined &&
    /^(?:readFile|readFileSync)$/.test(methodName(value) ?? "") &&
    fsProvider(`${context.namespaces.get(owner) ?? ""}:`) &&
    !functionProvider(value, context)
  )
}

function filesystemReader(expression: ts.Expression, context: Context) {
  const value = unwrapExpression(expression)
  if (namespace(value) === "Bun" && methodName(value) === "file") return true
  if (fileProvider(functionProvider(value, context) ?? "")) return true
  if (ambiguousReader(value, context)) return true
  return ts.isIdentifier(value) && /^(?:readFile|readFileSync)$/.test(value.text)
}

function declarationName(node: ts.Identifier) {
  const parent = node.parent
  return (
    (ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
    parent.name === node
  )
}

function propertyName(node: ts.Identifier) {
  const parent = node.parent
  if (
    ts.isPropertyAccessExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent)
  )
    return parent.name === node
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent))
    return parent.propertyName === node
  return false
}

function readerBinding(name: string, context: Context) {
  const provider = context.functions.get(name) ?? ""
  return (
    fsProvider(provider) ||
    provider === "bun:file" ||
    provider.endsWith(":createRequire") ||
    name === "require"
  )
}

function globalEscape(node: ts.Identifier, context: Context) {
  if (context.bindings.has(node.text)) return undefined
  const parent = node.parent
  if (node.text === "URL") return !(ts.isNewExpression(parent) && parent.expression === node)
  if (node.text === "Bun")
    return !(ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
  if (node.text === "process" || node.text === "module")
    return !(ts.isPropertyAccessExpression(parent) && parent.expression === node)
  return undefined
}

function namespaceEscape(node: ts.Identifier, context: Context) {
  const global = globalEscape(node, context)
  if (global !== undefined) return global
  const parent = node.parent
  if (
    !/^(?:node:)?(?:fs(?:\/promises)?|path|url|process|module|bun)$/.test(
      context.namespaces.get(node.text) ?? "",
    )
  )
    return false
  return !(ts.isPropertyAccessExpression(parent) && parent.expression === node)
}

function identifierEscape(node: ts.Identifier, context: Context) {
  if (declarationName(node) || propertyName(node)) return false
  const parent = node.parent
  if (readerBinding(node.text, context))
    return !(ts.isCallExpression(parent) && parent.expression === node)
  const url = urlEscape(node, context)
  if (url !== undefined) return url
  return namespaceEscape(node, context)
}

function urlEscape(node: ts.Identifier, context: Context) {
  if (!urlScope(node, context)) return undefined
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return false
  if (nativeUrl(parent)) return false
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return true
  return (
    !filesystemReader(parent.expression, context) &&
    !/^(?:node:)?url:fileURLToPath$/.test(functionProvider(parent.expression, context) ?? "")
  )
}

function urlScope(node: ts.Identifier, context: Context) {
  const scopes = context.urls.get(node.text)
  if (!scopes) return false
  let ancestor: ts.Node | undefined = node
  while (ancestor) {
    if (scopes.has(ancestor)) return true
    ancestor = ancestor.parent
  }
  return false
}

function nativeUrl(node: ts.Node) {
  return (
    ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL"
  )
}

function mutatedUrl(node: ts.Expression, context: Context) {
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false
  if (!ts.isIdentifier(node.expression) || !urlScope(node.expression, context)) return false
  const parent = node.parent
  if (ts.isBinaryExpression(parent) && parent.left === node)
    return ts.isAssignmentOperator(parent.operatorToken.kind)
  return (
    ts.isDeleteExpression(parent) ||
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent)
  )
}

/** Unsupported aliases/namespace escapes cannot hide a filesystem read behind another name. */
export function readerEscape(node: ts.Node, context: Context) {
  if (ts.isIdentifier(node)) return identifierEscape(node, context)
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false
  if (mutatedUrl(node, context)) return true
  if (ts.isCallExpression(node.parent) && node.parent.expression === node) return false
  if (filesystemReader(node, context)) return true
  const provider = functionProvider(node, context) ?? ""
  if (
    !fsProvider(provider) &&
    !/^(?:node:)?(?:path:(?:resolve|join)|url:fileURLToPath|process:cwd)$/.test(provider)
  )
    return false
  return !(methodName(node) === "promises" && ts.isPropertyAccessExpression(node.parent))
}

export function unsupportedRead(node: ts.CallExpression, context: Context) {
  const provider = functionProvider(node.expression, context) ?? ""
  if (provider.endsWith(":createRequire")) return true
  if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "chdir")
    return true
  return (
    fsProvider(provider) &&
    /:(?:open|openSync|createReadStream|read|readSync|readv|readvSync|readdir|readdirSync|stat|statSync|lstat|lstatSync|access|accessSync|exists|existsSync|realpath|realpathSync|readlink|readlinkSync|opendir|opendirSync|glob|globSync|watch|watchFile)$/.test(
      provider,
    )
  )
}

export function filesystemCall(
  node: ts.CallExpression,
  analysis: Analysis,
  context: Context,
  reviewed: boolean,
) {
  if (!filesystemReader(node.expression, context)) return
  if (ambiguousReader(unwrapExpression(node.expression), context)) {
    analysis.unsafe = true
    return
  }
  const argument = node.arguments[0]
  const target = argument && filesystemPath(argument, context)
  if (!target) {
    analysis.unsafe ||= !reviewed
    return
  }
  analysis.unsafe ||= !cacheInputPath(context.root, target)
  analysis.files.add(target)
}
