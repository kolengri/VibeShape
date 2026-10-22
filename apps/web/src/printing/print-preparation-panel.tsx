import { documentExportFailure } from "@vibeshape/application/persistent-document-session"
import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { useTranslations } from "@vibeshape/i18n"
import {
  type MeshExportQuality,
  type PrintPreparationResult,
  type PrintPreparationSettings,
  printPreparationSettingsSchema,
} from "@vibeshape/protocol"
import { Button } from "@vibeshape/ui/components/button"
import { fieldVariants } from "@vibeshape/ui/components/field"
import { Form, useAppForm } from "@vibeshape/ui/integrations/tanstack-form"
import { cn } from "@vibeshape/ui/lib/cn"
import { useEffect, useRef, useState } from "react"
import {
  type ActiveDocumentExportResult,
  prepareActiveDocumentPrint,
} from "../document/document-controller"
import { downloadDocumentExport } from "../document/document-export"
import {
  type MeshExportQualityChoice,
  MeshExportQualityField,
  meshExportQuality,
} from "../document/mesh-export-quality-field"
import { useReportApplicationError } from "../shell/application-notices"
import { useViewerPreferences } from "../shell/viewer-preferences"
import { PreparedPrintPreview } from "./prepared-print-preview"
import { placePreparedPrintFace } from "./print-face-placement"
import { SlicerHandoffPanel } from "./slicer-handoff-panel"

const numericFields = [
  "rotationX",
  "rotationY",
  "rotationZ",
  "layerHeight",
  "clearance",
  "thickness",
  "spacing",
  "reach",
] as const
type PreparedExport = Extract<ActiveDocumentExportResult, { ok: true }>

type PrintPreparationPort = (
  settings: PrintPreparationSettings,
  signal: AbortSignal,
  meshQuality?: MeshExportQuality,
) => Promise<ActiveDocumentExportResult>

function usePreparationAttempt(
  meshQualityChoice: MeshExportQualityChoice,
  onBusyChange: (busy: boolean) => void,
) {
  const [pending, setPending] = useState(false)
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
  useEffect(() => {
    if (preparation.current) {
      preparation.current.abort()
      preparation.current = null
      setPending(false)
      onBusyChange(false)
    }
  }, [meshQualityChoice, onBusyChange])
  return { pending, setPending, mounted, preparation }
}

function usePrintPreparation(onBusyChange: (busy: boolean) => void, prepare: PrintPreparationPort) {
  const t = useTranslations("app.printPreparation")
  const exportT = useTranslations("app.export")
  const [prepared, setPrepared] = useState<PreparedExport | null>(null)
  const [error, setErrorMessage] = useState<string | null>(null)
  const [errorAttempt, setErrorAttempt] = useState(0)
  const setError = (message: string | null) => {
    setErrorMessage(message)
    if (message !== null) setErrorAttempt((attempt) => attempt + 1)
  }
  const failureMessage = (failure?: Extract<ActiveDocumentExportResult, { ok: false }>) =>
    failure?.diagnostic?.sourceCode != null
      ? exportT("printPreparationFailedDetails", { details: failure.diagnostic.message })
      : t("failed")
  const [downloaded, setDownloaded] = useState(false)
  const [slicerMessage, setSlicerMessage] = useState<string | null>(null)
  const [slicerPending, setSlicerPending] = useState(false)
  const meshQualityChoice = useViewerPreferences((state) => state.exportMeshQuality)
  const setMeshQualityChoice = useViewerPreferences((state) => state.actions.setExportMeshQuality)
  const { pending, setPending, mounted, preparation } = usePreparationAttempt(
    meshQualityChoice,
    onBusyChange,
  )
  useEffect(() => {
    setPrepared(null)
    setErrorMessage(null)
    setDownloaded(false)
    setSlicerMessage(null)
  }, [meshQualityChoice])
  const defaults = printPreparationSettingsSchema.parse({})
  function applyPreparationResult(result: ActiveDocumentExportResult) {
    if (!result.ok || !result.printPreparation) {
      setError(failureMessage(result.ok ? undefined : result))
      return
    }
    setPrepared(result)
  }
  const form = useAppForm({
    defaultValues: {
      rotationX: String(defaults.rotationX),
      rotationY: String(defaults.rotationY),
      rotationZ: String(defaults.rotationZ),
      supports: defaults.supports,
      layerHeight: String(defaults.layerHeight),
      clearance: String(defaults.clearance),
      thickness: String(defaults.thickness),
      spacing: String(defaults.spacing),
      reach: String(defaults.reach),
    },
    onSubmit: async ({ value }) => {
      if (preparation.current) return
      const settings = printPreparationSettingsSchema.safeParse({
        ...Object.fromEntries(
          numericFields.map((key) => [
            key,
            value[key].trim() === "" ? Number.NaN : Number(value[key]),
          ]),
        ),
        supports: value.supports,
      })
      setPrepared(null)
      setDownloaded(false)
      if (!settings.success) {
        setError(t("invalid"))
        return
      }
      const abort = new AbortController()
      preparation.current = abort
      const isActiveAttempt = () =>
        mounted.current && !abort.signal.aborted && preparation.current === abort
      setError(null)
      setPending(true)
      onBusyChange(true)
      try {
        const quality = meshExportQuality(meshQualityChoice)
        const result = quality
          ? await prepare(settings.data, abort.signal, quality)
          : await prepare(settings.data, abort.signal)
        if (!isActiveAttempt()) return
        applyPreparationResult(result)
      } catch (error) {
        if (isActiveAttempt()) setError(failureMessage(documentExportFailure(error)))
      } finally {
        if (preparation.current === abort) {
          preparation.current = null
          if (mounted.current) {
            setPending(false)
            onBusyChange(false)
          }
        }
      }
    },
  })
  return {
    form,
    prepared,
    error,
    errorAttempt,
    pending,
    downloaded,
    setPrepared,
    setError,
    setDownloaded,
    slicerMessage,
    setSlicerMessage,
    slicerPending,
    setSlicerPending,
    meshQualityChoice,
    setMeshQualityChoice,
  }
}

