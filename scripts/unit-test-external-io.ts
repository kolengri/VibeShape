import * as ts from "typescript/unstable/ast"
import { cacheInputPath } from "./unit-test-files"
import type { runtimePolicy } from "./unit-test-runtime-policy"
import {
  filesystemPath,
  functionProvider,
  literalValue,
  type sourcePathContext,
  unwrapExpression,
} from "./unit-test-source-paths"

type Context = ReturnType<typeof sourcePathContext>
type Policy = ReturnType<typeof runtimePolicy>
const network = /^(?:node:)?(?:https?|http2|net|tls|dgram|dns(?:\/promises)?):|^undici:/
const subprocess = /^(?:node:)?(?:child_process|vm|worker_threads):/
const constructors = /^(?:Worker|SharedWorker|WebSocket|EventSource)$/
const interpreters = /^(?:runPython|runPythonAsync|loadPyodide|loadPackage)$/
const bunReaders = /^(?:file|spawn|spawnSync|dlopen|connect|listen|serve|\$)$/
const executableProviders =
  /:(?:createRequire|getBuiltinModule)$|^bun:(?:spawn|spawnSync|dlopen|connect|listen|serve|\$)$/
const executableNames = /^(?:eval|Function|createRequire|getBuiltinModule)$/
const importDeclarations = new Set([
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamespaceImport,
])

function method(expression: ts.Expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression)
    return literalValue(expression.argumentExpression)
  return undefined
}

function owner(expression: ts.Expression) {
  if (!(ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)))
    return undefined
  return ts.isIdentifier(expression.expression) ? expression.expression.text : undefined
}

function importedProvider(expression: ts.Expression, context: Context) {
  const resolved = functionProvider(expression, context)
  if (resolved) return resolved
  if (ts.isIdentifier(expression)) return context.functions.get(expression.text) ?? ""
  const namespace = owner(expression)
  return `${namespace && context.namespaces.get(namespace)}:${method(expression)}`
}

function nativeFetch(expression: ts.Expression) {
  return (
    (ts.isIdentifier(expression) && expression.text === "fetch") ||
    (method(expression) === "fetch" &&
      /^(?:globalThis|global|window|self)$/.test(owner(expression) ?? ""))
  )
}

function interpreter(expression: ts.Expression, provider: string) {
  const name = ts.isIdentifier(expression) ? expression.text : method(expression)
  return (
    interpreters.test(name ?? "") ||
    /^pyodide:(?:loadPyodide|runPython|runPythonAsync)$/.test(provider)
  )
}

function dangerousBuiltin(expression: ts.Expression, provider: string) {
  const name = ts.isIdentifier(expression) ? expression.text : method(expression)
  if (
    executableNames.test(name ?? "") ||
    method(expression) === "require" ||
    executableProviders.test(provider)
  )
    return true
  return (
    owner(expression) === "Bun" &&
    /^(?:spawn|spawnSync|dlopen|connect|listen|serve|\$)$/.test(method(expression) ?? "")
  )
}

function nativeWorker(expression: ts.Expression, context: Context) {
  if (ts.isIdentifier(expression))
    return (
      /^(?:Worker|SharedWorker)$/.test(expression.text) && !context.bindings.has(expression.text)
    )
  const namespace = owner(expression)
  return (
    /^(?:globalThis|global|window|self)$/.test(namespace ?? "") &&
    !context.bindings.has(namespace ?? "") &&
    /^(?:Worker|SharedWorker)$/.test(method(expression) ?? "")
  )
}

function workerOptions(expression: ts.Expression | undefined) {
  if (!expression) return true
  const value = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(value)) return false
  return value.properties.every((property) => {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false
    if (property.name.text !== "type") return false
    return literalValue(property.initializer) === "module"
  })
}

function factoryConstructor(node: ts.NewExpression, context: Context) {
  const expression = unwrapExpression(node.expression)
  if (!ts.isIdentifier(expression) || !context.workerFactories.has(expression.text)) return false
  return context.bindings.get(expression.text) === 1 && (node.arguments?.length ?? 0) === 0
}

