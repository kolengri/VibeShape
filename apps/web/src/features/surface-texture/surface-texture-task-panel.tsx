import type { FeatureId } from "@vibeshape/domain"
import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import { Button } from "@vibeshape/ui/components/button"
import { Trash2 } from "@vibeshape/ui/components/icons"
import { Form, submitForm } from "@vibeshape/ui/integrations/tanstack-form"
import type { ViewerSelection } from "@vibeshape/viewer/three-viewport"
import { useRef, useState } from "react"
import { TaskPanelLayout } from "../../components/task-panel-layout"
import { TaskPanelLifecycleActions } from "../../components/task-panel-lifecycle-actions"
import type { DocumentControllerState } from "../../document/document-controller"
import { useRegisterTaskSubmission } from "../../editor-session/editor-session-provider"
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
  const formElement = useRef<HTMLFormElement>(null)
  const report = controller.report
  const initialBody = textureInitialBody(initialFeatureId, initialOutputRole, selectedFace)
  const state = useTextureDraft(controller, selectedFace, initialBody, async () => {
    await apply()
  })
  const { draft, layer, update } = state
  const [gallery, setGallery] = useState(false)
  const stale = report?.snapshot.revision !== state.baseRevision
  const { saving, uploading, error, canApply, apply, upload } = useTexturePanelActions(
    state,
    onComplete,
  )
  useRegisterTaskSubmission(async () => {
    if (!draft && !uploading && !saving) onClose()
    else if (state.form.state.isSubmitting || formElement.current?.reportValidity() !== false)
      await submitForm(state.form)
  })
  useTexturePanelKeyboard(gallery, setGallery, state)
  if (gallery && layer)
    return (
      <aside
        aria-label={t("title")}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l bg-panel"
      >
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
      className="flex min-h-0 flex-col overflow-hidden border-l bg-panel"
    >
      <Form
        ref={formElement}
        form={state.form}
        noValidate={false}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <TaskPanelLayout
          title={t("title")}
          description={t("description")}
          actions={
            <TaskPanelLifecycleActions
              ariaLabel={t("title")}
              cancelLabel={t("cancel")}
              acceptLabel={t("apply")}
              acceptType="submit"
              acceptDisabled={!canApply}
              acceptLoading={saving}
              cancelDisabled={saving}
              onCancel={onClose}
            />
          }
        >
          <state.form.FormError />
          {error && <Alert>{error}</Alert>}
          {stale && <Alert>{t("stale")}</Alert>}
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
          <TexturePreviewFooter visible={draft !== null} />
        </TaskPanelLayout>
      </Form>
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
