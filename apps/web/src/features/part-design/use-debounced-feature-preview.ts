import { useEffect, useLayoutEffect, useRef } from "react"

export function useDebouncedFeaturePreview<Preview>({
  onPreviewChange,
  preview,
}: Readonly<{
  onPreviewChange: (preview: Preview | null) => void
  preview: Preview | null
}>) {
  const currentPreview = useRef(preview)
  currentPreview.current = preview
  // Schema-parsed preview records are plain data, so this key tracks semantic candidate identity.
  const previewKey = JSON.stringify(preview)

  useLayoutEffect(() => {
    onPreviewChange(null)
    const timeout = window.setTimeout(() => {
      onPreviewChange(currentPreview.current)
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [onPreviewChange, previewKey])

  useEffect(() => () => onPreviewChange(null), [onPreviewChange])
}
