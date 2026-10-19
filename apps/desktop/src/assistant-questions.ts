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
  type AssistantSnapshot,
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

function validAnswers(request: AssistantQuestion, answers: Record<string, string>) {
  const fields = new Map(request.fields.map((field) => [field.id, field]))
  if (Object.keys(answers).some((id) => !fields.has(id))) return false
  return request.fields.every((field) => {
    const value = answers[field.id]
    if (value === undefined) return !field.required
    return (
      value.length >= (field.minLength ?? 0) &&
      value.length <= (field.maxLength ?? 16_384) &&
      (!field.options || field.options.some((option) => option.id === value))
    )
  })
}

export function createAssistantQuestions(
  snapshot: AssistantSnapshot,
  emit: (event: AssistantEvent) => void,
  timeoutMs: number,
) {
  const pending = new Map<
    string,
    { question: AssistantQuestion; settle: (answers: Record<string, string> | null) => void }
  >()
  const scope = { projectId: snapshot.projectId, sessionToken: snapshot.sessionToken }
  return {
    request(
      params: CreateElicitationRequest,
      signal: AbortSignal,
    ): Promise<CreateElicitationResponse> {
      const request = question(params, timeoutMs)
      if (!request || signal.aborted || pending.size >= 4)
        return Promise.resolve({ action: "decline" })
      return new Promise((resolve) => {
        const abort = () => settle(null)
        const settle = (answers: Record<string, string> | null) => {
          if (!pending.delete(request.requestId)) return
          clearTimeout(timer)
          signal.removeEventListener("abort", abort)
          resolve(answers === null ? { action: "cancel" } : { action: "accept", content: answers })
          emit({ ...scope, type: "question-resolved", requestId: request.requestId })
        }
        const timer = setTimeout(abort, timeoutMs)
        pending.set(request.requestId, { question: request, settle })
        signal.addEventListener("abort", abort, { once: true })
        emit({ ...scope, type: "question", question: request })
      })
    },
    respond(requestId: string, answers: Record<string, string> | null) {
      const entry = pending.get(requestId)
      if (!entry || (answers !== null && !validAnswers(entry.question, answers))) return false
      entry.settle(answers)
      return true
    },
    cancel() {
      for (const entry of pending.values()) entry.settle(null)
    },
  }
}
