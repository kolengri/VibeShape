import { queryVariableUsage } from "@vibeshape/automation-api/queries"
import type { DocumentSnapshot } from "@vibeshape/domain/document"
import type { VariableId } from "@vibeshape/domain/identifiers"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { type MouseEventHandler, useEffect, useId, useMemo, useRef, useState } from "react"

export function VariableUsageInspector({
  snapshot,
  variableId,
  name,
  onClose,
}: {
  snapshot: DocumentSnapshot | null
  variableId: VariableId
  name: string
  onClose: MouseEventHandler<HTMLButtonElement>
}) {
  const t = useTranslations("app.variables.usage")
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [transitive, setTransitive] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const result = useMemo(
    () =>
      queryVariableUsage(snapshot, {
        kind: "org.vibeshape.cad.variable-usage",
        schemaVersion: 1,
        documentId: snapshot?.id,
        revision: snapshot?.revision,
        variableId,
        transitive,
        cursor,
      }),
    [snapshot, variableId, transitive, cursor],
  )
  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="break-words font-medium outline-none"
        >
          {t("title", { name: result.ok ? result.view.variableName : name })}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("scope")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={transitive}
        onClick={() => {
          setTransitive(!transitive)
          setCursor(null)
        }}
      >
        {t("transitive")}
      </Button>
      {result.ok ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            {t("saved", { revision: result.view.revision })}
          </p>
          <p className="text-sm">{t("summary", { count: result.view.data.total })}</p>
          {result.view.data.coverage === "partial" && <Alert>{t("partial")}</Alert>}
          {result.view.data.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-3" aria-label={t("title", { name: result.view.variableName })}>
              {result.view.data.items.map((item) => {
                const kind = item.kind === "sketch-constraint" ? "sketch" : item.kind
                return (
                  <li
                    key={JSON.stringify([
                      item.kind,
                      item.kind === "variable" ? item.variableId : item.entity.id,
                      item.parameterPath,
                    ])}
                    className="min-w-0 text-sm"
                  >
                    <p className="break-words font-medium">
                      {item.kind === "variable"
                        ? `#${item.name}`
                        : (item.label ?? t("unnamed", { kind }))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("consumer", { kind, distance: item.distance })}
                      {item.kind === "feature" && item.suppressed && (
                        <span className="ml-2">{t("suppressed")}</span>
                      )}
                    </p>
                    {item.kind === "sketch-constraint" && (
                      <p className="break-all text-xs text-muted-foreground">
                        {t("constraint", { type: item.constraintType, id: item.constraintId })}
                      </p>
                    )}
                    <code className="block break-all text-xs text-muted-foreground">
                      /
                      {item.parameterPath
                        .map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1"))
                        .join("/")}
                    </code>
                    <code className="block break-all text-xs">{item.expression}</code>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {cursor !== null && (
              <Button type="button" size="sm" variant="outline" onClick={() => setCursor(null)}>
                {t("firstPage")}
              </Button>
            )}
            {result.view.nextCursor !== null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCursor(result.view.nextCursor)}
              >
                {t("nextPage")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Alert>{t("unavailable")}</Alert>
      )}
    </section>
  )
}
