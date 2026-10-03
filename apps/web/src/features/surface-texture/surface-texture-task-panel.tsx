import type { FeatureId } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Button } from "@vibeshape/ui/components/button"
import { Trash2 } from "@vibeshape/ui/components/icons"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useState } from "react"
import type { DocumentControllerState } from "../../document/document-controller"
import { SurfaceTextureControls } from "./surface-texture-controls"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"
import { TextureGallery } from "./texture-gallery"
import type { TextureDraftState } from "./texture-panel-sections"
import {
  TextureBodyField,
  TextureLayerList,
  TextureMapField,
  TextureRegionControls,
} from "./texture-panel-sections"
import { useTextureDraft } from "./use-texture-draft"
import { useTexturePanelActions, useTexturePanelKeyboard } from "./use-texture-panel-actions"

export function SurfaceTextureTaskPanel({
  controller,
  selectedFace,
  initialFeatureId,
  initialOutputRole,
  onClose,
  onComplete,
}: {
  controller: DocumentControllerState
  selectedFace: ViewerSelection | null
  initialFeatureId: string | null
  initialOutputRole?: string | null | undefined
  onClose: () => void
  onComplete: () => void
}) {
  const t = useTranslations("app.surfaceTexture")
  const report = controller.report
  const initialBody = textureInitialBody(initialFeatureId, initialOutputRole, selectedFace)
  const state = useTextureDraft(controller, selectedFace, initialBody)
  const { draft, layer, update } = state
  const [gallery, setGallery] = useState(false)
  const stale = report?.snapshot.revision !== state.baseRevision
  const { saving, uploading, error, canApply, apply, upload } = useTexturePanelActions(
    state,
    onComplete,
  )
  useTexturePanelKeyboard(gallery, setGallery, state)
  if (gallery && layer)
    return (
      <aside aria-label={t("title")} className="min-h-0 overflow-auto border-l bg-panel p-4">
        <TextureGallery
          selected={layer.map}
          onSelect={(map) => update({ map })}
          onDone={() => setGallery(false)}
        />
      </aside>
    )
  return (
    <aside
      aria-label={t("title")}
      className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-panel"
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void apply()
        }}
      >
        <div className="grid gap-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t("title")}</h2>
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>
              {t("cancel")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
          {stale && (
            <p role="alert" className="text-xs text-destructive">
              {t("stale")}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <fieldset
            disabled={saving || uploading || stale || report?.mode !== "read-write"}
            className="grid gap-4"
          >
            <TextureBodyField controller={controller} state={state} />
            {!draft && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("pickBodyHint")}
              </p>
            )}
            <TextureLayerList state={state} />
            <TextureLayerSettings
              state={state}
              uploading={uploading}
              onBrowse={() => setGallery(true)}
              onUpload={upload}
            />
          </fieldset>
        </div>
        <div className="grid shrink-0 gap-2 border-t bg-panel p-3">
          <TexturePreviewFooter visible={draft !== null} />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!canApply} isLoading={saving}>
            {t("apply")}
          </Button>
        </div>
      </form>
    </aside>
  )
}

function textureInitialBody(
  featureId: string | null,
  outputRole: string | null | undefined,
  selectedFace: ViewerSelection | null,
) {
  if (featureId) return { featureId: featureId as FeatureId, outputRole: outputRole ?? "result" }
  if (!selectedFace) return null
  return {
    featureId: selectedFace.featureId as FeatureId,
    outputRole: selectedFace.outputRole ?? "result",
  }
}

function TextureLayerSettings({
  state,
  uploading,
  onBrowse,
  onUpload,
}: {
  state: TextureDraftState
  uploading: boolean
  onBrowse: () => void
  onUpload: (file: File) => Promise<void>
}) {
  const t = useTranslations("app.surfaceTexture")
  const { layer, update } = state
  if (!layer) return null
  return (
    <>
      <TextureRegionControls state={state} />
      <TextureMapField
        state={state}
        uploading={uploading}
        onBrowse={onBrowse}
        onUpload={onUpload}
      />
      <SurfaceTextureControls key={layer.id} layer={layer} update={update} />
      <Button type="button" size="sm" variant="ghost" onClick={state.removeLayer}>
        <Trash2 aria-hidden="true" />
        {t("removeLayer")}
      </Button>
    </>
  )
}

function TexturePreviewFooter({ visible }: { visible: boolean }) {
  const t = useTranslations("app.surfaceTexture")
  const preview = useSurfaceTexturePreviewContext()
  if (!visible || !preview) return null
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-pressed={preview.showOriginal}
        onClick={() => preview.setShowOriginal(!preview.showOriginal)}
      >
        {preview.showOriginal ? t("showTextured") : t("showOriginal")}
      </Button>
      <p role="status" className="text-xs text-muted-foreground">
        {t(`preview.${preview.status}`)}
      </p>
      <p className="text-xs text-muted-foreground">{t("exportHint")}</p>
      <p className="text-xs text-muted-foreground">{t("boundaryHint")}</p>
    </>
  )
}
