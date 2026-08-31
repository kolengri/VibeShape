import { useEffect, useRef } from "react"

export function useDebouncedFeaturePreview<Values, Input, Preview>({
  input,
  onPreviewChange,
  resolve,
  values,
}: Readonly<{
  input: Input
  onPreviewChange: (preview: Preview | null) => void
  resolve: (values: Values, input: Input) => Preview | null
  values: Values
}>) {
  const current = useRef({ input, resolve })
  current.current = { input, resolve }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const latest = current.current
      onPreviewChange(latest.resolve(values, latest.input))
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [onPreviewChange, values])

  useEffect(() => () => onPreviewChange(null), [onPreviewChange])
}
