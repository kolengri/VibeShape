import {
  assistantQuestionInputSchema,
  assistantQuestionTool,
} from "@vibeshape/automation-api/assistant"
import { localToolNameSchema, parseMcpToolCall } from "@vibeshape/automation-api/local-tools"
import { projectToolNames } from "@vibeshape/automation-api/project-tools"
import { localToolAnnotations } from "@vibeshape/automation-api/tool-metadata"
import { z } from "zod"

const projectTools = new Set<string>(projectToolNames)
const humanWaitTools = new Set<string>([
  assistantQuestionTool.name,
  "commit_draft",
  "commit_assembly_draft",
  "commit_import_upload",
  "commit_planar_import_upload",
  "change_metadata",
  "save_library_definition",
  "update_library_metadata",
  "undo_model",
  "redo_model",
  "create_surface_texture",
  "update_surface_texture",
  "remove_surface_texture",
  "request_lightweighting",
  "request_quick_lightweighting",
])

export function toolTimeoutMs(name: string, operationTimeoutMs: number) {
  // SDK 1.31 requires a timer. CAD gets at least the ten-minute fallback, independent of short provider deadlines.
  return humanWaitTools.has(name) ? 2_147_483_647 : Math.max(600_000, operationTimeoutMs)
}

export function allowedTool(name: string) {
  return (
    name === "read_agent_skill" ||
    name === assistantQuestionTool.name ||
    (localToolNameSchema.safeParse(name).success && !projectTools.has(name))
  )
}
const skillInput = z.object({ uri: z.string().min(1).max(256).optional() }).strict()
export function validateToolInput(name: string, args: unknown) {
  if (Buffer.byteLength(JSON.stringify(args)) > 192 * 1024)
    throw new Error("The selected arguments exceed the VibeShape operation budget.")
  const valid =
    name === "read_agent_skill"
      ? skillInput.safeParse(args).success
      : name === assistantQuestionTool.name
        ? assistantQuestionInputSchema.safeParse(args).success
        : allowedTool(name) && parseMcpToolCall(name, args).success
  if (!valid) throw new Error("The selected arguments do not match the VibeShape tool contract.")
}

export function readOnlyTool(name: string) {
  if (name === "read_agent_skill" || name === assistantQuestionTool.name) return true
  const parsed = localToolNameSchema.safeParse(name)
  return parsed.success && localToolAnnotations(parsed.data).readOnlyHint
}
