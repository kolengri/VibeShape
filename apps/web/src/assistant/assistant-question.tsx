import {
  type AssistantQuestion,
  assistantQuestionAnswersMatch,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useState } from "react"

export function AssistantQuestionForm({
  question,
  onAnswer,
}: {
  question: AssistantQuestion
  onAnswer: (answers: Record<string, string> | null) => Promise<boolean>
}) {
  const t = useTranslations("app.assistant")
  const [failed, setFailed] = useState(false)
  const [expired, setExpired] = useState(Date.now() >= question.expiresAt)
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, question.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [question.expiresAt])
  const form = useAppForm({
    defaultValues: { answers: question.fields.map(() => ""), cancelled: false },
    onSubmit: async ({ value, formApi }) => {
      if (Date.now() >= question.expiresAt) return
      setFailed(false)
      const answers = value.cancelled
        ? null
        : Object.fromEntries(
            question.fields.flatMap((field, index) => {
              const answer = value.answers[index] ?? ""
              return !field.required && answer === "" ? [] : [[field.id, answer]]
            }),
          )
      try {
        if (!(await onAnswer(answers))) setFailed(true)
      } catch {
        setFailed(true)
      } finally {
        formApi.setFieldValue("cancelled", false)
      }
    },
  })
  const cancel = async () => {
    if (form.state.isSubmitting || Date.now() >= question.expiresAt) return
    form.setFieldValue("cancelled", true)
    await form.handleSubmit()
  }
  return (
    <details open className="rounded-md border bg-background p-2">
      <summary className="cursor-pointer whitespace-pre-wrap break-words text-sm font-medium">
        {question.message || t("questionTitle")}
      </summary>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <Form
            form={form}
            aria-label={t("questionTitle")}
            className="mt-3 space-y-3"
            aria-busy={pending || undefined}
            onSubmitCapture={(event) => {
              if (!pending && Date.now() < question.expiresAt) return
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            {question.fields.map((questionField, index) => {
              const validate = (value: string, cancelled: boolean) => {
                if (cancelled) return undefined
                const valid = assistantQuestionAnswersMatch(
                  { fields: [questionField] },
                  value === "" ? {} : { [questionField.id]: value },
                )
                return valid ? undefined : t("questionResponseFailed")
              }
              return (
                <form.AppField
                  key={questionField.id}
                  name={`answers[${index}]`}
                  validators={{
                    onSubmit: ({ value, fieldApi }) =>
                      validate(value, fieldApi.form.state.values.cancelled),
                    onChange: ({ value, fieldApi }) =>
                      fieldApi.form.state.submissionAttempts > 0
                        ? validate(value, fieldApi.form.state.values.cancelled)
                        : undefined,
                  }}
                >
                  {(field) =>
                    questionField.options ? (
                      <field.ChoiceField
                        label={questionField.label}
                        description={questionField.description}
                        required={questionField.required}
                        disabled={pending || expired}
                        options={questionField.options.map((option) => ({
                          value: option.id,
                          label: option.name,
                          description: option.description,
                        }))}
                      />
                    ) : (
                      <field.TextField
                        label={questionField.label}
                        description={questionField.description}
                        type={questionField.secret ? "password" : "text"}
                        autoComplete="off"
                        required={questionField.required}
                        minLength={questionField.minLength}
                        maxLength={questionField.maxLength ?? 16_384}
                        disabled={pending || expired}
                      />
                    )
                  }
                </form.AppField>
              )
            })}
            {failed && <Alert>{t("questionResponseFailed")}</Alert>}
            {expired && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("questionExpired")}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={pending || expired}
                onClick={cancel}
              >
                {t("cancelQuestion")}
              </Button>
              <form.SubmitButton size="xs" requireDirty={false} disabled={pending || expired}>
                {t("submitAnswers")}
              </form.SubmitButton>
            </div>
          </Form>
        )}
      </form.Subscribe>
    </details>
  )
}
