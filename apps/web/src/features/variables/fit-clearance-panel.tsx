import { printFitClearance, printFitPresets, withPrintFitClearance } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { useRef, useState } from "react"
import {
  applyVariableTable,
  createBrowserVariableId,
  type DocumentControllerState,
} from "../../document/document-controller"

export function FitClearancePanel({ controller }: { controller: DocumentControllerState }) {
  const t = useTranslations("app.printFit")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const locked = useRef(false)
  const snapshot = controller.report?.snapshot
  if (!snapshot) return null
  const current = printFitClearance(snapshot.variables)
  const disabled =
    pending ||
    controller.status !== "ready" ||
    controller.saveStatus === "saving" ||
    controller.report?.mode === "read-only"
  const apply = async (valueMm: number) => {
    if (disabled || locked.current) return
    locked.current = true
    setPending(true)
    setError(false)
    try {
      const variables = withPrintFitClearance(
        snapshot.variables,
        `${valueMm} mm`,
        createBrowserVariableId,
      )
      if (!variables) {
        setError(true)
        return
      }
      const result = await applyVariableTable(snapshot.revision, variables)
      setError(!result.ok)
    } catch {
      setError(true)
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  return (
    <section
      className="grid gap-2 rounded-md border p-3"
      aria-label={t("title")}
      aria-busy={pending}
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <p className="text-xs" role="status">
        {current === null ? t("unset") : t("current", { value: current })}
      </p>
      <div className="flex flex-wrap gap-2">
        {printFitPresets.map(({ id, valueMm }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void apply(valueMm)}
          >
            {t(id, { value: valueMm })}
          </Button>
        ))}
      </div>
      {error ? <Alert>{t("failed")}</Alert> : null}
    </section>
  )
}
