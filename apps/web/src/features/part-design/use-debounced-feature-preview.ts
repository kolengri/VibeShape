import { useEffect, useLayoutEffect, useRef } from "react"

export function useDebouncedFeaturePreview<Preview>({
  onPreviewChange,
  preview,
  retainValidPreview = false,
}: Readonly<{
  onPreviewChange: (preview: Preview | null) => void
  preview: Preview | null
  retainValidPreview?: boolean
}>) {
  const currentPreview = useRef(preview)
  currentPreview.current = preview
  // Schema-parsed preview records are plain data, so this key tracks semantic candidate identity.
  const previewKey = JSON.stringify(preview)

  useLayoutEffect(() => {
    if (!retainValidPreview || currentPreview.current === null) onPreviewChange(null)
    const timeout = window.setTimeout(() => {
      onPreviewChange(currentPreview.current)
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [onPreviewChange, previewKey, retainValidPreview])

  useEffect(() => () => onPreviewChange(null), [onPreviewChange])
}
