import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
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
import {
  type PictureRenderSettings,
  pictureFinishes,
  pictureRenderSettingsSchema,
  pictureScenes,
  pictureSizes,
} from "@vibeshape/viewer/picture-render"
import { viewerBodyKey } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import { usePictureRender } from "./use-picture-render"

type PictureView = ReturnType<typeof usePictureRender>
type SettingsProps = {
  view: PictureView
  settings: PictureRenderSettings
  onChange: (settings: PictureRenderSettings) => void
}
function PictureSettings({ view, settings, onChange }: SettingsProps) {
  const t = useTranslations("pictureRender")
  const update = (values: Partial<PictureRenderSettings>) =>
    onChange(pictureRenderSettingsSchema.parse({ ...settings, ...values }))
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label={t("scene")}
        value={settings.scene}
        onValueChange={(scene) =>
          update({ scene: pictureRenderSettingsSchema.shape.scene.parse(scene) })
        }
      >
        {pictureScenes.map((scene) => (
          <SelectOption key={scene} value={scene}>
            {t(`scenes.${scene}`)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("size")}
        value={`${settings.width}x${settings.height}`}
        onValueChange={(value) => {
          const size = pictureSizes.find((size) => `${size.width}x${size.height}` === value)
          if (size) update(size)
        }}
      >
        {pictureSizes.map((size) => (
          <SelectOption key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
            {t("dimensions", size)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("quality")}
        description={t("qualityHint")}
        value={settings.quality}
        onValueChange={(quality) =>
          update({ quality: pictureRenderSettingsSchema.shape.quality.parse(quality) })
        }
      >
        {(["draft", "standard", "high"] as const).map((quality) => (
          <SelectOption key={quality} value={quality}>
            {t(`qualities.${quality}`)}
          </SelectOption>
        ))}
      </SelectField>
      <SelectField
        label={t("camera")}
        value={settings.camera}
        onValueChange={(camera) =>
          update({ camera: pictureRenderSettingsSchema.shape.camera.parse(camera) })
        }
      >
        <SelectOption value="auto">{t("autoCamera")}</SelectOption>
        <SelectOption value="current" disabled={!view.source?.camera}>
          {t("currentCamera")}
        </SelectOption>
      </SelectField>
      <fieldset className="grid gap-3 sm:col-span-2">
        <legend className="mb-2 text-sm font-medium">{t("finishes")}</legend>
        <p className="text-sm text-muted-foreground">{t("finishesHint")}</p>
        {view.source?.meshes.map((mesh, index) => {
          const key = viewerBodyKey(mesh)
          return (
            <SelectField
              key={key}
              label={t("body", { index: index + 1 })}
              value={settings.finishes[key] ?? "original"}
              onValueChange={(value) => {
                const finishes = { ...settings.finishes }
                if (value === "original") delete finishes[key]
                else
                  finishes[key] = pictureRenderSettingsSchema.shape.finishes
                    .unwrap()
                    .valueType.parse(value)
                update({ finishes })
              }}
            >
              <SelectOption value="original">{t("original")}</SelectOption>
              {pictureFinishes.map((finish) => (
                <SelectOption key={finish} value={finish}>
                  {t(`materials.${finish}`)}
                </SelectOption>
              ))}
            </SelectField>
          )
        })}
      </fieldset>
    </div>
  )
}
function PictureProgress({ progress }: { progress: PictureView["progress"] }) {
  const t = useTranslations("pictureRender")
  if (!progress) return null
  return (
    <div role="status" aria-live="polite" className="grid gap-2">
      <p>{t(`stages.${progress.stage}`)}</p>
      {progress.targetSamples !== undefined && progress.samples !== undefined && (
        <>
          <progress
            className="w-full"
            aria-label={t("sampleProgress")}
            value={progress.samples}
            max={progress.targetSamples}
          />
          <p className="text-sm text-muted-foreground">
            {t("samples", {
              done: Math.floor(progress.samples),
              total: progress.targetSamples,
            })}
          </p>
        </>
      )}
    </div>
  )
}

function PictureActions({
  view,
  settings,
  onClose,
}: {
  view: PictureView
  settings: PictureRenderSettings
  onClose: () => void
}) {
  const t = useTranslations("pictureRender")
  const pending = view.progress !== null
  return (
    <DialogFooter>
      {pending ? (
        <Button type="button" variant="outline" onClick={view.cancel}>
          {t("cancel")}
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          {view.output ? (
            <>
              <Button type="button" variant="outline" onClick={view.clearOutput}>
                {t("back")}
              </Button>
              <Button asChild>
                <a href={view.output.url} download="VibeShape-picture.png">
                  {t("download")}
                </a>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={!view.canRender}
              onClick={() => void view.start(settings)}
            >
              {t("render")}
            </Button>
          )}
        </>
      )}
    </DialogFooter>
  )
}

function PictureTask({ onClose }: { onClose: () => void }) {
  const t = useTranslations("pictureRender")
  const view = usePictureRender()
  const [settings, setSettings] = useState(() => pictureRenderSettingsSchema.parse({}))
  const pending = view.progress !== null
  const error = view.error
  return (
    <>
      <DialogBody aria-busy={pending}>
        {view.output ? (
          <figure className="grid gap-3">
            <img
              className="max-h-96 w-full object-contain"
              src={view.output.url}
              width={view.output.width}
              height={view.output.height}
              alt={t("imageAlt")}
            />
            <figcaption className="text-sm text-muted-foreground">
              {t("dimensions", view.output)}
            </figcaption>
          </figure>
        ) : (
          <fieldset disabled={pending} className="grid gap-4">
            <PictureSettings view={view} settings={settings} onChange={setSettings} />
          </fieldset>
        )}
        {!view.source?.meshes.length && <p role="status">{t("errors.empty")}</p>}
        {error && <Alert role="alert">{t(`errors.${error}`)}</Alert>}
        <PictureProgress progress={view.progress} />
      </DialogBody>
      <PictureActions view={view} settings={settings} onClose={onClose} />
    </>
  )
}
export function PictureRenderDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useTranslations("pictureRender")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("close")}
        onCloseAutoFocus={onCloseAutoFocus}
        className="sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open && <PictureTask onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
