import { useTranslations } from "@vibeshape/i18n"
import { isArray, isString } from "is-what"
import { z } from "zod"

const objectValues = z.record(z.string(), z.unknown())
const toolEnvelope = z.strictObject({
  command: z.string(),
  arguments: z.unknown().optional(),
  result: z.unknown().optional(),
  truncated: z.boolean().optional(),
})

function parseOutput(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function hasToolDetails(text: string) {
  const output = parseOutput(text)
  if (output === null) return false
  if (isString(output)) return Boolean(output.trim())
  if (isArray(output)) return output.length > 0
  const object = objectValues.safeParse(output)
  return !object.success || Object.keys(object.data).length > 0
}

function fieldLabel(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/\bId\b/g, "ID")
}

function ToolValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const t = useTranslations("app.assistant")
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">{t("toolEmptyValue")}</span>
  }
  const object = objectValues.safeParse(value)
  if (depth >= 4 && (isArray(value) || object.success)) {
    return <span className="text-muted-foreground">{t("toolNestedValue")}</span>
  }
  if (isArray(value)) {
    return value.length ? (
      <ol className="list-decimal space-y-1 pl-4">
        {value.map((item, index) => (
          <li key={index}>
            <ToolValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    ) : (
      <span className="text-muted-foreground">{t("toolEmptyValue")}</span>
    )
  }
  if (object.success) {
    return <ToolObjectValue entries={Object.entries(object.data)} depth={depth} />
  }

  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
}

function ToolObjectValue({ entries, depth }: { entries: [string, unknown][]; depth: number }) {
  const t = useTranslations("app.assistant")
  if (!entries.length) {
    return <span className="text-muted-foreground">{t("toolEmptyValue")}</span>
  }
  return (
    <dl className="space-y-1">
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0">
          <dt className="font-medium text-muted-foreground">{fieldLabel(key)}</dt>
          <dd className="min-w-0 break-words pl-2">
            <ToolValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AssistantToolDetails({
  action,
  identity,
  text,
}: {
  action: string
  identity: string
  text: string
}) {
  const t = useTranslations("app.assistant")
  const output = parseOutput(text)
  const envelope = toolEnvelope.safeParse(output)
  const structured = envelope.success && ("arguments" in envelope.data || "result" in envelope.data)
  return (
    <div className="space-y-3 text-xs">
      <p>{t("toolPurpose", { action })}</p>
      {structured ? (
        <>
          {"arguments" in envelope.data && (
            <section aria-label={t("toolParameters")}>
              <h4 className="mb-1 font-medium">{t("toolParameters")}</h4>
              <ToolValue
                value={
                  isString(envelope.data.arguments)
                    ? parseOutput(envelope.data.arguments)
                    : envelope.data.arguments
                }
              />
            </section>
          )}
          {"result" in envelope.data && (
            <section aria-label={t("toolResult")}>
              <h4 className="mb-1 font-medium">{t("toolResult")}</h4>
              <ToolValue
                value={
                  isString(envelope.data.result)
                    ? parseOutput(envelope.data.result)
                    : envelope.data.result
                }
              />
            </section>
          )}
        </>
      ) : (
        <section aria-label={t("toolOutput")}>
          <h4 className="mb-1 font-medium">{t("toolOutput")}</h4>
          <ToolValue value={output} />
        </section>
      )}
      <details className="rounded-md border bg-panel-muted">
        <summary className="cursor-pointer px-2 py-1 font-medium focus-visible:outline focus-visible:outline-ring">
          {t("toolTechnicalDetails")}
        </summary>
        <div className="space-y-2 border-t p-2">
          {identity && (
            <p className="break-all">
              <span className="font-medium">{t("toolIdentity")}</span>
              <code className="block">{identity}</code>
            </p>
          )}
          <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
        </div>
      </details>
    </div>
  )
}
