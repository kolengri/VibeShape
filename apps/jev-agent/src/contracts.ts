import type { Tool } from "@modelcontextprotocol/sdk/types.js"

export type Photo = { mimeType: "image/png" | "image/jpeg"; data: string }
export type Observation = { tool: string; arguments: Record<string, unknown>; result: unknown }
export type DecisionState = {
  goal: string
  instructions: string
  history: Observation[]
  photos: Photo[]
  uncertainOutcome?: Observation
}
export type NextAction =
  | { kind: "done" }
  | { kind: "blocked" }
  | {
      kind: "tool"
      tool: Tool
      arguments: Record<string, unknown>
      omitted?: string[]
      needsArguments: boolean
    }
export type Decision = NextAction & { confidence: number }
export type Decide = (state: DecisionState, tools: Tool[], signal: AbortSignal) => Promise<Decision>
export type ResolveDecision = (
  state: DecisionState,
  tools: Tool[],
  signal: AbortSignal,
) => Promise<NextAction>
export type CompleteArguments = (
  tool: Tool,
  state: DecisionState,
  selected: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>
