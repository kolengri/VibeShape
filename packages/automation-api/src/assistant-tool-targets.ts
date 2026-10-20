import { documentIdSchema } from "@vibeshape/domain/identifiers"
import { z } from "zod"
import type { AssistantToolTargets } from "./assistant"
import { isLocalDraftCommand, localFailureSchema, parseMcpToolCall } from "./local-tools"

function localToolName(name: string) {
  return name.replace(/^(?:mcp\.[^.]+\.|mcp__.+__)/, "")
}

/** Extract only schema-owned write identities, never references or result prose. */
export function assistantToolTargets(
  projectId: string,
  name: string | null | undefined,
  input: unknown,
): AssistantToolTargets | undefined {
  const project = documentIdSchema.safeParse(projectId)
  if (!project.success || !name || name.length > 256) return undefined
  const parsed = parseMcpToolCall(localToolName(name), input)
  if (!parsed.success) return undefined
  const operation = parsed.data
  if (operation.projectId !== undefined && operation.projectId !== project.data) return undefined
  if (!isLocalDraftCommand(operation)) return undefined
  const args = operation.arguments
  const targets: AssistantToolTargets = { projectId: project.data, featureIds: [], sketchIds: [] }
  if ("featureId" in args) targets.featureIds = [args.featureId]
  else if (operation.tool === "create_sketch" || operation.tool === "update_sketch")
    targets.sketchIds = [operation.arguments.sketch.id]
  else if ("sketchId" in args) targets.sketchIds = [args.sketchId]
  return targets.featureIds.length || targets.sketchIds.length ? targets : undefined
}

const resultDiagnosticSchema = z.union([
  z.object({ ok: z.literal(false) }),
  z.object({ isError: z.literal(true) }),
  z.object({ result: z.object({ ok: z.literal(false) }) }),
  z.object({ structuredContent: z.object({ ok: z.literal(false) }) }),
  z.object({ structuredContent: z.object({ result: z.object({ ok: z.literal(false) }) }) }),
])

export function assistantToolResultFailed(output: unknown) {
  return resultDiagnosticSchema.safeParse(output).success
}

const displayFailureSchema = z.object({
  ok: localFailureSchema.shape.ok,
  diagnostic: localFailureSchema.shape.diagnostic.partial({ code: true, retryable: true }),
})
const failureDetailsSchema = z.union([
  displayFailureSchema,
  z.object({ result: displayFailureSchema }).transform(({ result }) => result),
  z
    .object({ structuredContent: displayFailureSchema })
    .transform(({ structuredContent }) => structuredContent),
  z
    .object({ structuredContent: z.object({ result: displayFailureSchema }) })
    .transform(({ structuredContent }) => structuredContent.result),
])
const outputContentSchema = z.object({ content: z.array(z.unknown()) })
const textContentSchema = z.object({ type: z.literal("text"), text: z.string() })
const errorDetailsSchema = z.union([
  z.object({ error: z.string() }),
  z.object({
    error: z.object({ message: z.string(), code: z.union([z.string(), z.number()]).optional() }),
  }),
  z.object({ message: z.string(), code: z.union([z.string(), z.number()]).optional() }),
])
const MAX_TOOL_TEXT = 32_000

function meaningfulToolText(text: string) {
  const bounded = text.slice(0, MAX_TOOL_TEXT)
  return bounded.trim() ? bounded : undefined
}

function serializeToolText(value: unknown) {
  try {
    return meaningfulToolText(JSON.stringify(value, null, 2) ?? "")
  } catch {
    return undefined
  }
}

function outputContentText(content: readonly unknown[]) {
  let text = ""
  for (const value of content) {
    const item = textContentSchema.safeParse(value)
    if (!item.success || !item.data.text.trim()) continue
    const separator = text ? "\n" : ""
    text += separator + item.data.text.slice(0, MAX_TOOL_TEXT - text.length - separator.length)
    if (text.length >= MAX_TOOL_TEXT) break
  }
  return meaningfulToolText(text)
}

/** Render known result/error boundaries without searching arbitrary nested fields. */
export function assistantToolResultText(output: unknown): string | undefined {
  if (output == null) return undefined
  if (typeof output === "string") return meaningfulToolText(output)
  if (output instanceof Error) return meaningfulToolText(output.message)
  const failure = failureDetailsSchema.safeParse(output)
  if (failure.success) return serializeToolText(failure.data)
  const content = outputContentSchema.safeParse(output)
  const text = content.success ? outputContentText(content.data.content) : undefined
  if (text) return text
  const error = errorDetailsSchema.safeParse(output)
  if (error.success) return serializeToolText(error.data)
  if (assistantToolResultFailed(output) || content.success) return undefined
  const plain = serializeToolText(output)
  return plain === "{}" || plain === "[]" ? undefined : plain
}
