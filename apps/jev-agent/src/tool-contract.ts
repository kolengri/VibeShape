import { localToolNameSchema, parseMcpToolCall } from "@vibeshape/automation-api/local-tools"
import { projectToolNames } from "@vibeshape/automation-api/project-tools"
import { localToolAnnotations } from "@vibeshape/automation-api/tool-metadata"
import { z } from "zod"

const projectTools = new Set<string>(projectToolNames)
export function allowedTool(name: string) {
  return (
    name === "read_agent_skill" ||
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
      : allowedTool(name) && parseMcpToolCall(name, args).success
  if (!valid) throw new Error("The selected arguments do not match the VibeShape tool contract.")
}

export function readOnlyTool(name: string) {
  if (name === "read_agent_skill") return true
  const parsed = localToolNameSchema.safeParse(name)
  return parsed.success && localToolAnnotations(parsed.data).readOnlyHint
}
