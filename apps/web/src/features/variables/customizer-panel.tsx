import {
  applyCustomizerConfiguration,
  customizerConfigurationNames,
  evaluateVariableDefinitions,
  removeCustomizerConfiguration,
  saveCustomizerConfiguration,
  setCustomizerValue,
  type VariableDefinition,
  variableCustomizerSchema,
  variableDefinitionsSchema,
} from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { DialogBody, DialogFooter } from "@vibeshape/ui/components/dialog"
import { TextField } from "@vibeshape/ui/components/text-field"
import { type ReactNode, useRef, useState } from "react"
import {
  applyVariableTable,
  type DocumentControllerState,
} from "../../document/document-controller"

export function CustomizerPanel({
  controller,
  closeAction,
}: {
  controller: DocumentControllerState
  closeAction: ReactNode
}) {
  const report = controller.report
  return report ? (
    <ReadyCustomizerPanel
      key={`${report.snapshot.id}:${report.snapshot.revision}`}
      variables={report.snapshot.variables}
      baseRevision={report.snapshot.revision}
      disabled={
        report.mode === "read-only" ||
        controller.status !== "ready" ||
        controller.saveStatus === "saving"
      }
      closeAction={closeAction}
    />
  ) : null
}

export function ReadyCustomizerPanel({
  variables,
  baseRevision,
  disabled,
  closeAction,
  onApply = applyVariableTable,
}: {
  onApply?: typeof applyVariableTable
  variables: readonly VariableDefinition[]
  baseRevision: number
  disabled: boolean
  closeAction: ReactNode
}) {
  const t = useTranslations("app.customizer")
  const [draft, setDraft] = useState<readonly VariableDefinition[]>(variables)
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState("")
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const evaluation = evaluateVariableDefinitions(draft)
  const exposed = draft.filter((variable) => variable.customizer)
  const groups = [...new Set(exposed.map((variable) => variable.customizer?.group ?? ""))]
  const configurations = customizerConfigurationNames(draft)
  const unavailable = disabled || pending
  const numericInputsValid = Object.entries(numericDrafts).every(([id, text]) => {
    const range = draft.find((variable) => variable.id === id)?.customizer
    if (!range) return true
    const value = Number(text)
    return text.trim() !== "" && Number.isFinite(value) && value >= range.min && value <= range.max
  })

  function update(action: () => readonly VariableDefinition[]) {
    try {
      setDraft(action())
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("failed"))
    }
  }

  async function commit(action: () => readonly VariableDefinition[]) {
    if (lock.current || disabled) return
    lock.current = true
    setPending(true)
    try {
      const next = variableDefinitionsSchema.parse(action())
      const result = await onApply(baseRevision, next)
      setMessage(result.ok ? t("saved") : result.diagnostic.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("failed"))
    } finally {
      lock.current = false
      setPending(false)
    }
  }

  function configure(
    id: VariableDefinition["id"],
    change: Partial<NonNullable<VariableDefinition["customizer"]>>,
  ) {
    setDraft((previous) =>
      previous.map((variable) => {
        if (variable.id !== id || !variable.customizer) return variable
        return { ...variable, customizer: { ...variable.customizer, ...change } }
      }),
    )
  }

  return (
    <>
      <DialogBody className="space-y-5" aria-busy={pending}>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {message ? <Alert role="status">{message}</Alert> : null}
        {!evaluation.ok ? <Alert>{evaluation.diagnostic.message}</Alert> : null}
        {exposed.length === 0 ? (
          <p>{t("empty")}</p>
        ) : (
          groups.map((group) => (
            <fieldset
              key={group}
              className="space-y-3 rounded-md border p-3"
              disabled={unavailable}
            >
              <legend className="px-1 font-medium">{group || t("ungrouped")}</legend>
              {exposed
                .filter((variable) => variable.customizer?.group === group)
                .map((variable) => {
                  const range = variable.customizer
                  const value = evaluation.ok
                    ? evaluation.valuesById.get(variable.id)?.value
                    : undefined
                  if (!range || !value) return null
                  const validRange = variableCustomizerSchema.safeParse(range).success
                  return (
                    <div key={variable.id} className="grid gap-2">
                      <label className="text-sm font-medium" htmlFor={`customizer-${variable.id}`}>
                        {variable.name} (
                        {value.dimension === "length"
                          ? "mm"
                          : value.dimension === "angle"
                            ? "rad"
                            : t("scalar")}
                        )
                      </label>
                      <input
                        id={`customizer-${variable.id}`}
                        className="w-full accent-primary"
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={value.value}
                        disabled={!validRange}
                        aria-valuetext={`${value.value}`}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          setNumericDrafts((previous) => {
                            const next = { ...previous }
                            delete next[variable.id]
                            return next
                          })
                          update(() => setCustomizerValue(draft, variable.id, value))
                        }}
                      />
                      <TextField
                        label={t("value", { name: variable.name })}
                        type="number"
                        step="any"
                        value={numericDrafts[variable.id] ?? value.value}
                        min={range.min}
                        max={range.max}
                        disabled={!validRange}
                        onChange={(event) => {
                          const text = event.target.value
                          setNumericDrafts((previous) => ({ ...previous, [variable.id]: text }))
                          update(() => setCustomizerValue(draft, variable.id, Number(text)))
                        }}
                      />
                    </div>
                  )
                })}
            </fieldset>
          ))
        )}
        <section className="space-y-3" aria-label={t("configurations")}>
          <TextField
            label={t("configurationName")}
            value={configuration}
            maxLength={80}
            disabled={unavailable}
            onChange={(event) => setConfiguration(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              unavailable || !numericInputsValid || !configuration.trim() || !exposed.length
            }
            onClick={() => commit(() => saveCustomizerConfiguration(draft, configuration))}
          >
            {t("saveConfiguration")}
          </Button>
          {configurations.map((name) => (
            <div key={name} className="flex flex-wrap items-center gap-2">
              <span className="grow text-sm">{name}</span>
              <Button
                type="button"
                variant="outline"
                disabled={unavailable}
                aria-label={t("applyConfiguration", { name })}
                onClick={() => commit(() => applyCustomizerConfiguration(draft, name))}
              >
                {t("apply")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={unavailable}
                aria-label={t("removeConfiguration", { name })}
                onClick={() => commit(() => removeCustomizerConfiguration(draft, name))}
              >
                {t("remove")}
              </Button>
            </div>
          ))}
        </section>
        <details className="space-y-3">
          <summary className="cursor-pointer font-medium">{t("configure")}</summary>
          <p className="text-sm text-muted-foreground">{t("rangeHelp")}</p>
          {draft.map((variable) => (
            <fieldset
              key={variable.id}
              className="space-y-3 rounded-md border p-3"
              disabled={unavailable}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={Boolean(variable.customizer)}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setDraft((previous) =>
                      previous.map((item) => {
                        if (item.id !== variable.id) return item
                        if (!checked) {
                          const { customizer: _removed, ...rest } = item
                          return rest
                        }
                        const number = evaluation.ok
                          ? (evaluation.valuesById.get(item.id)?.value.value ?? 1)
                          : 1
                        return {
                          ...item,
                          customizer: {
                            dimension: evaluation.ok
                              ? (evaluation.valuesById.get(item.id)?.value.dimension ?? "scalar")
                              : "scalar",
                            group: "",
                            min: Math.min(0, number * 2),
                            max: Math.max(1, number * 2),
                            step: 0.1,
                            configurations: {},
                          },
                        }
                      }),
                    )
                  }}
                />
                {t("expose", { name: variable.name })}
              </label>
              {variable.customizer ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label={t("group")}
                    value={variable.customizer.group}
                    maxLength={80}
                    onChange={(event) => configure(variable.id, { group: event.target.value })}
                  />
                  {(["min", "max", "step"] as const).map((field) => (
                    <TextField
                      key={field}
                      label={t(field)}
                      type="number"
                      step="any"
                      value={variable.customizer?.[field] ?? ""}
                      onChange={(event) =>
                        configure(variable.id, {
                          [field]:
                            event.target.value === "" ? Number.NaN : Number(event.target.value),
                        })
                      }
                    />
                  ))}
                </div>
              ) : null}
            </fieldset>
          ))}
        </details>
      </DialogBody>
      <DialogFooter>
        {closeAction}
        <Button
          type="button"
          disabled={unavailable || !evaluation.ok || !numericInputsValid}
          onClick={() => commit(() => draft)}
        >
          {t("applyChanges")}
        </Button>
      </DialogFooter>
    </>
  )
}
