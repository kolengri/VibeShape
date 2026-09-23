import { useTranslations } from "@vibeshape/i18n"
import { printPreparationSettingsSchema } from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { useEffect, useRef, useState } from "react"
import {
  type ActiveDocumentExportResult,
  prepareActiveDocumentPrint,
} from "../document/document-controller"
import { downloadDocumentExport } from "../document/document-export"
import { PrintPreparationPreview } from "./print-preparation-preview"
import { SlicerHandoffPanel } from "./slicer-handoff-panel"

const numericFields = [
  "rotationX",
  "rotationY",
  "layerHeight",
  "clearance",
  "thickness",
  "spacing",
  "reach",
] as const
type PreparedExport = Extract<ActiveDocumentExportResult, { ok: true }>

function usePrintPreparation(onBusyChange: (busy: boolean) => void) {
  const t = useTranslations("app.printPreparation")
  const [prepared, setPrepared] = useState<PreparedExport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [slicerMessage, setSlicerMessage] = useState<string | null>(null)
  const [slicerPending, setSlicerPending] = useState(false)
  const mounted = useRef(true)
  const preparation = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      preparation.current?.abort()
      onBusyChange(false)
    }
  }, [onBusyChange])
  const defaults = printPreparationSettingsSchema.parse({})
  const form = useAppForm({
    defaultValues: {
      rotationX: String(defaults.rotationX),
      rotationY: String(defaults.rotationY),
      layerHeight: String(defaults.layerHeight),
      clearance: String(defaults.clearance),
      thickness: String(defaults.thickness),
      spacing: String(defaults.spacing),
      reach: String(defaults.reach),
    },
    onSubmit: async ({ value }) => {
      const settings = printPreparationSettingsSchema.safeParse({
        ...Object.fromEntries(
          numericFields.map((key) => [
            key,
            value[key].trim() === "" ? Number.NaN : Number(value[key]),
          ]),
        ),
        supports: true,
      })
      setPrepared(null)
      setDownloaded(false)
      if (!settings.success) {
        setError(t("invalid"))
        return
      }
      setError(null)
      setPending(true)
      onBusyChange(true)
      try {
        const abort = new AbortController()
        preparation.current = abort
        const result = await prepareActiveDocumentPrint(settings.data, abort.signal)
        if (!mounted.current) return
        if (!result.ok || !result.printPreparation) {
          setError(t("failed"))
          return
        }
        setPrepared(result)
      } catch {
        if (mounted.current) setError(t("failed"))
      } finally {
        if (mounted.current) {
          setPending(false)
          onBusyChange(false)
        }
      }
    },
  })
  return {
    form,
    prepared,
    error,
    pending,
    downloaded,
    setPrepared,
    setError,
    setDownloaded,
    slicerMessage,
    setSlicerMessage,
    slicerPending,
    setSlicerPending,
  }
}

export function PrintPreparationPanel({
  disabled,
  onBusyChange,
}: {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const t = useTranslations("app.printPreparation")
  const {
    form,
    prepared,
    error,
    pending,
    downloaded,
    setPrepared,
    setError,
    setDownloaded,
    slicerMessage,
    setSlicerMessage,
    slicerPending,
    setSlicerPending,
  } = usePrintPreparation(onBusyChange)
  const report = prepared?.printPreparation?.report
  return (
    <section className="grid gap-4 border-t pt-4" aria-label={t("title")}>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
        <p className="text-xs text-muted-foreground">{t("limitations")}</p>
      </div>
      <Form
        form={form}
        aria-label={t("settings")}
        onChange={() => {
          setPrepared(null)
          setError(null)
          setDownloaded(false)
          setSlicerMessage(null)
        }}
      >
        <fieldset
          disabled={disabled || pending || slicerPending}
          className="grid min-w-0 gap-3 sm:grid-cols-2"
        >
          {numericFields.map((name) => (
            <form.AppField
              key={name}
              name={name}
              validators={{
                onChange: ({ value }) =>
                  value.trim() !== "" && Number.isFinite(Number(value))
                    ? undefined
                    : t("invalidNumber"),
              }}
            >
              {(field) => <field.TextField type="number" step="any" label={t(name)} />}
            </form.AppField>
          ))}
        </fieldset>
        <form.SubmitButton requireDirty={false} disabled={disabled || pending || slicerPending}>
          {t("prepare")}
        </form.SubmitButton>
      </Form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {prepared?.printPreparation && report ? (
        <>
          <PrintPreparationPreview result={prepared.printPreparation} />
          <p role="status" className="text-sm">
            {t("report", {
              bodies: report.bodyCount,
              fins: report.finCount,
              contacts: report.contactCount,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("dimensions", {
              x: report.bounds[0].toFixed(2),
              y: report.bounds[1].toFixed(2),
              z: report.bounds[2].toFixed(2),
            })}
          </p>
          {report.warnings.map((warning) => (
            <p key={warning} role="status" className="text-sm text-muted-foreground">
              {t(`warning.${warning}`)}
            </p>
          ))}
          {report.finCount === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noFins")}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("verify")}</p>
          <Button
            type="button"
            disabled={disabled || pending || slicerPending}
            onClick={() => {
              downloadDocumentExport(prepared)
              setDownloaded(true)
            }}
          >
            {t("download")}
          </Button>
          {downloaded ? (
            <p role="status" className="text-sm">
              {t("downloaded")}
            </p>
          ) : null}
          <SlicerHandoffPanel
            disabled={disabled || pending || slicerPending}
            onBusyChange={(busy) => {
              setSlicerPending(busy)
              onBusyChange(busy)
            }}
            onOpened={setSlicerMessage}
            prepareThreeMf={async () => prepared}
          />
          {slicerMessage ? (
            <p role="status" className="text-sm">
              {slicerMessage}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