/** Native worker targets retain closure; only argument-free reviewed Vite factories bypass options. */
export function workerConstructor(node: ts.NewExpression, context: Context, policy: Policy) {
  if (factoryConstructor(node, context)) return { safe: true }
  if (!nativeWorker(node.expression, context)) return { safe: false }
  if (policy.workerFactory) return { safe: true }
  if ((node.arguments?.length ?? 0) > 2 || !workerOptions(node.arguments?.[1]))
    return { safe: false }
  const argument = node.arguments?.[0]
  if (!argument || !ts.isNewExpression(unwrapExpression(argument))) return { safe: false }
  const target = filesystemPath(argument, context)
  return target && cacheInputPath(context.root, target) ? { safe: true, target } : { safe: false }
}

export function externalCall(expression: ts.Expression, context: Context, policy: Policy) {
  const provider = importedProvider(expression, context)
  const name = ts.isIdentifier(expression) ? expression.text : method(expression)
  if (
    context.workerFactories.has(name ?? "") ||
    context.workerFactories.has(owner(expression) ?? "")
  )
    return true
  if (constructors.test(name ?? "")) return !(policy.workerFactory && name === "Worker")
  if (nativeFetch(expression)) return !policy.fetch
  if (interpreter(expression, provider)) return !policy.python
  if (subprocess.test(provider)) return !(policy.preparation && provider.endsWith(":execFileSync"))
  return network.test(provider) || dangerousBuiltin(expression, provider)
}

/** Aliases/namespace escapes are unsupported; a direct reviewed call is the only exception. */
export function externalEscape(node: ts.Node, context: Context, policy: Policy) {
  if (ts.isIdentifier(node)) return identifierEscape(node, context, policy)
  if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false
  if (
    /^(?:globalThis|global|window|self)$/.test(owner(node) ?? "") &&
    /^(?:Bun|process|module)$/.test(method(node) ?? "")
  )
    return true
  if (unresolvedGlobal(node, context)) return true
  if (
    (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) &&
    node.parent.expression === node
  )
    return false
  const provider = importedProvider(node, context)
  return (
    network.test(provider) ||
    subprocess.test(provider) ||
    interpreter(node, provider) ||
    nativeFetch(node) ||
    dangerousBuiltin(node, provider) ||
    constructors.test(method(node) ?? "")
  )
}

function unresolvedGlobal(expression: ts.Expression, context: Context) {
  if (method(expression) !== undefined) return false
  const namespace = owner(expression) ?? ""
  return (
    /^(?:globalThis|global|window|self|Bun|module|process)$/.test(namespace) ||
    /^(?:node:)?(?:module|process)$/.test(context.namespaces.get(namespace) ?? "")
  )
}

function declarationOrProperty(node: ts.Identifier) {
  const parent = node.parent
  if (importDeclarations.has(parent.kind)) return true
  if (ts.isVariableDeclaration(parent)) return parent.name === node
  if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node
  return propertyName(node)
}

function propertyName(node: ts.Identifier) {
  const parent = node.parent
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === node
  )
}

function directInvocation(node: ts.Identifier) {
  const parent = node.parent
  return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node
}

function externalBinding(name: string, context: Context) {
  const provider = context.functions.get(name) ?? ""
  return (
    externalProvider(provider) ||
    context.workerFactories.has(name) ||
    interpreters.test(name) ||
    constructors.test(name) ||
    /^(?:fetch|eval|Function)$/.test(name)
  )
}

function externalProvider(provider: string) {
  return (
    network.test(provider) ||
    subprocess.test(provider) ||
    (/^bun:/.test(provider) && bunReaders.test(provider.slice(4))) ||
    /^pyodide:(?:loadPyodide|runPython|runPythonAsync)$/.test(provider) ||
    executableProviders.test(provider)
  )
}

function namespaceEscape(node: ts.Identifier, context: Context, policy: Policy) {
  const parent = node.parent
  const namespace = context.namespaces.get(node.text)
  if (/^(?:globalThis|global|window|self)$/.test(node.text) && !context.bindings.has(node.text))
    return (
      !policy.reflectedGlobals &&
      !(ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    )
  if (!namespace || (!network.test(`${namespace}:`) && !subprocess.test(`${namespace}:`)))
    return false
  return !(ts.isPropertyAccessExpression(parent) && parent.expression === node)
}

function identifierEscape(node: ts.Identifier, context: Context, policy: Policy) {
  if (declarationOrProperty(node) || directInvocation(node)) return false
  return externalBinding(node.text, context) || namespaceEscape(node, context, policy)
}
