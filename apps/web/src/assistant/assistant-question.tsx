import type { AssistantQuestion } from "@vibeshape/automation-api/assistant"
import { useTranslations } from "@vibeshape/i18n"
import { useReportActivity } from "@vibeshape/ui/components/activity"
import { Button } from "@vibeshape/ui/components/button"
import { Input } from "@vibeshape/ui/components/input"
import { type FormEvent, useEffect, useId, useRef, useState } from "react"

export function AssistantQuestionForm({
  question,
  onAnswer,
}: {
  question: AssistantQuestion
  onAnswer: (answers: Record<string, string> | null) => Promise<boolean>
}) {
  const t = useTranslations("app.assistant")
  const id = useId()
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expired, setExpired] = useState(Date.now() >= question.expiresAt)
  useReportActivity(pending)
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, question.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [question.expiresAt])
  const answer = async (answers: Record<string, string> | null) => {
    if (lock.current || Date.now() >= question.expiresAt) return
    lock.current = true
    setPending(true)
    setFailed(false)
    try {
      if (!(await onAnswer(answers))) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const answers = Object.fromEntries(
      question.fields.flatMap((field) => {
        const value = String(data.get(field.id) ?? "")
        return !field.required && value === "" ? [] : [[field.id, value]]
      }),
    )
    void answer(answers)
  }
  return (
    <details open className="rounded-md border bg-background p-2">
      <summary className="cursor-pointer whitespace-pre-wrap break-words text-sm font-medium">
        {question.message || t("questionTitle")}
      </summary>
      <form aria-label={t("questionTitle")} className="mt-3 space-y-3" onSubmit={submit}>
        {question.fields.map((field, index) => {
          const fieldId = `${id}-${index}`
          const descriptionId = field.description ? `${fieldId}-description` : undefined
          return (
            <fieldset key={field.id} disabled={pending || expired} className="min-w-0 space-y-1">
              <legend className="text-xs font-medium">{field.label}</legend>
              {field.description && (
                <p id={descriptionId} className="text-xs text-muted-foreground">
                  {field.description}
                </p>
              )}
              {field.options ? (
                <div className="flex flex-wrap gap-1">
                  {field.options.map((option) => (
                    <label key={option.id} className="min-w-0 cursor-pointer">
                      <input
                        type="radio"
                        className="peer sr-only"
                        name={field.id}
                        value={option.id}
                        required={field.required}
                        aria-describedby={descriptionId}
                        aria-label={option.name}
                      />
                      <span className="block rounded-md border px-2 py-1 text-xs peer-checked:border-primary peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                        {option.name}
                        {option.description && (
                          <span className="mt-1 block text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <Input
                  id={fieldId}
                  name={field.id}
                  aria-label={field.label}
                  aria-describedby={descriptionId}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  required={field.required}
                  minLength={field.minLength}
                  maxLength={field.maxLength ?? 16_384}
                />
              )}
            </fieldset>
          )
        })}
        {failed && (
          <p role="alert" className="text-xs text-destructive">
            {t("questionResponseFailed")}
          </p>
        )}
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
            onClick={() => answer(null)}
          >
            {t("cancelQuestion")}
          </Button>
          <Button type="submit" size="xs" disabled={pending || expired} aria-busy={pending}>
            {t("submitAnswers")}
          </Button>
        </div>
      </form>
    </details>
  )
}
