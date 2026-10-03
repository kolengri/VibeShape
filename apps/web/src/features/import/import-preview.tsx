import type { MeshImportInspection, SourceImportInspection } from "@vibeshape/protocol"
import type { GeometryViewport } from "@vibeshape/viewer/three-viewport"
import { useEffect, useRef, useState } from "react"

export function ImportPreview({
  inspection,
  label,
  failedMessage,
  onReady,
}: {
  inspection: SourceImportInspection | MeshImportInspection
  label: string
  failedMessage: string
  onReady: (ready: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let viewport: GeometryViewport | undefined
    const element = canvas.current
    if (!element) return
    onReady(false)
    setFailed(false)
    void import("@vibeshape/viewer/three-viewport")
      .then(({ createGeometryViewport }) => {
        if (!active) return
        viewport = createGeometryViewport(element)
        viewport.setInteractionMode("camera-only")
        viewport.setOriginPlaneVisibility({ xy: false, xz: false, yz: false })
        viewport.setGroundGrid(false)
        // Detached display keys never become authored output or topology identities.
        viewport.setMeshes(
          inspection.outputs.map(({ mesh }, index) => ({
            ...mesh,
            featureId: `import-preview-${index}`,
            appearance: "preview",
          })),
        )
        viewport.fit()
        onReady(true)
      })
      .catch(() => {
        if (active) {
          setFailed(true)
          onReady(false)
        }
      })
    return () => {
      active = false
      onReady(false)
      viewport?.dispose()
    }
  }, [inspection, onReady])
  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        className="h-64 w-full rounded-md border bg-viewport-background"
        aria-label={label}
      />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {failedMessage}
        </p>
      )}
    </div>
  )
}
