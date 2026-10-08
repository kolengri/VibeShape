import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as ts from "typescript/unstable/ast"

type StaticValue = string | URL
type Context = {
  root: string
  path: string
  constants: Map<string, ts.Expression | undefined>
  functions: Map<string, string>
  namespaces: Map<string, string>
  bindings: Map<string, number>
  urls: Map<string, Set<ts.Node>>
  workerFactories: Set<string>
}
const providers = new Set([
  "bun",
  "node:fs",
  "node:fs/promises",
  "fs",
  "fs/promises",
  "node:path",
  "path",
  "node:url",
  "url",
  "node:process",
  "process",
  "node:module",
  "module",
  "node:child_process",
  "child_process",
  "node:http",
  "http",
  "node:https",
  "https",
  "node:http2",
  "http2",
  "node:net",
  "net",
  "node:tls",
  "tls",
  "node:dns",
  "node:dgram",
  "dgram",
  "node:dns/promises",
  "dns",
  "dns/promises",
  "undici",
  "pyodide",
  "node:vm",
  "vm",
  "node:worker_threads",
  "worker_threads",
])

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertion(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    return unwrapExpression(expression.expression)
  return expression
}

function importedProvider(expression: ts.Expression) {
  const value = unwrapExpression(expression)
  if (!ts.isCallExpression(value)) return undefined
  if (
    value.expression.kind !== ts.SyntaxKind.ImportKeyword &&
    !(ts.isIdentifier(value.expression) && value.expression.text === "require")
  )
    return undefined
  const argument = value.arguments[0]
  if (!argument || !ts.isStringLiteral(argument) || !providers.has(argument.text)) return undefined
  return argument.text
}

function addBinding(context: Context, name: string) {
  context.bindings.set(name, (context.bindings.get(name) ?? 0) + 1)
}

function bindingNames(context: Context, name: ts.BindingName) {
  if (ts.isIdentifier(name)) {
    addBinding(context, name.text)
    return
  }
  for (const element of name.elements)
    if (ts.isBindingElement(element) && element.name) bindingNames(context, element.name)
}

function namedImports(context: Context, named: ts.NamedImportBindings, provider: string) {
  if (ts.isNamespaceImport(named)) {
    context.namespaces.set(named.name.text, provider)
    return
  }
  for (const binding of named.elements)
    context.functions.set(
      binding.name.text,
      `${provider}:${binding.propertyName?.text ?? binding.name.text}`,
    )
}

function importBindings(context: Context, node: ts.ImportDeclaration) {
  if (!ts.isStringLiteral(node.moduleSpecifier) || !providers.has(node.moduleSpecifier.text)) return
  const provider = node.moduleSpecifier.text
  const clause = node.importClause
  if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return
  if (clause.name) context.namespaces.set(clause.name.text, provider)
  if (clause.namedBindings) namedImports(context, clause.namedBindings, provider)
}

function workerBindings(context: Context, node: ts.ImportDeclaration) {
  if (!ts.isStringLiteral(node.moduleSpecifier) || !node.moduleSpecifier.text.endsWith("?worker"))
    return
  const clause = node.importClause
  if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return
  if (clause.name) context.workerFactories.add(clause.name.text)
  const named = clause.namedBindings
  if (!named) return
  if (ts.isNamespaceImport(named)) context.workerFactories.add(named.name.text)
  else for (const binding of named.elements) context.workerFactories.add(binding.name.text)
}

function destructuredImports(context: Context, name: ts.BindingName, provider: string | undefined) {
  if (!provider || !ts.isObjectBindingPattern(name)) return
  for (const binding of name.elements) {
    if (!binding.name || !ts.isIdentifier(binding.name)) continue
    context.functions.set(
      binding.name.text,
      `${provider}:${binding.propertyName?.getText() ?? binding.name.text}`,
    )
  }
}

function variableBindings(context: Context, node: ts.VariableDeclaration) {
  bindingNames(context, node.name)
  const provider = node.initializer && importedProvider(node.initializer)
  if (ts.isIdentifier(node.name)) {
    if (provider) context.namespaces.set(node.name.text, provider)
    if (node.parent.flags & ts.NodeFlags.Const)
      context.constants.set(node.name.text, node.initializer)
    if (urlInitializer(node.initializer)) {
      const statement = node.parent.parent
      const scope = ts.isVariableStatement(statement) ? statement.parent : statement
      const scopes = context.urls.get(node.name.text) ?? new Set<ts.Node>()
      scopes.add(scope)
      context.urls.set(node.name.text, scopes)
    }
    return
  }
  destructuredImports(context, node.name, provider)
}

function urlInitializer(expression: ts.Expression | undefined) {
  if (!expression) return false
  const value = unwrapExpression(expression)
  return (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "URL"
  )
}

function namedDeclaration(context: Context, node: ts.Node) {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isImportEqualsDeclaration(node)) &&
    node.name
  )
    addBinding(context, node.name.text)
}

function bindings(context: Context, node: ts.Node) {
  if (ts.isImportDeclaration(node)) {
    importBindings(context, node)
    workerBindings(context, node)
  }
  if (ts.isVariableDeclaration(node)) variableBindings(context, node)
  if (ts.isParameterDeclaration(node)) bindingNames(context, node.name)
  namedDeclaration(context, node)
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) addBinding(context, node.name.text)
  if (ts.isImportClause(node) && node.name) addBinding(context, node.name.text)
  node.forEachChild((child) => bindings(context, child))
}

