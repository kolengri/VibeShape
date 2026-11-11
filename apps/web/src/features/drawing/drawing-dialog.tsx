import { resolveAuthoredParts } from "@vibeshape/application/authored-parts"
import {
  DRAWING_SHEET_SIZES,
  DRAWING_STANDARD_SCALES,
  DRAWING_VIEWS,
  type DrawingSettings,
  type DrawingTitleBlock,
} from "@vibeshape/domain/drawing"
import {
  DRAWING_FILE_FORMATS,
  type DrawingFileFormat,
  type DrawingSheetCopy,
} from "@vibeshape/formats/drawing"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { CheckboxField } from "@vibeshape/ui/components/checkbox-field"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vibeshape/ui/components/dialog"
import { SelectField, SelectOption } from "@vibeshape/ui/components/select-field"
import { TextField } from "@vibeshape/ui/components/text-field"
import { useEffect, useMemo, useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { readDrawingPreset, writeDrawingPreset } from "./drawing-preset"
import { type DrawingProjector, useDrawing } from "./use-drawing"

type Update = (values: Partial<DrawingSettings>) => void
const TITLE_FIELDS = [
  ["title", 80],
  ["drawingNumber", 40],
  ["author", 60],
  ["date", 20],
  ["material", 60],
] as const satisfies readonly (readonly [keyof DrawingTitleBlock, number])[]

function scaleValue(scale: DrawingSettings["scale"]) {
  return scale.mode === "auto" ? "auto" : `${scale.numerator}:${scale.denominator}`
}

function parseScale(value: string): DrawingSettings["scale"] {
  const [numerator, denominator] = value.split(":").map(Number)
  return numerator && denominator ? { mode: "explicit", numerator, denominator } : { mode: "auto" }
}

function PartField({
  controller,
  value,
  onChange,
}: {
  controller: DocumentControllerState
  value: string
  onChange: (value: string) => void
}) {
  const t = useTranslations("app.drawing.parts")
  const authority = controller.authoredSnapshot
  if (!authority || authority.schemaVersion === 1 || !controller.report) return null
  const parts =
    resolveAuthoredParts(authority, controller.report)?.filter(
      ({ body }) => body !== null && body.representation !== "triangle-mesh",
    ) ?? []
  if (parts.length < 2) return null
  return (
    <SelectField label={t("label")} value={value} onValueChange={onChange}>
      <SelectOption value="all">{t("all")}</SelectOption>
      {parts.map(({ part }) => (
        <SelectOption key={part.id} value={part.id}>
          {part.name}
        </SelectOption>
      ))}
    </SelectField>
  )
}

function ViewFields({ settings, update }: { settings: DrawingSettings; update: Update }) {
  const t = useTranslations("app.drawing.views")
  return (
    <fieldset className="grid grid-cols-2 gap-x-4">
      <legend className="mb-1 text-sm font-medium">{t("legend")}</legend>
      {DRAWING_VIEWS.map((view) => {
        const checked = settings.views.includes(view)
        return (
          <CheckboxField
            key={view}
            label={t(view)}
            checked={checked}
            disabled={checked && settings.views.length === 1}
            onChange={(event) =>
              update({
                views: DRAWING_VIEWS.filter((item) =>
                  item === view ? event.currentTarget.checked : settings.views.includes(item),
                ),
              })
            }
          />
        )
      })}
    </fieldset>
  )
}

function SheetFields({ settings, update }: { settings: DrawingSettings; update: Update }) {
  const t = useTranslations("app.drawing")
  return (
    <div className="grid gap-3">
      <SelectField
        label={t("projection.label")}
        value={settings.projection}
        onValueChange={(value) =>
          update({ projection: value === "third-angle" ? "third-angle" : "first-angle" })
        }
      >
        <SelectOption value="first-angle">{t("projection.first-angle")}</SelectOption>
        <SelectOption value="third-angle">{t("projection.third-angle")}</SelectOption>
      </SelectField>
      <SelectField
        label={t("sheetSize.label")}
        value={settings.sheetSize}
        onValueChange={(value) => {
          const size = Object.keys(DRAWING_SHEET_SIZES).find((item) => item === value)
          if (size) update({ sheetSize: size as DrawingSettings["sheetSize"] })
        }}
      >
        {Object.keys(DRAWING_SHEET_SIZES).map((size) => (
          <SelectOption key={size} value={size}>
            {t(`sheetSize.${size as DrawingSettings["sheetSize"]}`)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("orientation.label")}
        value={settings.orientation}
        onValueChange={(value) =>
          update({ orientation: value === "portrait" ? "portrait" : "landscape" })
        }
      >
        <SelectOption value="landscape">{t("orientation.landscape")}</SelectOption>
        <SelectOption value="portrait">{t("orientation.portrait")}</SelectOption>
      </SelectField>
      <SelectField
        label={t("scale.label")}
        value={scaleValue(settings.scale)}
        onValueChange={(value) => update({ scale: parseScale(value) })}
      >
        <SelectOption value="auto">{t("scale.auto")}</SelectOption>
        {DRAWING_STANDARD_SCALES.map(([numerator, denominator]) => (
          <SelectOption key={`${numerator}:${denominator}`} value={`${numerator}:${denominator}`}>
            {t("scale.ratio", { numerator, denominator })}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("units.label")}
        value={settings.units}
        onValueChange={(value) => update({ units: value === "in" ? "in" : "mm" })}
      >
        <SelectOption value="mm">{t("units.mm")}</SelectOption>
        <SelectOption value="in">{t("units.in")}</SelectOption>
      </SelectField>
      <div className="grid gap-1">
        <CheckboxField
          label={t("hiddenLines")}
          checked={settings.hiddenLines}
          onChange={(event) => update({ hiddenLines: event.currentTarget.checked })}
        />
        <CheckboxField
          label={t("dimensions")}
          checked={settings.dimensions}
          onChange={(event) => update({ dimensions: event.currentTarget.checked })}
        />
      </div>
    </div>
  )
}

function TitleBlockFields({ settings, update }: { settings: DrawingSettings; update: Update }) {
  const t = useTranslations("app.drawing.titleBlock")
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">{t("legend")}</legend>
      {TITLE_FIELDS.map(([field, maxLength]) => (
        <TextField
          key={field}
          label={t(field)}
          {...(field === "title" ? { description: t("titleDescription") } : {})}
          value={settings.titleBlock[field]}
          maxLength={maxLength}
          onChange={(event) =>
            update({ titleBlock: { ...settings.titleBlock, [field]: event.currentTarget.value } })
          }
        />
      ))}
    </fieldset>
  )
}

type DrawingView = ReturnType<typeof useDrawing>

/** White paper regardless of theme, matching the exported sheet. */
function SheetImage({ view }: { view: DrawingView }) {
  const t = useTranslations("app.drawing.preview")
  const { sheet, previewUrl } = view
  const loading = view.status === "loading" && (
    <p role="status" className="text-sm text-neutral-600">
      {t("loading")}
    </p>
  )
  return (
    <div
      className="grid place-items-center overflow-hidden rounded-md border border-border bg-white"
      style={{ aspectRatio: sheet ? `${sheet.width} / ${sheet.height}` : "297 / 210" }}
    >
      {previewUrl ? (
        <img
          className="size-full object-contain"
          src={previewUrl}
          alt={t("alt")}
          data-testid="drawing-preview"
        />
      ) : (
        loading
      )}
    </div>
  )
}

function PreviewMessages({ view }: { view: DrawingView }) {
  const t = useTranslations("app.drawing")
  const { sheet, status } = view
  const error = status === "empty" || status === "failed" ? t(`errors.${status}`) : null
  return (
    <>
      {sheet && (
        <p className="text-sm text-muted-foreground" data-testid="drawing-scale">
          {t("preview.scale", { scale: `${sheet.scale.numerator}:${sheet.scale.denominator}` })}
        </p>
      )}
      {sheet && !sheet.fits && <Alert role="alert">{t("preview.notFits")}</Alert>}
      {error && <Alert role="alert">{error}</Alert>}
    </>
  )
}

function DrawingPreview({ view }: { view: DrawingView }) {
  const t = useTranslations("app.drawing.preview")
  return (
    <section aria-label={t("label")} className="grid content-start gap-2">
      <SheetImage view={view} />
      <PreviewMessages view={view} />
    </section>
  )
}

function DrawingTask({
  controller,
  project,
  onClose,
}: {
  controller: DocumentControllerState
  project?: DrawingProjector | undefined
  onClose: () => void
}) {
  const t = useTranslations("app.drawing")
  const documentId = controller.report?.snapshot.id ?? ""
  const [settings, setSettings] = useState(() => readDrawingPreset(documentId))
  const [partId, setPartId] = useState("all")
  const [downloaded, setDownloaded] = useState(false)
  const copy = useSheetCopy()
  const view = useDrawing({
    controller,
    partId: partId === "all" ? undefined : partId,
    settings,
    copy,
    ...(project ? { project } : {}),
  })
  useEffect(() => {
    if (documentId) writeDrawingPreset(documentId, settings)
  }, [documentId, settings])
  const update: Update = (values) => {
    setDownloaded(false)
    setSettings((current) => ({ ...current, ...values }))
  }
  const download = (format: DrawingFileFormat) => setDownloaded(view.download(format))
  return (
    <>
      <DialogBody className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <PartField controller={controller} value={partId} onChange={setPartId} />
          <ViewFields settings={settings} update={update} />
          <SheetFields settings={settings} update={update} />
          <TitleBlockFields settings={settings} update={update} />
          <p className="text-xs text-muted-foreground">{t("presetNote")}</p>
        </div>
        <DrawingPreview view={view} />
      </DialogBody>
      <DialogFooter>
        {downloaded && (
          <span role="status" className="mr-auto text-xs text-muted-foreground">
            {t("downloaded")}
          </span>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          {t("close")}
        </Button>
        {DRAWING_FILE_FORMATS.map((format) => (
          <Button
            key={format}
            type="button"
            disabled={view.status !== "ready"}
            onClick={() => download(format)}
          >
            {t(`download.${format}`)}
          </Button>
        ))}
      </DialogFooter>
    </>
  )
}

const CAPTIONS = [
  "title",
  "drawingNumber",
  "author",
  "date",
  "material",
  "scale",
  "units",
  "projection",
  "sheet",
] as const

/** Sheet text in the active locale; the MCP path uses the English source catalog instead. */
function useSheetCopy(): DrawingSheetCopy {
  const t = useTranslations("app.drawing.sheet")
  return useMemo(
    () => ({
      viewLabels: Object.fromEntries(
        DRAWING_VIEWS.map((view) => [view, t(`viewLabels.${view}`)]),
      ) as DrawingSheetCopy["viewLabels"],
      captions: Object.fromEntries(
        CAPTIONS.map((caption) => [caption, t(`captions.${caption}`)]),
      ) as DrawingSheetCopy["captions"],
      projections: {
        "first-angle": t("projections.first-angle"),
        "third-angle": t("projections.third-angle"),
      },
      units: { mm: t("units.mm"), in: t("units.in") },
    }),
    [t],
  )
}

export function DrawingDialog({
  controller,
  open,
  onOpenChange,
  onCloseAutoFocus,
  project,
}: {
  controller: DocumentControllerState
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  project?: DrawingProjector
}) {
  const t = useTranslations("app.drawing")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("close")}
        onCloseAutoFocus={onCloseAutoFocus}
        className="sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open && (
          <DrawingTask
            key={controller.report?.snapshot.id ?? "none"}
            controller={controller}
            project={project}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
