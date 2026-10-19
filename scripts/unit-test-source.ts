import { resolve } from "node:path"
import * as ts from "typescript/unstable/ast"
import { unsupportedBuiltin, unsupportedBuiltinMember } from "./unit-test-builtins"
import { externalCall, externalEscape, workerConstructor } from "./unit-test-external-io"
import { inside, type treeInputs } from "./unit-test-files"
import { filesystemCall, readerEscape, unsupportedRead } from "./unit-test-readers"
import { runtimePolicy } from "./unit-test-runtime-policy"
import {
  filesystemPath,
  literalValue,
  sourcePathContext,
  unwrapExpression,
} from "./unit-test-source-paths"

type Input = Awaited<ReturnType<typeof treeInputs>>[number]
type Analysis = { imports: Set<string>; files: Set<string>; unsafe: boolean }
type Context = ReturnType<typeof sourcePathContext>
type Policy = ReturnType<typeof runtimePolicy> & { reader: boolean; loader: boolean }
const reviewedLoaders = new Map([
  [
    "packages/geometry-worker/src/occt-primitives-kernel.test.ts",
    "a8748d1017dc539eae631911180c69b31c27465af48eafecdb8ff215807d71f3",
  ],
  [
    "packages/structural-optimization/src/worker.ts",
    "ddba07df02a1d3f4dfb051930bf5ea87c80597a01abd480339b10a5a56b0977b",
  ],
  [
    "packages/structural-optimization/src/quick-worker.ts",
    "a04578ee9f8b163beff0fff1342f87d09fb7ea103c97faf0256cd29bd587e0c7",
  ],
])

function reviewedReader(input: Input, hashes: Map<string, string>) {
  if (reviewedLoaders.get(input.path) === input.hash) return true
  if (
    input.path === "packages/formats/src/text-outline/text-outline.test.ts" &&
    input.hash === "7327184842ec2450b0660cf8d64b72cbbaa2cb14977c42156a0eb9a1c0a28324"
  )
    return true
  return (
    input.path === "packages/geometry-worker/src/engine-import-kernel.test.ts" &&
    input.hash === "5624a3f881248fc6a16aab07027bc5a1cf6302a2eb2518f20346650f74acfe70" &&
    hashes.get("packages/geometry-worker/src/engine.ts") ===
      "6891d9089daa8385eefb28a6f22c0c2a860bca527cdfd5537bfc6caf4a92ee3c"
  )
}

function importValue(expression: ts.Expression) {
  const value = unwrapExpression(expression)
  const literal = literalValue(value)
  if (literal !== undefined) return literal.split("?")[0]
  if (ts.isTemplateExpression(value) && value.head.text.includes("?"))
    return value.head.text.split("?")[0]
  return undefined
}

function addImport(expression: ts.Expression | undefined, analysis: Analysis, reviewed: boolean) {
  const specifier = expression && importValue(expression)
  if (specifier === undefined) {
    analysis.unsafe ||= !reviewed
    return
  }
  analysis.imports.add(specifier)
}

function workerModule(expression: ts.Expression | undefined) {
  if (!expression) return false
  const value = unwrapExpression(expression)
  return (literalValue(value) ?? (ts.isTemplateExpression(value) ? value.head.text : "")).includes(
    "?worker",
  )
}

function staticImport(node: ts.ImportDeclaration, analysis: Analysis) {
  if (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return
  if (workerModule(node.moduleSpecifier))
    analysis.unsafe ||=
      !literalValue(node.moduleSpecifier)?.endsWith("?worker") ||
      node.importClause?.namedBindings !== undefined
  addImport(node.moduleSpecifier, analysis, false)
}

function moduleDeclaration(node: ts.Node, analysis: Analysis) {
  if (ts.isImportDeclaration(node)) staticImport(node, analysis)
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
    analysis.unsafe ||= workerModule(node.moduleSpecifier)
    addImport(node.moduleSpecifier, analysis, false)
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    analysis.unsafe ||= workerModule(node.moduleReference.expression)
    addImport(node.moduleReference.expression, analysis, false)
  }
}

function callNode(node: ts.CallExpression, analysis: Analysis, context: Context, policy: Policy) {
  const value = unwrapExpression(node.expression)
  analysis.unsafe ||= unsupportedRead(node, context)
  analysis.unsafe ||= externalCall(value, context, policy)
  if (value.kind === ts.SyntaxKind.ImportKeyword) {
    analysis.unsafe ||= workerModule(node.arguments[0])
    addImport(node.arguments[0], analysis, policy.loader)
  }
  if (ts.isIdentifier(value) && value.text === "require") {
    analysis.unsafe ||= context.bindings.has("require")
    analysis.unsafe ||= workerModule(node.arguments[0])
    addImport(node.arguments[0], analysis, false)
  }
  filesystemCall(node, analysis, context, policy.reader)
}

function moduleBase(base: ts.Expression | undefined) {
  return (
    base &&
    ts.isPropertyAccessExpression(base) &&
    base.name.text === "url" &&
    ts.isMetaProperty(base.expression) &&
    base.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  )
}

function moduleUrl(node: ts.NewExpression, analysis: Analysis, context: Context) {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "URL") return
  const [argument, base] = node.arguments ?? []
  if (!moduleBase(base)) return
  const literal = argument && literalValue(argument)
  // Computed URL construction is not a filesystem read; actual reader arguments still fail closed.
  if (literal === undefined || directoryUrl(literal)) return
  const target = filesystemPath(node, context)
  if (target) analysis.files.add(target)
  else analysis.unsafe = true
}

function directoryUrl(literal: string) {
  return literal.endsWith("/") || [".", ".."].includes(literal)
}

function visit(node: ts.Node, analysis: Analysis, context: Context, policy: Policy) {
  analysis.unsafe ||= readerEscape(node, context)
  analysis.unsafe ||= unsupportedBuiltinMember(node, context, policy)
  analysis.unsafe ||= externalEscape(node, context, policy)
  moduleDeclaration(node, analysis)
  if (ts.isCallExpression(node)) callNode(node, analysis, context, policy)
  if (ts.isNewExpression(node)) {
    const worker = workerConstructor(node, context, policy)
    if (worker.target) analysis.files.add(worker.target)
    analysis.unsafe ||= !worker.safe && externalCall(node.expression, context, policy)
    moduleUrl(node, analysis, context)
  }
  node.forEachChild((child) => visit(child, analysis, context, policy))
}

/** AST-based module/read boundaries; unresolved external reads and loaders fail closed. */
export function sourceAnalysis(
  root: string,
  input: Input,
  file: ts.SourceFile | undefined,
  hashes = new Map<string, string>(),
  environment = process.env,
): Analysis {
  const analysis: Analysis = { imports: new Set(), files: new Set(), unsafe: false }
  if (input.source === undefined) return analysis
  const path = input.sourcePath ?? resolve(root, input.path)
  analysis.unsafe =
    !inside(root, path) ||
    /\b(?:GITHUB_|RUNNER_|ACTIONS_|CODEX_|AGENT_|TURBO_|AI_AGENT\b)/.test(input.source) ||
    /\bhomedir\s*\(/.test(input.source)
  if (!file) {
    analysis.unsafe = true
    return analysis
  }
  const context = sourcePathContext(root, path, file)
  visit(file, analysis, context, {
    ...runtimePolicy(input, hashes, root, environment),
    reader: reviewedReader(input, hashes),
    loader: reviewedLoaders.get(input.path) === input.hash,
  })
  analysis.unsafe ||= [...analysis.imports].some(unsupportedBuiltin)
  return analysis
}
