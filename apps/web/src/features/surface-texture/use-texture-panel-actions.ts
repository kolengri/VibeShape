import { surfaceTextureLayersSchema } from "@vibeshape/domain/surface-textures"
import { useTranslations } from "@vibeshape/i18n"
import { useBlockingActivity } from "@vibeshape/ui/components/activity"
import { useEffect, useRef, useState } from "react"
import { replaceSurfaceTextureLayers } from "../../document/document-controller"
import { readTextureImage } from "./read-texture-image"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"
import type { useTextureDraft } from "./use-texture-draft"

type TextureDraftState = ReturnType<typeof useTextureDraft>
export function useTexturePanelActions(state: TextureDraftState, onComplete: () => void) {
  const t = useTranslations("app.surfaceTexture")
  const preview = useSurfaceTexturePreviewContext()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const uploadGeneration = useRef(0)
  const { draft, layer, update } = state
  const validated = draft ? surfaceTextureLayersSchema.safeParse(draft.layers) : null
  const canApply =
    state.writable &&
    validated?.success &&
    !state.strokeActive &&
    (!draft?.layers.some(({ enabled }) => enabled) ||
      (preview?.status === "ready" && preview.readyDraft === preview.draft)) &&
    !uploading
  const setShowOriginal = preview?.setShowOriginal
  useEffect(
    () => () => {
      uploadGeneration.current += 1
      setShowOriginal?.(false)
    },
    [setShowOriginal],
  )
  async function apply() {
    if (!draft || !canApply || busy.current) return
    if (state.isUnchanged()) return onComplete()
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await replaceSurfaceTextureLayers(
        state.baseRevision,
        draft.featureId,
        draft.layers,
      )
      if (result.ok) onComplete()
      else setError(t("saveFailed"))
    } catch {
      setError(t("saveFailed"))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  async function upload(file: File) {
    const generation = ++uploadGeneration.current
    const layerId = layer?.id
    setUploading(true)
    setError(null)
    try {
      const map = await readTextureImage(file)
      if (uploadGeneration.current === generation && layerId === layer?.id) update({ map })
    } catch {
      if (uploadGeneration.current === generation) setError(t("uploadFailed"))
    } finally {
      if (uploadGeneration.current === generation) setUploading(false)
    }
  }
  return { saving, uploading, error, canApply, apply, upload }
}
export function useTexturePanelKeyboard(
  gallery: boolean,
  setGallery: (value: boolean) => void,
  state: Pick<TextureDraftState, "maskUndoAvailable" | "strokeActive" | "undoMask">,
) {
  const blocking = useBlockingActivity() !== null
  useEffect(() => {
    if (blocking) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gallery) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setGallery(false)
      } else if (
        isMaskUndoShortcut(event) &&
        (state.maskUndoAvailable || state.strokeActive) &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!state.strokeActive) state.undoMask()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [blocking, gallery, setGallery, state.maskUndoAvailable, state.strokeActive, state.undoMask])
}

function isMaskUndoShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey
}
