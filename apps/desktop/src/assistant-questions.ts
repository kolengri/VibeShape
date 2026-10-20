import { randomUUID } from "node:crypto"
import {
  CreateElicitationRequest,
  type CreateElicitationResponse,
  ElicitationPropertySchema,
  type StringPropertySchema,
} from "@agentclientprotocol/sdk"
import {
  type AssistantEvent,
  type AssistantQuestion,
  type AssistantQuestionInput,
  type AssistantQuestionReply,
  type AssistantSnapshot,
  assistantQuestionAnswersMatch,
  assistantQuestionInputSchema,
  assistantQuestionSchema,
} from "@vibeshape/automation-api/assistant"
import { z } from "zod"

const secretMetadata = z.object({
  codex: z.object({ isSecret: z.boolean().optional() }).optional(),
})

function questionChoices(field: StringPropertySchema) {
  return (
    field.oneOf?.map((option) => ({
      id: option.const,
      name: option.title ?? option.const,
      description: option.description ?? undefined,
    })) ?? field.enum?.map((value) => ({ id: value, name: value }))
  )
}

function questionBounds(field: StringPropertySchema) {
  return { minLength: field.minLength ?? 0, maxLength: Math.min(field.maxLength ?? 16_384, 16_384) }
}

function questionField(id: string, field: ElicitationPropertySchema, required: boolean) {
  if (!ElicitationPropertySchema.isString(field) || field.pattern || field.format) return null
  const metadata = secretMetadata.safeParse(field._meta)
  return {
    id,
    label: field.title ?? id,
    description: field.description ?? undefined,
    required,
    secret: metadata.success && metadata.data.codex?.isSecret === true,
    options: questionChoices(field),
    ...questionBounds(field),
  }
}

function question(params: CreateElicitationRequest, timeoutMs: number): AssistantQuestion | null {
  if (!CreateElicitationRequest.isForm(params)) return null
  const required = new Set(params.requestedSchema.required ?? [])
  const fields = Object.entries(params.requestedSchema.properties ?? {}).map(([id, field]) =>
    questionField(id, field, required.has(id)),
  )
  const parsed = assistantQuestionSchema.safeParse({
    requestId: randomUUID(),
    message: params.message,
    expiresAt: Date.now() + timeoutMs,
    fields,
  })
  return parsed.success ? parsed.data : null
}

export function createAssistantQuestions(
  snapshot: AssistantSnapshot,
  emit: (event: AssistantEvent) => void,
  timeoutMs: number,
) {
  const pending = new Map<
    string,
    {
      question: AssistantQuestion
      settle: (answers: Record<string, string> | null, reason?: "expired" | "cancelled") => void
    }
  >()
  const scope = { projectId: snapshot.projectId, sessionToken: snapshot.sessionToken }
  function enqueue(
    request: AssistantQuestion | null,
    signal: AbortSignal,
  ): Promise<AssistantQuestionReply> {
    if (!request || signal.aborted || pending.size >= 4)
      return Promise.resolve({ action: "decline" })
    return new Promise((resolve) => {
      const abort = () => settle(null)
      const settle = (
        answers: Record<string, string> | null,
        reason: "expired" | "cancelled" = "cancelled",
      ) => {
        if (!pending.delete(request.requestId)) return
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        resolve(answers === null ? { action: "cancel" } : { action: "accept", content: answers })
        emit({
          ...scope,
          type: "question-resolved",
          requestId: request.requestId,
          reason: answers === null ? reason : "answered",
        })
      }
      const timer = setTimeout(() => settle(null, "expired"), timeoutMs)
      pending.set(request.requestId, { question: request, settle })
      signal.addEventListener("abort", abort, { once: true })
      emit({ ...scope, type: "question", question: request })
      if (signal.aborted) abort()
    })
  }
  return {
    request(
      params: CreateElicitationRequest,
      signal: AbortSignal,
    ): Promise<CreateElicitationResponse> {
      return enqueue(question(params, timeoutMs), signal)
    },
    requestInput(input: AssistantQuestionInput, signal: AbortSignal) {
      const parsed = assistantQuestionInputSchema.safeParse(input)
      return enqueue(
        parsed.success
          ? {
              ...parsed.data,
              requestId: randomUUID(),
              expiresAt: Date.now() + timeoutMs,
            }
          : null,
        signal,
      )
    },
    hasPending() {
      return pending.size > 0
    },
    respond(requestId: string, answers: Record<string, string> | null) {
      const entry = pending.get(requestId)
      if (!entry) return false
      if (Date.now() >= entry.question.expiresAt) {
        entry.settle(null, "expired")
        return false
      }
      if (answers !== null && !assistantQuestionAnswersMatch(entry.question, answers)) return false
      entry.settle(answers)
      return true
    },
    cancel() {
      for (const entry of pending.values()) entry.settle(null)
    },
  }
}
