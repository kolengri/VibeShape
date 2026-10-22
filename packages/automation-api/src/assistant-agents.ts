import { z } from "zod"

export const assistantExternalAgentSchema = z.strictObject({
  command: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
  args: z
    .array(
      z
        .string()
        .max(4096)
        .refine((value) => !value.includes("\0")),
    )
    .max(64),
})

export const assistantAgentPresets = [
  { id: "claude", command: "claude-agent-acp", args: [] },
  { id: "codex", command: "codex-acp", args: [] },
  { id: "opencode", command: "opencode", args: ["acp"] },
] as const
