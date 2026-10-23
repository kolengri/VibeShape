import { assemblyDraftStateSchema } from "@vibeshape/automation-api/assembly-tools"
import {
  assistantQuestionAnswersMatch,
  assistantQuestionInputSchema,
  assistantQuestionTool,
} from "@vibeshape/automation-api/assistant"
import { restoredDraftViewSchema } from "@vibeshape/automation-api/draft-recovery"
import { automationDraftStateSchema } from "@vibeshape/automation-api/drafts"
import { z } from "zod"
import type { DecisionState, Observation } from "./contracts"

const draftResult = z.object({
  result: z.object({
    ok: z.literal(true),
    value: z.union([automationDraftStateSchema, assemblyDraftStateSchema, restoredDraftViewSchema]),
  }),
})
const acceptedReply = z.object({
  action: z.literal("accept"),
  content: z.record(z.string(), z.string()),
})

function questionKey(args: unknown) {
  const parsed = assistantQuestionInputSchema.safeParse(args)
  return parsed.success ? JSON.stringify(parsed.data) : undefined
}

export function createSessionContext() {
  const state: NonNullable<DecisionState["session"]> = {
    requests: [],
    answeredQuestions: [],
    readSkills: [],
  }
  const turnAnswers = new Map<string, unknown>()
  function rememberQuestion(observation: Observation) {
    const input = assistantQuestionInputSchema.safeParse(observation.arguments)
    const reply = acceptedReply.safeParse(observation.result)
    if (
      input.success &&
      reply.success &&
      assistantQuestionAnswersMatch(input.data, reply.data.content)
    ) {
      const key = JSON.stringify(input.data)
      turnAnswers.set(key, observation.result)
      const previous = state.answeredQuestions.findIndex(
        (item) => questionKey(item.arguments) === key,
      )
      if (previous !== -1) state.answeredQuestions.splice(previous, 1)
      state.answeredQuestions.push(observation)
    }
  }
  function rememberDraft(observation: Observation) {
    const draft = draftResult.safeParse(observation.result)
    if (draft.success) {
      const value = draft.data.result.value
      state.activeDraft = {
        tool: observation.tool,
        arguments: { draftId: "draft" in value ? value.draft.draftId : value.draftId },
        result: draft.data,
      }
    }
    if (
      ["commit_draft", "discard_draft", "commit_assembly_draft", "discard_assembly_draft"].includes(
        observation.tool,
      ) &&
      observation.arguments.draftId === state.activeDraft?.arguments.draftId
    )
      delete state.activeDraft
  }
  return {
    state,
    begin() {
      turnAnswers.clear()
    },
    answer(args: unknown) {
      const key = questionKey(args)
      return key === undefined ? undefined : turnAnswers.get(key)
    },
    remember(observation: Observation) {
      if (observation.tool === assistantQuestionTool.name) rememberQuestion(observation)
      rememberDraft(observation)
      if (
        observation.tool === "read_agent_skill" &&
        typeof observation.arguments.uri === "string" &&
        !state.readSkills.includes(observation.arguments.uri)
      )
        state.readSkills.push(observation.arguments.uri)
    },
  }
}