export function sourcePathContext(root: string, path: string, file: ts.SourceFile) {
  const context: Context = {
    root,
    path,
    constants: new Map(),
    functions: new Map(),
    namespaces: new Map(),
    bindings: new Map(),
    urls: new Map(),
    workerFactories: new Set(),
  }
  bindings(context, file)
  return context
}

export function functionProvider(expression: ts.Expression, context: Context): string | undefined {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value) && context.bindings.get(value.text) === 1)
    return context.functions.get(value.text)
  if (ts.isElementAccessExpression(value)) return elementProvider(value, context)
  if (!ts.isPropertyAccessExpression(value)) return undefined
  const imported = importedProvider(value.expression)
  if (imported) return `${imported}:${value.name.text}`
  if (
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === "promises"
  ) {
    const provider = functionProvider(value.expression, context)
    return provider && `${provider.replace(/:promises$/, "/promises")}:${value.name.text}`
  }
  if (!ts.isIdentifier(value.expression)) return undefined
  const namespace = value.expression.text
  const provider = namespaceProvider(namespace, context)
  return provider && `${provider}:${value.name.text}`
}

function elementProvider(expression: ts.ElementAccessExpression, context: Context) {
  if (!ts.isIdentifier(expression.expression) || !expression.argumentExpression) return undefined
  const name = literalValue(unwrapExpression(expression.argumentExpression))
  const provider = namespaceProvider(expression.expression.text, context)
  return name !== undefined && provider ? `${provider}:${name}` : undefined
}

function namespaceProvider(namespace: string, context: Context) {
  if (namespace === "process" && !context.bindings.has(namespace)) return "process"
  if (namespace === "Bun" && !context.bindings.has(namespace)) return "bun"
  return context.bindings.get(namespace) === 1 ? context.namespaces.get(namespace) : undefined
}

function importMeta(expression: ts.Expression, property: string) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === property &&
    ts.isMetaProperty(expression.expression) &&
    expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  )
}

function staticIdentifier(expression: ts.Identifier, context: Context, pending: Set<string>) {
  if (context.bindings.get(expression.text) !== 1 || pending.has(expression.text)) return undefined
  const initializer = context.constants.get(expression.text)
  if (!initializer) return undefined
  const next = new Set(pending).add(expression.text)
  return staticValue(initializer, context, next)
}

function staticUrl(expression: ts.NewExpression, context: Context) {
  if (!ts.isIdentifier(expression.expression) || expression.expression.text !== "URL")
    return undefined
  if (context.bindings.has("URL")) return undefined
  const [argument, base] = expression.arguments ?? []
  if (!argument || !base || !importMeta(base, "url")) return undefined
  const value = literalValue(argument)
  if (value === undefined) return undefined
  return new URL(value, pathToFileURL(context.path))
}

export function literalValue(expression: ts.Expression) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text
  return undefined
}

function globalCwd(expression: ts.Expression, context: Context) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "cwd" &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process" &&
    !context.bindings.has("process")
  )
}

function resolvedPath(
  expression: ts.CallExpression,
  context: Context,
  pending: Set<string>,
  provider: string,
) {
  const values = expression.arguments.map((argument) => staticValue(argument, context, pending))
  if (!values.every((value): value is string => typeof value === "string")) return undefined
  return provider.endsWith(":join")
    ? resolve(context.root, join(...values))
    : resolve(context.root, ...values)
}

function resolvedCall(expression: ts.CallExpression, context: Context, pending: Set<string>) {
  const provider = functionProvider(expression.expression, context) ?? ""
  if (
    globalCwd(unwrapExpression(expression.expression), context) ||
    /^(?:node:)?process:cwd$/.test(provider)
  )
    return context.root
  if (/^(?:node:)?url:fileURLToPath$/.test(provider)) {
    const argument = expression.arguments[0]
    const value = argument && staticValue(argument, context, pending)
    return value instanceof URL && value.protocol === "file:" ? fileURLToPath(value) : undefined
  }
  if (/^(?:node:)?path:(?:resolve|join)$/.test(provider))
    return resolvedPath(expression, context, pending, provider)
  return undefined
}

function moduleValue(value: ts.Expression, context: Context) {
  if (importMeta(value, "url")) return pathToFileURL(context.path)
  if (importMeta(value, "dir") || importMeta(value, "dirname")) return dirname(context.path)
  if (!ts.isIdentifier(value) || context.bindings.has(value.text)) return undefined
  if (value.text === "__dirname") return dirname(context.path)
  if (value.text === "__filename") return context.path
  return undefined
}

function propertyValue(value: ts.Expression, context: Context, pending: Set<string>) {
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "pathname") return undefined
  const url = staticValue(value.expression, context, pending)
  return url instanceof URL && url.protocol === "file:" ? url.pathname : undefined
}

function staticValue(
  expression: ts.Expression,
  context: Context,
  pending: Set<string>,
): StaticValue | undefined {
  const value = unwrapExpression(expression)
  const literal =
    literalValue(value) ?? moduleValue(value, context) ?? propertyValue(value, context, pending)
  if (literal !== undefined) return literal
  if (ts.isIdentifier(value)) return staticIdentifier(value, context, pending)
  if (ts.isNewExpression(value)) return staticUrl(value, context)
  if (ts.isCallExpression(value)) return resolvedCall(value, context, pending)
  return undefined
}

/** Resolve only syntax with a finite module/repository path; mutable and computed values miss. */
export function filesystemPath(expression: ts.Expression, context: Context) {
  const value = staticValue(expression, context, new Set())
  if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : undefined
  return typeof value === "string" ? resolve(context.root, value) : undefined
}
