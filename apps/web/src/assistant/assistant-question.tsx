import {
  type AssistantQuestion,
  assistantQuestionAnswersMatch,
} from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { ChoiceField } from "@vibeshape/ui/components/choice-field"
import { Textarea } from "@vibeshape/ui/components/textarea"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useId, useRef, useState } from "react"

export function AssistantQuestionForm({
  question,
  onAnswer,
}: {
  question: AssistantQuestion
  onAnswer: (answers: Record<string, string> | null) => Promise<boolean>
}) {
  const t = useTranslations("app.assistant")
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [answerModes, setAnswerModes] = useState<Record<string, "choice" | "custom">>({})
  const heading = useRef<HTMLHeadingElement>(null)
  const customId = useId()
  const questionField = question.fields[index]
  const last = index === question.fields.length - 1
  useEffect(() => {
    heading.current?.focus()
  }, [index])
  const form = useAppForm({
    defaultValues: { answers: question.fields.map(() => ""), cancelled: false },
    onSubmit: async ({ value, formApi }) => {
      setFailed(false)
      if (!value.cancelled && !last) {
        setIndex((current) => current + 1)
        return
      }
      const answers = value.cancelled
        ? null
        : Object.fromEntries(
            question.fields.flatMap((field, position) => {
              const answer = value.answers[position] ?? ""
              return !field.required && answer === "" ? [] : [[field.id, answer]]
            }),
          )
      if (answers !== null && !assistantQuestionAnswersMatch(question, answers)) {
        setIndex(
          question.fields.findIndex(
            (field) => !assistantQuestionAnswersMatch({ fields: [field] }, answers),
          ),
        )
        setFailed(true)
        return
      }
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
    if (form.state.isSubmitting) return
    form.setFieldValue("cancelled", true)
    await form.handleSubmit()
  }
  if (!questionField) return null
  const custom = answerModes[questionField.id] === "custom"
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Form
          form={form}
          aria-label={t("questionTitle")}
          className="space-y-3 p-3"
          aria-busy={pending || undefined}
          onSubmitCapture={(event) => {
            if (!pending) return
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <h3
            ref={heading}
            tabIndex={-1}
            className="whitespace-pre-wrap break-words text-sm font-medium outline-none"
          >
            {question.message || t("questionTitle")}
          </h3>
          {question.fields.length > 1 && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("questionProgress", { current: index + 1, total: question.fields.length })}
            </p>
          )}
          <form.AppField
            key={questionField.id}
            name={`answers[${index}]`}
            validators={{
              onSubmit: ({ value, fieldApi }) =>
                fieldApi.form.state.values.cancelled ||
                assistantQuestionAnswersMatch(
                  { fields: [questionField] },
                  value === "" ? {} : { [questionField.id]: value },
                )
                  ? undefined
                  : t("questionResponseFailed"),
            }}
          >
            {(field) =>
              questionField.options ? (
                <>
                  <ChoiceField
                    name={field.name}
                    label={questionField.label}
                    description={questionField.description}
                    disabled={pending}
                    value={custom ? "" : field.state.value}
                    onValueChange={(value) => {
                      setAnswerModes((current) => ({ ...current, [questionField.id]: "choice" }))
                      field.handleChange(value)
                    }}
                    onBlur={field.handleBlur}
                    error={field.state.meta.errors.join(" ")}
                    options={questionField.options.map((option) => ({
                      value: option.id,
                      label: option.name,
                      description: option.description,
                    }))}
                  />
                  {questionField.allowCustomAnswer && !questionField.secret && (
                    <div className="space-y-1">
                      <label htmlFor={customId} className="text-xs text-muted-foreground">
                        {t("customAnswer", { label: questionField.label })}
                      </label>
                      <Textarea
                        id={customId}
                        className="field-sizing-content min-h-16 max-h-40 resize-none"
                        value={custom ? field.state.value : ""}
                        maxLength={questionField.maxLength ?? 16_384}
                        disabled={pending}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          setAnswerModes((current) => ({
                            ...current,
                            [questionField.id]: "custom",
                          }))
                          field.handleChange(event.currentTarget.value)
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            (event.metaKey || event.ctrlKey) &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault()
                            void form.handleSubmit()
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <field.TextField
                  label={questionField.label}
                  description={questionField.description}
                  type={questionField.secret ? "password" : "text"}
                  autoComplete="off"
                  required={questionField.required}
                  minLength={questionField.minLength}
                  maxLength={questionField.maxLength ?? 16_384}
                  disabled={pending}
                />
              )
            }
          </form.AppField>
          {failed && <Alert>{t("questionResponseFailed")}</Alert>}
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={cancel}>
              {t("cancelQuestion")}
            </Button>
            {index > 0 && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => setIndex((current) => current - 1)}
              >
                {t("previousQuestion")}
              </Button>
            )}
            <form.SubmitButton size="xs" requireDirty={false} disabled={pending}>
              {t(last ? "submitAnswers" : "nextQuestion")}
            </form.SubmitButton>
          </div>
        </Form>
      )}
    </form.Subscribe>
  )
}
