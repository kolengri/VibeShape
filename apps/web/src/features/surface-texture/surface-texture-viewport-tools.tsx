import { useTranslations } from "@vibeshape/i18n"
import { Alert } from "@vibeshape/ui/components/alert"
import type { GeometryViewport } from "@vibeshape/viewer/three-viewport"
import { type RefObject, useEffect } from "react"
import { useSurfaceTexturePreviewContext } from "./surface-texture-preview-context"

export function SurfaceTextureViewportTools({
  viewportRef,
}: {
  viewportRef: RefObject<GeometryViewport | null>
}) {
  const preview = useSurfaceTexturePreviewContext()
  const t = useTranslations("app.surfaceTexture")
  useEffect(() => {
    viewportRef.current?.setSurfaceTextureBrush(preview?.brush ?? null, preview?.active ?? false)
  }, [preview?.brush, preview?.active, viewportRef])
  if (preview?.status !== "error") return null
  return <Alert className="absolute bottom-12 left-3 right-3">{t("preview.error")}</Alert>
}