export function PrintPreparationPanel({
  disabled,
  onBusyChange,
  prepare = prepareActiveDocumentPrint,
  limitations,
}: {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  prepare?: PrintPreparationPort
  limitations?: string
}) {
  const t = useTranslations("app.printPreparation")
  const state = usePrintPreparation(onBusyChange, prepare)
  const appOwnsError = useReportApplicationError(state.error, state.errorAttempt)
  const {
    form,
    error,
    pending,
    setPrepared,
    setError,
    setDownloaded,
    setSlicerMessage,
    slicerPending,
  } = state
  return (
    <section className="grid gap-4 border-t pt-4" aria-label={t("title")}>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
        <p className="text-xs text-muted-foreground">{limitations ?? t("limitations")}</p>
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
        <MeshExportQualityField
          value={state.meshQualityChoice}
          onChange={state.setMeshQualityChoice}
          disabled={disabled || pending || slicerPending}
        />
        <fieldset disabled={disabled || pending || slicerPending} className="grid min-w-0 gap-2">
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
          <form.AppField name="supports">
            {(field) => (
              <label
                className={cn(fieldVariants({ orientation: "horizontal" }), "min-h-8 text-sm")}
              >
                <span>{t("supports")}</span>
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={field.state.value}
                  onChange={(event) => field.handleChange(event.currentTarget.checked)}
                />
              </label>
            )}
          </form.AppField>
        </fieldset>
        <form.SubmitButton requireDirty={false} disabled={disabled || pending || slicerPending}>
          {t("prepare")}
        </form.SubmitButton>
      </Form>
      {error && !appOwnsError ? (
        <p
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 break-words rounded-md border border-destructive bg-popover p-3 text-sm text-destructive shadow-lg"
        >
          {error}
        </p>
      ) : null}
      <PrintPreparationOutput state={state} disabled={disabled} onBusyChange={onBusyChange} />
    </section>
  )
}

function PrintPreparationOutput({
  state,
  disabled,
  onBusyChange,
}: {
  state: ReturnType<typeof usePrintPreparation>
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const t = useTranslations("app.printPreparation")
  const {
    prepared,
    form,
    pending,
    downloaded,
    setDownloaded,
    setError,
    slicerMessage,
    setSlicerMessage,
    slicerPending,
    setSlicerPending,
  } = state
  const printerProfile = useViewerPreferences((state) => state.printerProfile)
  const report = prepared?.printPreparation?.report
  const busy = disabled || pending || slicerPending
  return prepared?.printPreparation && report ? (
    <>
      <PreparedPrintPreview
        result={prepared.printPreparation}
        disabled={busy}
        profile={printerProfile}
        onLayFace={async (meshIndex, triangleIndex) => {
          try {
            setSlicerMessage(null)
            await placePreparedPrintFace(prepared.printPreparation, form, meshIndex, triangleIndex)
          } catch {
            setError(t("faceFailed"))
          }
        }}
      />
      <PrintPreparationReport report={report} supports={form.state.values.supports} />
      <p className="text-xs text-muted-foreground">{t("verify")}</p>
      <Button
        type="button"
        disabled={busy}
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
        disabled={busy}
        onBusyChange={(busy) => {
          setSlicerPending(busy)
          onBusyChange(busy)
        }}
        onOpened={setSlicerMessage}
        prepareMesh={async (format) =>
          format === "3mf"
            ? prepared
            : {
                ...prepared,
                format: "stl",
                file: writeStlMeshes(
                  prepared.printPreparation?.meshes.map(({ vertices, triangles }) => ({
                    vertices,
                    triangles,
                  })),
                ),
              }
        }
      />
      {slicerMessage ? (
        <p role="status" className="text-sm">
          {slicerMessage}
        </p>
      ) : null}
    </>
  ) : null
}

function PrintPreparationReport({
  report,
  supports,
}: {
  report: PrintPreparationResult["report"]
  supports: boolean
}) {
  const t = useTranslations("app.printPreparation")
  return (
    <>
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
        <p className="text-sm text-muted-foreground">{t(supports ? "noFins" : "finsDisabled")}</p>
      ) : null}
    </>
  )
}
